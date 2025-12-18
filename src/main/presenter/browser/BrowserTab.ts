import { WebContents } from 'electron'
import { nanoid } from 'nanoid'
import { BrowserTabStatus, type ScreenshotOptions } from '@shared/types/browser'
import { CDPManager } from './CDPManager'
import { ScreenshotManager } from './ScreenshotManager'

export class BrowserTab {
  readonly tabId: string
  readonly createdAt: number
  url = 'about:blank'
  title = ''
  favicon = ''
  status: BrowserTabStatus = BrowserTabStatus.Idle
  updatedAt: number
  private readonly webContents: WebContents
  private readonly cdpManager: CDPManager
  private readonly screenshotManager: ScreenshotManager
  private isAttached = false

  constructor(
    webContents: WebContents,
    cdpManager: CDPManager,
    screenshotManager: ScreenshotManager
  ) {
    this.tabId = nanoid(12)
    this.createdAt = Date.now()
    this.updatedAt = this.createdAt
    this.webContents = webContents
    this.cdpManager = cdpManager
    this.screenshotManager = screenshotManager
    this.url = webContents.getURL() || 'about:blank'
    this.title = webContents.getTitle() || ''
  }

  get contents(): WebContents {
    return this.webContents
  }

  async navigate(url: string, timeoutMs?: number): Promise<void> {
    this.status = BrowserTabStatus.Loading
    this.url = url
    this.updatedAt = Date.now()
    await this.ensureSession()
    try {
      await this.webContents.loadURL(url)
      await this.waitForLoad(timeoutMs)
      this.title = this.webContents.getTitle() || url
      this.status = BrowserTabStatus.Ready
      this.updatedAt = Date.now()
    } catch (error) {
      this.status = BrowserTabStatus.Error
      console.error(`[YoBrowser][${this.tabId}] navigate failed:`, error)
      throw error
    }
  }

  async extractDOM(selector?: string): Promise<string> {
    const session = await this.ensureSession()
    return await this.cdpManager.getDOM(session, selector)
  }

  async evaluateScript(script: string): Promise<unknown> {
    const session = await this.ensureSession()
    return await this.cdpManager.evaluateScript(session, script)
  }

  async takeScreenshot(options?: ScreenshotOptions): Promise<string> {
    await this.ensureSession()
    this.ensureAvailable()

    // Handle selector-based screenshot
    if (options?.selector) {
      const rect = await this.evaluate((selector) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) {
          return null
        }
        const { x, y, width, height } = element.getBoundingClientRect()
        return {
          x: Math.round(x + window.scrollX),
          y: Math.round(y + window.scrollY),
          width: Math.round(width),
          height: Math.round(height)
        }
      }, options.selector)

      if (!rect) {
        throw new Error(`Element not found for selector: ${options.selector}`)
      }

      const image = await this.webContents.capturePage(rect)
      return image.toPNG().toString('base64')
    }

    // Handle highlight selectors
    let cleanup: (() => Promise<void>) | null = null
    if (options?.highlightSelectors && options.highlightSelectors.length > 0) {
      cleanup = await this.highlightElements(options.highlightSelectors)
    }

    try {
      // Handle full page screenshot
      if (options?.fullPage) {
        const dimensions = await this.evaluate(() => ({
          width: Math.max(
            document.documentElement.scrollWidth,
            document.body?.scrollWidth || 0,
            window.innerWidth
          ),
          height: Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight || 0,
            window.innerHeight
          )
        }))

        const image = await this.webContents.capturePage({
          x: 0,
          y: 0,
          width: Math.min(dimensions.width, 20000),
          height: Math.min(dimensions.height, 20000)
        })
        return image.toPNG().toString('base64')
      }

      // Default screenshot
      const session = await this.ensureSession()
      return await this.screenshotManager.captureScreenshot(session, options)
    } finally {
      if (cleanup) {
        await cleanup()
      }
    }
  }

  async goBack(): Promise<void> {
    this.ensureAvailable()
    if (this.webContents.canGoBack()) {
      this.webContents.goBack()
      await this.waitForNetworkIdle()
    }
  }

  async goForward(): Promise<void> {
    this.ensureAvailable()
    if (this.webContents.canGoForward()) {
      this.webContents.goForward()
      await this.waitForNetworkIdle()
    }
  }

  async reload(): Promise<void> {
    this.ensureAvailable()
    this.webContents.reload()
    await this.waitForNetworkIdle()
  }

  async click(selector: string): Promise<void> {
    await this.evaluate((sel) => {
      const element = document.querySelector<HTMLElement>(sel)
      if (!element) {
        throw new Error(`Element not found for selector: ${sel}`)
      }
      element.click()
    }, selector)
  }

  async hover(selector: string): Promise<void> {
    await this.evaluate((sel) => {
      const element = document.querySelector<HTMLElement>(sel)
      if (!element) {
        throw new Error(`Element not found for selector: ${sel}`)
      }
      element.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          view: window
        })
      )
    }, selector)
  }

  async fill(selector: string, value: string, append: boolean = false): Promise<void> {
    await this.evaluate(
      (sel, text, shouldAppend) => {
        const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)
        if (!element) {
          throw new Error(`Element not found for selector: ${sel}`)
        }
        element.focus()
        if (shouldAppend) {
          element.value = `${element.value}${text}`
        } else {
          element.value = text
        }
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      },
      selector,
      value,
      append
    )
  }

  async select(selector: string, values: string | string[]): Promise<void> {
    const normalizedValues = Array.isArray(values) ? values : [values]
    await this.evaluate(
      (sel, targetValues) => {
        const element = document.querySelector<HTMLSelectElement>(sel)
        if (!element) {
          throw new Error(`Element not found for selector: ${sel}`)
        }
        const options = Array.from(element.options)
        let changed = false

        for (const option of options) {
          const shouldSelect =
            targetValues.includes(option.value) || targetValues.includes(option.text)
          if (option.selected !== shouldSelect) {
            option.selected = shouldSelect
            changed = true
          }
        }

        if (changed) {
          element.dispatchEvent(new Event('input', { bubbles: true }))
          element.dispatchEvent(new Event('change', { bubbles: true }))
        }
      },
      selector,
      normalizedValues
    )
  }

  async scroll(options?: { x?: number; y?: number; behavior?: 'auto' | 'smooth' }): Promise<void> {
    const x = options?.x ?? 0
    const y = options?.y ?? 0
    const behavior = options?.behavior ?? 'auto'

    await this.evaluate(
      (deltaX, deltaY, scrollBehavior) => {
        window.scrollBy({
          left: deltaX,
          top: deltaY,
          behavior: scrollBehavior
        })
      },
      x,
      y,
      behavior
    )
  }

  async pressKey(key: string, count: number = 1): Promise<void> {
    this.ensureAvailable()
    for (let i = 0; i < count; i += 1) {
      this.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
      this.webContents.sendInputEvent({ type: 'char', keyCode: key })
      this.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    }
  }

  async getInnerText(selector?: string): Promise<string> {
    return this.evaluate((sel) => {
      const target = sel ? document.querySelector<HTMLElement>(sel) : document.body
      return target?.innerText || ''
    }, selector)
  }

  async getHtml(selector?: string): Promise<string> {
    return this.evaluate((sel) => {
      const target = sel ? document.querySelector<HTMLElement>(sel) : document.documentElement
      return target?.outerHTML || ''
    }, selector)
  }

  async getLinks(maxCount: number = 50): Promise<Array<{ text: string; href: string }>> {
    const links = await this.evaluate(() => {
      const elements = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      return elements.map((el) => ({
        text: (el.innerText || el.title || el.getAttribute('aria-label') || '').trim(),
        href: el.href
      }))
    })

    return links.filter((item) => item.href).slice(0, maxCount)
  }

  async getClickableElements(
    maxCount: number = 50
  ): Promise<Array<{ selector: string; tag: string; text: string; ariaLabel?: string }>> {
    const elements = await this.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button, input, textarea, select, option, [role="button"], [onclick]'
        )
      )

      const buildSelector = (element: Element): string => {
        if (element.id) return `#${element.id}`
        const parts: string[] = []
        let current: Element | null = element
        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
          let selector = current.nodeName.toLowerCase()
          if (current.classList.length > 0) {
            selector += `.${Array.from(current.classList)
              .slice(0, 2)
              .map((cls) => cls.replace(/\s+/g, '-'))
              .join('.')}`
          }
          const parent = current.parentElement
          if (parent) {
            const siblings = Array.from(parent.children) as Element[]
            const matchingSiblings = siblings.filter(
              (child: Element) => child.nodeName === current!.nodeName
            )
            if (matchingSiblings.length > 1) {
              const index = matchingSiblings.indexOf(current) + 1
              selector += `:nth-of-type(${index})`
            }
          }
          parts.unshift(selector)
          current = parent
        }
        return parts.join(' > ')
      }

      return candidates.map((element) => ({
        selector: buildSelector(element),
        tag: element.tagName.toLowerCase(),
        text: (element.innerText || '').trim(),
        ariaLabel: element.getAttribute('aria-label') || undefined
      }))
    })

    return elements.slice(0, maxCount)
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<boolean> {
    this.ensureAvailable()
    const timeout = options?.timeout ?? 5000

    return this.evaluate(
      (sel, maxWait) =>
        new Promise<boolean>((resolve) => {
          const start = performance.now()
          const check = () => {
            if (document.querySelector(sel)) {
              resolve(true)
              return
            }
            if (performance.now() - start > maxWait) {
              resolve(false)
              return
            }
            requestAnimationFrame(check)
          }
          check()
        }),
      selector,
      timeout
    )
  }

  async waitForNetworkIdle(options?: { timeout?: number; idleTime?: number }): Promise<void> {
    this.ensureAvailable()
    const timeout = options?.timeout ?? 15000
    const idleTime = options?.idleTime ?? 800

    return new Promise((resolve, reject) => {
      if (this.webContents.isDestroyed()) {
        reject(new Error('Page was destroyed while waiting for network idle'))
        return
      }

      let lastActivity = Date.now()
      let resolved = false

      const onActivity = () => {
        lastActivity = Date.now()
      }

      const onDidStartLoading = () => onActivity()
      const onDidStopLoading = () => onActivity()
      const onDomReady = () => onActivity()

      const idleChecker = setInterval(() => {
        if (Date.now() - lastActivity >= idleTime && !resolved && !this.webContents.isLoading()) {
          cleanup()
          resolved = true
          resolve()
        }
      }, 200)

      const timer = setTimeout(() => {
        if (!resolved) {
          cleanup()
          reject(new Error('Timed out waiting for network idle'))
        }
      }, timeout)

      const cleanup = () => {
        clearInterval(idleChecker)
        clearTimeout(timer)
        this.webContents.removeListener('did-start-loading', onDidStartLoading)
        this.webContents.removeListener('did-stop-loading', onDidStopLoading)
        this.webContents.removeListener('dom-ready', onDomReady)
      }

      this.webContents.on('did-start-loading', onDidStartLoading)
      this.webContents.on('did-stop-loading', onDidStopLoading)
      this.webContents.on('dom-ready', onDomReady)
      onActivity()
    })
  }

  private async highlightElements(selectors: string[]): Promise<() => Promise<void>> {
    await this.evaluate((list) => {
      list.forEach((selector, index) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (element) {
          element.dataset.__deepchatOriginalOutline = element.style.outline
          element.style.outline = '2px solid #ff5f6d'
          element.style.outlineOffset = '2px'
          element.dataset.__deepchatHighlightIndex = String(index)
        }
      })
    }, selectors)

    return async () => {
      await this.evaluate(() => {
        document
          .querySelectorAll<HTMLElement>('[data-__deepchat-highlight-index]')
          .forEach((el) => {
            if (el.dataset.__deepchatOriginalOutline !== undefined) {
              el.style.outline = el.dataset.__deepchatOriginalOutline
            } else {
              el.style.outline = ''
            }
            delete el.dataset.__deepchatHighlightIndex
            delete el.dataset.__deepchatOriginalOutline
          })
      })
    }
  }

  private async evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
    this.ensureAvailable()
    const session = await this.ensureSession()
    const serializedArgs = JSON.stringify(args, (_key, value) =>
      value === undefined ? null : value
    )
    const script = `(${fn.toString()})(...${serializedArgs})`
    const result = await this.cdpManager.evaluateScript(session, script)
    return result as T
  }

  private ensureAvailable(): void {
    if (this.webContents.isDestroyed()) {
      throw new Error('Page is no longer available')
    }
  }

  async waitForLoad(timeoutMs: number = 30000): Promise<void> {
    // Check if webContents is destroyed
    if (this.webContents.isDestroyed()) {
      throw new Error('WebContents destroyed')
    }

    // If not loading, return immediately
    if (!this.webContents.isLoading()) {
      return
    }

    // Wait for load with timeout
    let settled = false
    let domReadyFired = false
    let timeoutId: NodeJS.Timeout | null = null
    let onStopLoading: (() => void) | null = null
    let onDomReady: (() => void) | null = null
    let onFinishLoad: (() => void) | null = null
    let onFailLoad: ((...args: any[]) => void) | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (onStopLoading) {
        this.webContents.removeListener('did-stop-loading', onStopLoading)
      }
      if (onDomReady) {
        this.webContents.removeListener('dom-ready', onDomReady)
      }
      if (onFinishLoad) {
        this.webContents.removeListener('did-finish-load', onFinishLoad)
      }
      if (onFailLoad) {
        this.webContents.removeListener('did-fail-load', onFailLoad as any)
      }
    }

    const settle = (handler: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      handler()
    }

    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        onStopLoading = () => settle(resolvePromise)

        onDomReady = () => {
          domReadyFired = true
        }

        onFinishLoad = () => settle(resolvePromise)

        onFailLoad = (_event: unknown, errorCode: number, errorDescription: string) => {
          settle(() =>
            rejectPromise(new Error(`Navigation failed ${errorCode}: ${errorDescription}`))
          )
        }

        timeoutId = setTimeout(() => {
          if (domReadyFired) {
            settle(resolvePromise)
            return
          }
          settle(() => rejectPromise(new Error('Timed out waiting for page load')))
        }, timeoutMs)

        this.webContents.once('did-stop-loading', onStopLoading)
        this.webContents.once('dom-ready', onDomReady)
        this.webContents.once('did-finish-load', onFinishLoad)
        this.webContents.once('did-fail-load', onFailLoad as any)
      })
    } catch (error) {
      if (!settled) {
        cleanup()
      }
      throw error
    }
  }

  destroy(): void {
    if (this.webContents.debugger && this.webContents.debugger.isAttached()) {
      try {
        this.webContents.debugger.detach()
      } catch (error) {
        console.warn(`[YoBrowser][${this.tabId}] failed to detach debugger:`, error)
      }
    }
  }

  private async ensureSession() {
    if (this.webContents.isDestroyed()) {
      throw new Error('WebContents destroyed')
    }

    if (!this.isAttached) {
      try {
        await this.cdpManager.createSession(this.webContents)
        this.isAttached = true
      } catch (error) {
        console.error(`[YoBrowser][${this.tabId}] failed to create CDP session`, error)
        throw error
      }
    }
    return this.webContents.debugger
  }
}
