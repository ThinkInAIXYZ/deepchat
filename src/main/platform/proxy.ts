import logger from '@shared/logger'
import { session } from 'electron'
import { setGlobalDispatcher } from 'undici'
import { applyProxyEnvironment, createGlobalFetchDispatcher } from './fetchDispatcher'
import type { CoreProxySnapshot } from '@shared/harness/desktop'
export { FETCH_DISPATCHER_TIMEOUTS, createGlobalFetchDispatcher } from './fetchDispatcher'
type Dispatcher = ReturnType<typeof createGlobalFetchDispatcher>

// 先简单处理，用系统代理
export enum ProxyMode {
  SYSTEM = 'system',
  NONE = 'none',
  CUSTOM = 'custom'
}
export const NO_PROXY =
  'localhost, 127.0.0.1, ::1, 192.168.*.*, 10.*.*.*, *.local, host.docker.internal'
// const NO_PROXY = ''

// Merge app defaults with the process inherited no_proxy snapshot, not live env.
// resolve can write NO_PROXY then later clear it; live env would lose the original.
function mergeNoProxy(defaultNoProxy: string, inheritedNoProxy: string): string {
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
  private version = 0
  private noProxy = ''
  private proxyUrl: string | null = null
  private mode: ProxyMode = ProxyMode.SYSTEM
  private customProxyUrl: string = ''
  private resolutionPromise: Promise<boolean> = Promise.resolve(true)
  private dispatcher: Dispatcher | undefined
  private readonly retiring = new Map<Dispatcher, Promise<void>>()
  private closing: Promise<void> | undefined
  private failure: Error | undefined
  private readonly inheritedNoProxy = process.env.no_proxy || process.env.NO_PROXY || ''

  constructor(
    private readonly failed: (error: Error) => void = (error) =>
      logger.warn('[Proxy] HTTP dispatcher retirement failed', error)
  ) {}

  private assertActive(): void {
    if (this.failure) throw this.failure
    if (this.closing) throw new Error('Native HTTP is stopping')
  }

  private replaceDispatcher(next: Dispatcher): void {
    this.assertActive()
    const previous = this.dispatcher
    setGlobalDispatcher(next)
    this.dispatcher = next
    if (previous) {
      const retirement = previous
        .close()
        .catch(async () => await previous.destroy())
        .then(() => {
          this.retiring.delete(previous)
        })
      this.retiring.set(previous, retirement)
      void retirement.catch((error) => {
        this.failure =
          error instanceof Error
            ? error
            : new Error('Native HTTP retirement failed', { cause: error })
        if (!this.closing) this.failed(this.failure)
      })
    }
  }

  async resolveProxy(): Promise<boolean> {
    this.assertActive()
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
    this.assertActive()
    if (this.dispatcher) {
      return
    }
    this.replaceDispatcher(createGlobalFetchDispatcher())
  }

  async whenReady(): Promise<boolean> {
    this.assertActive()
    const result = await this.resolutionPromise
    this.assertActive()
    return result
  }

  private async resolveProxyNow(mode: ProxyMode, customProxyUrl: string): Promise<boolean> {
    try {
      this.assertActive()
      this.ensureTimeoutDispatcher()
      // 根据不同的代理模式设置
      if (mode === ProxyMode.NONE) {
        await this.clearProxy()
        logger.info('clear proxy')
        return false
      } else if (mode === ProxyMode.CUSTOM && customProxyUrl) {
        await this.setCustomProxy(customProxyUrl)
        return false
      }

      // 系统代理模式
      await session.defaultSession.setProxy({ mode: 'system' })
      this.assertActive()
      const proxyString = await session.defaultSession.resolveProxy('https://www.google.com')
      this.assertActive()
      const [protocol, address] = proxyString.split(';')[0].split(' ')
      const resolvedProxyUrl =
        protocol === 'PROXY' && address?.trim() ? `http://${address.trim()}` : null

      if (resolvedProxyUrl) {
        const mergedNoProxy = mergeNoProxy(NO_PROXY, this.inheritedNoProxy)
        this.replaceDispatcher(
          createGlobalFetchDispatcher({
            httpProxy: resolvedProxyUrl,
            httpsProxy: resolvedProxyUrl,
            noProxy: mergedNoProxy
          })
        )
        this.commitResolvedProxy(resolvedProxyUrl, mergedNoProxy)
      } else {
        this.replaceDispatcher(createGlobalFetchDispatcher())
        this.proxyUrl = null
        this.noProxy = ''
        this.version++
        applyProxyEnvironment(null, '')
      }
      return true
    } catch (error) {
      if (this.closing || this.failure) throw error
      console.error('Failed to resolve proxy:', error)
      // Leave the last good dispatcher in place. Recreating it here leaks the
      // previous pool and can drop a working proxy after a later resolve fails.
      return false
    }
  }

  private async clearProxy(): Promise<void> {
    await session.defaultSession.setProxy({ mode: 'direct' })
    this.assertActive()
    this.replaceDispatcher(createGlobalFetchDispatcher())
    this.proxyUrl = null
    this.noProxy = ''
    this.version++
    applyProxyEnvironment(null, '')
  }

  private commitResolvedProxy(proxyUrl: string, mergedNoProxy: string): void {
    this.proxyUrl = proxyUrl
    this.noProxy = mergedNoProxy
    this.version++
    applyProxyEnvironment(proxyUrl, mergedNoProxy)
  }

  private async setCustomProxy(proxyUrl: string): Promise<void> {
    await session.defaultSession.setProxy({ proxyRules: proxyUrl })
    this.assertActive()
    const mergedNoProxy = mergeNoProxy(NO_PROXY, this.inheritedNoProxy)
    this.replaceDispatcher(
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
    } catch {
      console.error('Invalid proxy URL')
      return false
    }
  }

  getProxyUrl(): string | null {
    return this.proxyUrl
  }

  async getProxySnapshot(): Promise<CoreProxySnapshot> {
    await this.whenReady()
    return { version: this.version, proxyUrl: this.proxyUrl, noProxy: this.noProxy }
  }

  getProxyMode(): ProxyMode {
    return this.mode
  }

  setProxyMode(mode: ProxyMode): void {
    this.assertActive()
    this.mode = mode
  }

  getCustomProxyUrl(): string {
    return this.customProxyUrl
  }

  setCustomProxyUrl(url: string): void {
    this.assertActive()
    // 只设置有效的URL，否则保留原有值
    if (this.isValidProxyUrl(url) || url.trim() === '') {
      this.customProxyUrl = url
    } else {
      console.warn('Invalid proxy URL format')
    }
  }

  // 从配置初始化代理设置
  initFromConfig(mode: string, customUrl: string): void {
    this.assertActive()
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
    void this.resolveProxy().catch((error) => {
      if (!this.closing && !this.failure) this.failed(error)
    })
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    const dispatchers = [...this.retiring.keys(), ...(this.dispatcher ? [this.dispatcher] : [])]
    const retirements = [...this.retiring.values()]
    const resolution = this.resolutionPromise.catch(() => {})
    this.closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        ...dispatchers.map(
          async (dispatcher) => await dispatcher.destroy(new Error('Native HTTP is stopping'))
        ),
        ...retirements
      ])
      await resolution
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []
      )
      if (errors.length) throw new AggregateError(errors, 'Native HTTP did not retire')
      this.retiring.clear()
      this.dispatcher = undefined
    })
    return this.closing
  }
}
