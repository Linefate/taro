## interceptor

> https://docs.taro.zone/docs/apis/network/request/addInterceptor
> 可以使用拦截器在请求发出前或发出后做一些额外操作。
> 在调用 Taro.request 发起请求之前，调用 Taro.addInterceptor 方法为请求添加拦截器，拦截器的调用顺序遵循洋葱模型。
> 拦截器是一个函数，接受 chain 对象作为参数。chain 对象中含有 requestParmas 属性，代表请求参数。拦截器内最后需要调用 chain.proceed(requestParams) 以调用下一个拦截器或发起请求。

### 案例

#### 示例 1

```ts
const interceptor = function (chain) {
  const requestParams = chain.requestParams
  const { method, data, url } = requestParams

  console.log(`http ${method || 'GET'} --> ${url} data: `, data)

  return chain.proceed(requestParams).then((res) => {
    console.log(`http <-- ${url} result:`, res)
    return res
  })
}
Taro.addInterceptor(interceptor)
Taro.request({ url })
```

#### 业务场景

> 在请求发出前或发出后做一些额外操作。 1.公参，签名，特殊 code 处理，header 响应修改

```ts
import { addInterceptor } from '@tarojs/taro'
import {
  mainInterceptor,
  domainInterceptor,
  signInterceptor,
  specialCodeInterceptor,
  commonParamsInterceptor,
  yiDunInterceptor,
} from '@xunfeng/base-api'

export const initInterceptorNode = () => {
  // ! 不要随便改遍顺序
  // 公参
  addInterceptor(commonParamsInterceptor)
  // 签名
  addInterceptor(signInterceptor)
  // 域名
  addInterceptor(domainInterceptor)
  // 新增易盾参数
  addInterceptor(yiDunInterceptor)
  // 特殊code处理  mainInterceptor修改后再处理
  addInterceptor(specialCodeInterceptor)
  // header 修改（如加Authorization token ，或者一些特殊header等）
  addInterceptor(mainInterceptor)
}
```

### chain

"promise 的链式结构形成洋葱模型"。 1.每个拦截器都写成 async 函数 2.每个拦截器都执行到 await chain.proceed() 就暂停
3.proceed() 会进入下一层拦截器 4.最内层结束后，Promise resolve 5.外层的 async 函数继续执行“after 部分” 6.形成一层一层往外返回

#### 核心代码

1.拦截器数组是同一个 2.请求参数是同一个对象 3.唯一变化：index+1 => 指向下一层洋葱

```ts
const chain = new Chain()
chain.interceptors = [interceptor1, interceptor2, interceptor3]
```

代码实现

```ts
import { isFunction } from '@tarojs/shared'

export type TInterceptor = (c: Chain) => Promise<void>

export interface IRequestParams {
  timeout?: number
  method?: string
  url?: string
  data?: unknown
}
// “Promise 的链式结构形成洋葱模型”。
// 1.每个拦截器都写成 async 函数
// 2.每个拦截器都执行到 await chain.proceed() 就暂停
// 3.proceed() 会进入下一层拦截器
// 4.最内层结束后，Promise resolve
// 5.外层的 async 函数继续执行“after 部分”
// 6.形成一层一层往外返回

export default class Chain {
  /**
   * 拦截器数组是同一个
   * 请求参数是同一个对象
   * 唯一变化：index+1 => 指向下一层洋葱
   */
  index: number
  requestParams: IRequestParams
  interceptors: TInterceptor[]

  constructor(requestParams?: IRequestParams, interceptors?: TInterceptor[], index?: number) {
    this.index = index || 0
    this.requestParams = requestParams || {}
    this.interceptors = interceptors || []
  }

  /**
   * 由外部调用的
   */
  proceed(requestParams: IRequestParams = {}) {
    this.requestParams = requestParams
    if (this.index >= this.interceptors.length) {
      throw new Error('chain 参数错误, 请勿直接修改 request.chain')
    }
    // 获取当前拦截器 当前链的当前拦截器（根据 index)
    // (c: Chain) => Promise<void>
    const nextInterceptor = this._getNextInterceptor()
    // nextChain = index + 1 的新 Chain（指向下一层洋葱）
    const nextChain = this._getNextChain()
    // 执行当前拦截器代码
    /**
     * interceptor 的入参是 nextChain，而不是当前 chain！
     * 这意味着：
     * •A 拦截器里调用 chain.proceed() → 会执行 B
     * •B 拦截器里调用 chain.proceed() → 会执行 C（真实 API）
     * •C 执行完返回给 B
     * •B 返回结果给 A
     */
    const p = nextInterceptor(nextChain)

    // 保证错误一定向外流出
    const res = p.catch((err) => Promise.reject(err))
    /**
     * 把原来 Promise 上的自定义方法“复制”到 res 上
     * 在 Taro 的部分 API 中，底层返回的 Promise 不是普通 Promise
     * 而是一个 promise + callback 形式的 Hybrid 对象
     * 例如
     * const task = Taro.request({
     *   url: 'xxx'
     * })
     * task.abort()
     * ✔ Taro.request 返回的不是纯 Promise
     * 它是一个 Promise，外加一些附加方法：
     * • abort()
     * • onHeadersReceived()
     * • onProgressUpdate()
     * • 等等…
     *  */
    Object.keys(p).forEach((k) => isFunction(p[k]) && (res[k] = p[k]))
    return res
  }

  _getNextInterceptor() {
    return this.interceptors[this.index]
  }

  _getNextChain() {
    return new Chain(this.requestParams, this.interceptors, this.index + 1)
  }
}
```

### Link

link 是拦截器的管理器，负责管理拦截器数组，并触发 chain.proceed()
1.new Link 时传入的是洋葱模型的最核心实现
2.addInterceptor 添加拦截器
3.request 触发 chain.proceed()

案例
```ts
// packages/shared/src/native-apis.ts
// api 是小程序的 request 方法，比如微信的 wx.request，支付宝的 my.request，京东的 swan.request 等
const request = apis.request || getNormalRequest(global)
function taroInterceptor(chain) {
  return request(chain.requestParams)
}
// 使用 Link 来request的实现拦截器
const link = new taro.Link(taroInterceptor)
// 将 link 的 request 方法绑定到 taro.request 上
taro.request = link.request.bind(link)
// 将 link 的 addInterceptor 方法绑定到 taro.addInterceptor 上
taro.addInterceptor = link.addInterceptor.bind(link)
// 将 link 的 cleanInterceptors 方法绑定到 taro.cleanInterceptors 上
taro.cleanInterceptors = link.cleanInterceptors.bind(link)
```

### interceptorify

> 包裹 promiseify api 的洋葱圈模型

> 它把一个普通的 API（taro.showModal），升级成了一个可插拔、可扩展、可复用、可多层拦截的“洋葱模型 API”
> 你以后可以对这个 API 做各种增强，而不用改原本的 showModal。

```ts
// 使用 interceptorify 包裹 taro.showModal ，可以添加拦截器
// 使用 modalInterceptorify.request 执行整个洋葱圈模型
// 比如
const modalInterceptorify = interceptorify(taro.showModal)
// 添加拦截器
modalInterceptorify.addInterceptor(async function (chain) {
  // ① 给所有 Modal 统一加国际化
  chain.requestParams.title = t(chain.requestParams.title)
  const res = await chain.proceed(chain.requestParams)
  return res
})
modalInterceptorify.addInterceptor(async function (chain) {
  // ② 自动加上全局埋点
  // tracker('modal_show')
  const res = await chain.proceed({
    ...chain.requestParams,
    content: 'interceptor2',
  })
  return res
})
// ③ 自动加默认参数
modalInterceptorify.addInterceptor(async (chain) => {
  return chain.proceed({
    confirmColor: '#ff0000',
    ...chain.requestParams,
  })
})

// 使用
modalInterceptorify.request({})
```
