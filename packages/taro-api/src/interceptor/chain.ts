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
