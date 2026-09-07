import logger from '@shared/logger'
import { session } from 'electron'
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

// 先简单处理，用系统代理
export enum ProxyMode {
  SYSTEM = 'system',
  NONE = 'none',
  CUSTOM = 'custom'
}
export const NO_PROXY =
  'localhost, 127.0.0.1, ::1, 192.168.*.*, 10.*.*.*, *.local, host.docker.internal'
// const NO_PROXY = ''

// undici's default Agent uses headersTimeout 300s. 0 disables it so slow first-token
// providers (local Ollama) are bounded by the model timeout instead.
export const FETCH_DISPATCHER_TIMEOUTS = {
  headersTimeout: 0,
  bodyTimeout: 0
} as const

export function createGlobalFetchDispatcher(proxy?: {
  httpProxy: string
  httpsProxy: string
  noProxy: string
}): Agent | EnvHttpProxyAgent {
  if (proxy) {
    return new EnvHttpProxyAgent({
      httpProxy: proxy.httpProxy,
      httpsProxy: proxy.httpsProxy,
      noProxy: proxy.noProxy,
      ...FETCH_DISPATCHER_TIMEOUTS
    })
  }
  return new Agent(FETCH_DISPATCHER_TIMEOUTS)
}

// Merge app defaults with the process inherited no_proxy snapshot, not live env.
// resolve can write NO_PROXY then later clear it; live env would lose the original.
function mergeNoProxy(defaultNoProxy: string, inheritedNoProxy: string): string {
  logger.info('systemNoProxy', inheritedNoProxy)
  if (!inheritedNoProxy) {
    return defaultNoProxy
  }
  const noProxySet = new Set(
    [
      ...defaultNoProxy.split(',').map((item) => item.trim()),
      ...inheritedNoProxy.split(',').map((item) => item.trim())
    ].filter(Boolean)
  )

  return Array.from(noProxySet).join(', ')
}

export class ProxyConfig {
  private proxyUrl: string | null = null
  private mode: ProxyMode = ProxyMode.SYSTEM
  private customProxyUrl: string = ''
  private resolutionPromise: Promise<boolean> = Promise.resolve(true)
  private dispatcherInstalled = false
  private readonly inheritedNoProxy = process.env.no_proxy || process.env.NO_PROXY || ''

  resolveProxy(): Promise<boolean> {
    const mode = this.mode
    const customProxyUrl = this.customProxyUrl
    const resolution = this.resolutionPromise.then(
      () => this.resolveProxyNow(mode, customProxyUrl),
      () => this.resolveProxyNow(mode, customProxyUrl)
    )
    this.resolutionPromise = resolution
    return resolution
  }

  private ensureTimeoutDispatcher(): void {
    if (this.dispatcherInstalled) {
      return
    }
    setGlobalDispatcher(createGlobalFetchDispatcher())
    this.dispatcherInstalled = true
  }

  whenReady(): Promise<boolean> {
    return this.resolutionPromise
  }

  private async resolveProxyNow(mode: ProxyMode, customProxyUrl: string): Promise<boolean> {
    try {
      this.ensureTimeoutDispatcher()
      // 根据不同的代理模式设置
      if (mode === ProxyMode.NONE) {
        await this.clearProxy()
        logger.info('clear proxy')
        return false
      } else if (mode === ProxyMode.CUSTOM && customProxyUrl) {
        logger.info('proxy url', customProxyUrl)
        await this.setCustomProxy(customProxyUrl)
        return false
      }

      // 系统代理模式
      await session.defaultSession.setProxy({ mode: 'system' })
      const proxyString = await session.defaultSession.resolveProxy('https://www.google.com')
      const [protocol, address] = proxyString.split(';')[0].split(' ')
      logger.info('proxy url', protocol, address)
      const resolvedProxyUrl =
        protocol === 'PROXY' && address?.trim() ? `http://${address.trim()}` : null

      if (resolvedProxyUrl) {
        const mergedNoProxy = mergeNoProxy(NO_PROXY, this.inheritedNoProxy)
        setGlobalDispatcher(
          createGlobalFetchDispatcher({
            httpProxy: resolvedProxyUrl,
            httpsProxy: resolvedProxyUrl,
            noProxy: mergedNoProxy
          })
        )
        this.commitResolvedProxy(resolvedProxyUrl, mergedNoProxy)
      } else {
        setGlobalDispatcher(createGlobalFetchDispatcher())
        this.proxyUrl = null
        this.clearProxyEnv()
      }
      return true
    } catch (error) {
      console.error('Failed to resolve proxy:', error)
      // Leave the last good dispatcher in place. Recreating it here leaks the
      // previous pool and can drop a working proxy after a later resolve fails.
      return false
    }
  }

  private clearProxyEnv(): void {
    delete process.env.http_proxy
    delete process.env.https_proxy
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.GRPC_PROXY
    delete process.env.grpc_proxy
    delete process.env.no_proxy
    delete process.env.NO_PROXY
  }

  private async clearProxy(): Promise<void> {
    await session.defaultSession.setProxy({ mode: 'direct' })
    this.proxyUrl = null
    this.clearProxyEnv()
    setGlobalDispatcher(createGlobalFetchDispatcher())
  }

  private commitResolvedProxy(proxyUrl: string, mergedNoProxy: string): void {
    this.proxyUrl = proxyUrl
    process.env.http_proxy = proxyUrl
    process.env.https_proxy = proxyUrl
    process.env.HTTP_PROXY = proxyUrl
    process.env.HTTPS_PROXY = proxyUrl
    process.env.GRPC_PROXY = proxyUrl
    process.env.grpc_proxy = proxyUrl
    process.env.no_proxy = mergedNoProxy
    process.env.NO_PROXY = mergedNoProxy
  }

  private async setCustomProxy(proxyUrl: string): Promise<void> {
    await session.defaultSession.setProxy({ proxyRules: proxyUrl })
    const mergedNoProxy = mergeNoProxy(NO_PROXY, this.inheritedNoProxy)
    setGlobalDispatcher(
      createGlobalFetchDispatcher({
        httpProxy: proxyUrl,
        httpsProxy: proxyUrl,
        noProxy: mergedNoProxy
      })
    )
    this.commitResolvedProxy(proxyUrl, mergedNoProxy)
  }

  /**
   * 验证代理URL是否有效
   * @param url 要验证的代理URL
   * @returns 是否是有效的代理URL
   */
  isValidProxyUrl(url: string): boolean {
    if (!url || url.trim() === '') {
      return false
    }

    try {
      // 检查URL格式，确保开头是http://或https://
      const urlPattern =
        /^(http|https):\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(:[0-9]+)?(\/[^\s]*)?$/
      if (!urlPattern.test(url)) {
        return false
      }

      // 尝试解析URL
      const parsedUrl = new URL(url)
      // 确保端口号是有效的数字（如果有指定端口）
      if (parsedUrl.port && isNaN(parseInt(parsedUrl.port))) {
        return false
      }

      return true
    } catch (error) {
      console.error('Invalid proxy URL:', error)
      return false
    }
  }

  getProxyUrl(): string | null {
    return this.proxyUrl
  }

  getProxyMode(): ProxyMode {
    return this.mode
  }

  setProxyMode(mode: ProxyMode): void {
    this.mode = mode
  }

  getCustomProxyUrl(): string {
    return this.customProxyUrl
  }

  setCustomProxyUrl(url: string): void {
    // 只设置有效的URL，否则保留原有值
    if (this.isValidProxyUrl(url) || url.trim() === '') {
      this.customProxyUrl = url
    } else {
      console.warn('Invalid proxy URL format:', url)
    }
  }

  // 从配置初始化代理设置
  initFromConfig(mode: string, customUrl: string): void {
    this.mode =
      mode === ProxyMode.NONE
        ? ProxyMode.NONE
        : mode === ProxyMode.CUSTOM
          ? ProxyMode.CUSTOM
          : ProxyMode.SYSTEM
    // 如果是自定义模式，验证URL有效性
    if (mode === ProxyMode.CUSTOM && customUrl) {
      if (this.isValidProxyUrl(customUrl)) {
        this.customProxyUrl = customUrl
      } else {
        console.warn('Invalid custom proxy URL in config, fallback to system proxy mode')
        this.mode = ProxyMode.SYSTEM
      }
    }
    this.ensureTimeoutDispatcher()
    void this.resolveProxy()
  }
}
export const proxyConfig = new ProxyConfig()
