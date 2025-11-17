## taro-h5 是通过 taro 来自己实现了类似小程序的API
> 🚀 为什么 H5 不需要 processApis？
>
> 因为：
>
> ✔ H5 本身就没有一个统一的全局 API 对象给你处理
>
> 不像小程序那样：
>
> ● wx.xxxxxx
> ● my.xxxxxx
>
> H5 没有：
>
> ❌ window.getLocation
> ❌ window.chooseImage
> ❌ window.scanCode
>
> 所以 processApis 没有意义。
>
> ✔ 在 H5 中，每个 API 是 Taro 自己提供的
>
> 根本不是“平台提供 → Taro 适配”，
> 而是“Taro 自己实现 → 模拟小程序 API”。

## 案例
### Taro.request
```ts
Taro.request({
  url: 'https://example.com',
  method: 'GET',
  data: {
    name: 'Taro'
  }
})
```

#### 实现原理
> 微信小程序中，wx.request 的实现了以下能力：
> 1. 使用 wx.request 发起网络请求
> 2. 返回一个 RequestTask 对象
> 3. RequestTask 对象有以下方法：
>   - abort()：终止请求
>   - onHeadersReceived()监听 HTTP Response Header 事件。会比请求完成事件更早
>   - 等等…


那么在h5中，就需要实现类似的能力，所以h5中Taro.request 的实现原理是：
1. 使用 fetch 发起网络请求
2. 使用 window.AbortController https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController 来实现了 abort 方法
3. 并不是所有的wx.request 的 API 返回的 RequestTask 对象都支持的方法都实现了，而是根据需要实现了部分方法


#### 实现细则
1. 在taro中使用洋葱模型来实现拦截器 addInterceptor
2. h5中也是使用Link（packages/taro-api/src/interceptor/index.ts） 来实现拦截器，类似于小程序的拦截器
3. Link 使用Chain 来实现洋葱模型 （packages/taro-api/src/interceptor/chain.ts）
4. 在Link中保存一个核心拦截器，确保核心拦截器最后执行
5. 在h5 request中的核心拦截器（taroInterceptor）就是使用fetch实现的request方法


##### _request
> _request 是h5中request的核心实现，使用fetch实现请求的发起
```ts
function _request (options: Partial<Taro.request.Option> = {}) {
  const { success, complete, fail } = options
  const params: RequestInit = {}
  const res: any = {}
  let {
    cache = 'default',
    credentials,
    data, dataType,
    header = {},
    jsonp,
    method = 'GET',
    mode,
    responseType,
    signal,
    timeout,
    url = '',
    ...opts
  } = options
  if (typeof timeout !== 'number') {
    timeout = NETWORK_TIMEOUT
  }
  Object.assign(params, opts)
  if (jsonp) {
    // @ts-ignore
    params.params = data
    params.cache = opts.jsonpCache
    // @ts-ignore
    params.timeout = timeout
    if (typeof jsonp === 'string') {
      // @ts-ignore
      params.name = jsonp
    }
    // Note: https://github.com/luckyadam/jsonp-retry
    return jsonpRetry(url, params)
      .then(data => {
        res.statusCode = 200
        res.data = data
        isFunction(success) && success(res)
        isFunction(complete) && complete(res)
        return res
      })
      .catch(err => {
        isFunction(fail) && fail(err)
        isFunction(complete) && complete(res)
        return Promise.reject(err)
      })
  }
  params.method = method
  const methodUpper = params.method.toUpperCase()
  params.cache = cache
  if (methodUpper === 'GET' || methodUpper === 'HEAD') {
    url = generateRequestUrlWithParams(url, data)
  } else if (['[object Array]', '[object Object]'].indexOf(Object.prototype.toString.call(data)) >= 0) {
    const keyOfContentType = Object.keys(header).find(item => item.toLowerCase() === 'content-type')
    if (!keyOfContentType) {
      header['Content-Type'] = 'application/json'
    }
    const contentType = header[keyOfContentType || 'Content-Type']

    if (contentType.indexOf('application/json') >= 0) {
      params.body = JSON.stringify(data)
    } else if (contentType.indexOf('application/x-www-form-urlencoded') >= 0) {
      params.body = serializeParams(data)
    } else {
      params.body = data
    }
  } else {
    params.body = data
  }
  if (header) {
    params.headers = header
  }
  if (mode) {
    params.mode = mode
  }
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  if (signal) {
    params.signal = signal
  } else {
    controller = new window.AbortController()
    params.signal = controller.signal
    timeoutTimer = setTimeout(function () {
      if (controller) controller.abort()
    }, timeout)
  }
  params.credentials = credentials
  const p: RequestTask<any> = fetch(url, params)
    .then(response => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
      }
      if (controller) {
        controller = null
      }
      if (!response) {
        const errorResponse = { ok: false }
        throw errorResponse
      }
      res.statusCode = response.status
      res.header = {}
      for (const key of response.headers.keys()) {
        res.header[key] = response.headers.get(key)
      }
      if (responseType === 'arraybuffer') {
        return response.arrayBuffer()
      }
      if (res.statusCode !== 204) {
        if (dataType === 'json' || typeof dataType === 'undefined') {
          return response.json().catch(() => {
            return null
          })
        }
      }
      if (responseType === 'text' || dataType === 'text') {
        return response.text()
      }
      return Promise.resolve(null)
    })
    .then(data => {
      res.data = data
      isFunction(success) && success(res)
      isFunction(complete) && complete(res)
      return res
    })
    .catch(err => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
      }
      if (controller) {
        controller = null
      }
      isFunction(fail) && fail(err)
      isFunction(complete) && complete(res)
      err.statusCode = res.statusCode
      err.errMsg = err.message
      return Promise.reject(err)
    })
  if (!p.abort && controller) {
    p.abort = cb => {
      if (controller) {
        cb && cb()
        controller.abort()
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
          timeoutTimer = null
        }
      }
    }
  }
  return p
}
```


##### taro.request
> taro.request 使用 将_request 作为Link的taroInterceptor来实现拦截器
> 这样就支持addInterceptor 来添加拦截器


```ts
function taroInterceptor (chain) {
  return _request(chain.requestParams)
}

const link = new Link(taroInterceptor)

export const request = (<T extends Partial<Taro.request.Option> = TaroGeneral.IAnyObject>(...args: [string | T, T]) => {
  const [url = '', options = {} as T] = args
  if (typeof url === 'string') {
    options.url = url
  } else {
    Object.assign(options, url)
  }
  return link.request(options)
}) as typeof Taro.request
export const addInterceptor = link.addInterceptor.bind(link)
export const cleanInterceptors = link.cleanInterceptors.bind(link)

```