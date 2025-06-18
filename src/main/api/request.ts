import { net } from 'electron'
import { presenter } from '../presenter'
import { HttpsProxyAgent } from 'https-proxy-agent'

export interface RequestConfig extends RequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: HeadersInit
  body?: string | FormData | Buffer
  timeout?: number
  baseUrl?: string
  useElectronNet?: boolean // 是否使用 electron.net.fetch
  skipAuth?: boolean // 跳过自动认证
  agent?: HttpsProxyAgent<string> // 自定义 User-Agent
  [key: string]: any // 允许其他自定义配置
}

export interface RequestResponse<T = any> {
  ok: boolean
  status: number
  statusText: string
  data: T
  headers: Headers
}

class Request {
  private static instance: Request
  private defaultBaseUrl: string = ''
  private defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  private constructor(baseUrl?: string) {
    console.log('import.meta.env.VITE_BASE_API_URL', import.meta.env.VITE_BASE_API_URL);
    this.defaultBaseUrl = baseUrl ?? import.meta.env.VITE_BASE_API_URL
  }

  public static getInstance(): Request {
    if (!Request.instance) {
      Request.instance = new Request()
    }
    return Request.instance
  }

  /**
   * 获取默认认证头（只使用全局认证token）
   */
  private getAuthHeaders(): Record<string, string> {
    try {
      const authToken = presenter.configPresenter.getAuthToken()
      if (authToken) {
        return { 'Authorization': `Bearer ${authToken}` }
      }
    } catch (error) {
      console.warn('Failed to get auth headers:', error)
    }

    return {}
  }

  /**
   * 规范化 headers 为 Record<string, string> 格式
   */
  private normalizeHeaders(headers?: HeadersInit): Record<string, string> {
    if (!headers) return {}
    
    if (Array.isArray(headers)) {
      return Object.fromEntries(headers)
    }
    
    if (headers instanceof Headers) {
      const result: Record<string, string> = {}
      headers.forEach((value, key) => {
        result[key] = value
      })
      return result
    }
    
    return headers as Record<string, string>
  }

  /**
   * 构建完整的 URL
   */
  private buildUrl(url: string, baseUrl?: string): string {
    // 如果是完整的 URL（包含 http:// 或 https://），直接返回
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }

    // 使用传入的 baseUrl 或默认的 baseUrl
    const finalBaseUrl = baseUrl || this.defaultBaseUrl

    // 确保 baseUrl 不以 / 结尾，url 以 / 开头
    const cleanBaseUrl = finalBaseUrl.replace(/\/+$/, '')
    const cleanUrl = url.startsWith('/') ? url : `/${url}`

    return `${cleanBaseUrl}${cleanUrl}`
  }

  /**
   * 执行请求
   */
  public async request<T = any>(url: string, config: RequestConfig = {}): Promise<RequestResponse<T>> {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = 30000,
      baseUrl,
      useElectronNet = true,
      skipAuth = false
    } = config

    // 构建完整 URL
    const fullUrl = this.buildUrl(url, baseUrl)

    // 合并请求头：默认头 + 认证头 + 自定义头
    let finalHeaders = { ...this.defaultHeaders }

    // 如果没有跳过认证，自动添加认证头
    if (!skipAuth) {
      const authHeaders = this.getAuthHeaders()
      finalHeaders = { ...finalHeaders, ...authHeaders }
    }

    // 最后合并用户提供的自定义头（优先级最高）
    finalHeaders = { ...finalHeaders, ...this.normalizeHeaders(headers) }

    // 构建请求选项
    const requestOptions: RequestInit = {
      method,
      headers: finalHeaders
    }

    if (body) {
      requestOptions.body = body
    }

    // 选择使用 electron.net.fetch 还是普通 fetch
    const fetchFn = useElectronNet ? net.fetch : fetch

    let response: Response

    try {
      // 设置超时
      if (timeout > 0) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)
        requestOptions.signal = controller.signal

        response = await fetchFn(fullUrl, requestOptions)
        clearTimeout(timeoutId)
      } else {
        response = await fetchFn(fullUrl, requestOptions)
      }

      // 尝试解析响应数据
      let data: T
      const contentType = response.headers.get('content-type')

      if (contentType?.includes('application/json')) {
        data = await response.json()
      } else if (contentType?.includes('text/')) {
        data = await response.text() as T
      } else {
        // 对于二进制数据，返回 ArrayBuffer
        data = await response.arrayBuffer() as T
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
        headers: response.headers
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Request timeout: ${timeout}ms`)
        }
        throw new Error(`Request failed: ${error.message}`)
      }
      throw new Error('Unknown request error')
    }
  }

  /**
   * GET 请求
   */
  public async get<T = any>(url: string, config: Omit<RequestConfig, 'method' | 'body'> = {}): Promise<RequestResponse<T>> {
    return this.request<T>(url, { ...config, method: 'GET' })
  }

  /**
   * POST 请求
   */
  public async post<T = any>(url: string, data?: any, config: Omit<RequestConfig, 'method'> = {}): Promise<RequestResponse<T>> {
    let body: string | FormData | Buffer | undefined

    if (data) {
      if (data instanceof FormData || data instanceof Buffer) {
        body = data
      } else if (typeof data === 'object') {
        body = JSON.stringify(data)
      } else {
        body = data
      }
    }

    return this.request<T>(url, { ...config, method: 'POST', body })
  }

  /**
   * PUT 请求
   */
  public async put<T = any>(url: string, data?: any, config: Omit<RequestConfig, 'method'> = {}): Promise<RequestResponse<T>> {
    let body: string | FormData | Buffer | undefined

    if (data) {
      if (data instanceof FormData || data instanceof Buffer) {
        body = data
      } else if (typeof data === 'object') {
        body = JSON.stringify(data)
      } else {
        body = data
      }
    }

    return this.request<T>(url, { ...config, method: 'PUT', body })
  }

  /**
   * DELETE 请求
   */
  public async delete<T = any>(url: string, config: Omit<RequestConfig, 'method' | 'body'> = {}): Promise<RequestResponse<T>> {
    return this.request<T>(url, { ...config, method: 'DELETE' })
  }

  /**
   * 下载文件 (返回 Buffer)
   */
  public async download(url: string, config: Omit<RequestConfig, 'method' | 'body'> = {}): Promise<Buffer> {
    const response = await this.request<ArrayBuffer>(url, {
      ...config,
      method: 'GET',
      useElectronNet: config.useElectronNet ?? true // 下载文件默认使用 electron.net.fetch
    })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    return Buffer.from(response.data)
  }

  /**
   * 获取原始 Response 对象，不解析 body
   */
  public async getRaw(url: string, config: RequestConfig = {}): Promise<Response> {
    const {
      method,
      headers = {},
      timeout = 30000,
      baseUrl,
      useElectronNet = true,
      skipAuth = false
    } = config

    // 构建完整 URL
    const fullUrl = this.buildUrl(url, baseUrl)

    // 合并请求头：默认头 + 认证头 + 自定义头
    let finalHeaders = { ...this.defaultHeaders }

    // 如果没有跳过认证，自动添加认证头
    if (!skipAuth) {
      const authHeaders = this.getAuthHeaders()
      finalHeaders = { ...finalHeaders, ...authHeaders }
    }

    // 最后合并用户提供的自定义头（优先级最高）
    finalHeaders = { ...finalHeaders, ...this.normalizeHeaders(headers) }

    // 构建请求选项
    const requestOptions: RequestInit = {
      method,
      headers: finalHeaders
    }

    // 选择使用 electron.net.fetch 还是普通 fetch
    const fetchFn = useElectronNet ? net.fetch : fetch

    try {
      // 设置超时
      if (timeout > 0) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)
        requestOptions.signal = controller.signal

        const response = await fetchFn(fullUrl, requestOptions)
        clearTimeout(timeoutId)
        return response
      } else {
        return await fetchFn(fullUrl, requestOptions)
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Request timeout: ${timeout}ms`)
        }
        throw new Error(`Request failed: ${error.message}`)
      }
      throw new Error('Unknown request error')
    }
  }

  /**
   * 获取 Blob 数据
   */
  public async getBlob(url: string, config: Omit<RequestConfig, 'method' | 'body'> = {}): Promise<Blob> {
    const response = await this.getRaw(url, config)
    
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    
    return await response.blob()
  }

  /**
   * 获取 ArrayBuffer 数据
   */
  public async getArrayBuffer(url: string, config: Omit<RequestConfig, 'method' | 'body'> = {}): Promise<ArrayBuffer> {
    const response = await this.getRaw(url, config)
    
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    
    return await response.arrayBuffer()
  }

  /**
   * 获取文本数据
   */
  public async getText(url: string, config: Omit<RequestConfig, 'method' | 'body'> = {}): Promise<string> {
    const response = await this.getRaw(url, config)
    
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    
    return await response.text()
  }
}

// 导出单例实例
export const request = Request.getInstance()
