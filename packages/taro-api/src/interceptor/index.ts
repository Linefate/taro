import Chain from './chain'

import type { IRequestParams, TInterceptor } from './chain'

// 管理拦截器列表冰并触发Chain.proceed
// ✔ 管理拦截器数组（Chain 的 interceptors）
// ✔ 保证最后一个拦截器是核心实现（避免被覆盖）
// ✔ 对外提供 request() 方法来触发 chain.proceed()
// ✅ 一个“洋葱工厂”：接收一堆拦截器 → 加入核心拦截器 → 生成洋葱 → 执行它
// ✔ 允许额外添加拦截器（中间件）
export default class Link {
  taroInterceptor: TInterceptor
  chain: Chain

  constructor (interceptor: TInterceptor) {
    this.taroInterceptor = interceptor
    this.chain = new Chain()
  }
  
  request (requestParams: IRequestParams) {
    const chain = this.chain
    // 保存一个核心拦截器
    const taroInterceptor = this.taroInterceptor

    // 即使之前 addInterceptor 添加了很多拦截器，也会确保“核心拦截器”最后执行。
    // 因为把 taroInterceptor 放到最后面了
    chain.interceptors = chain.interceptors
      .filter(interceptor => interceptor !== taroInterceptor)
      .concat(taroInterceptor)

    return chain.proceed({ ...requestParams })
  }

  addInterceptor (interceptor: TInterceptor) {
    this.chain.interceptors.push(interceptor)
  }

  cleanInterceptors () {
    this.chain = new Chain()
  }
}

export function interceptorify (promiseifyApi) {
  return new Link(function (chain) {
    return promiseifyApi(chain.requestParams)
  })
}
