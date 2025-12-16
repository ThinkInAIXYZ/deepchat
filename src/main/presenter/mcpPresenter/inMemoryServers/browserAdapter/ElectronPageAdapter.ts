import { BrowserWindow, WebContents } from 'electron'

export interface WaitForSelectorOptions {
  timeout?: number
}

export interface WaitForNetworkIdleOptions {
  timeout?: number
  idleTime?: number
}

export interface ScreenshotOptions {
  selector?: string
  fullPage?: boolean
  highlightSelectors?: string[]
}

export interface ScrollOptions {
  x?: number
  y?: number
  behavior?: 'auto' | 'smooth'
}

export interface ClickableElement {
  selector: string
  tag: string
  text: string
  ariaLabel?: string
}

class ElectronElementHandle {
  private readonly selector: string
  private readonly page: ElectronPageAdapter

  constructor(selector: string, page: ElectronPageAdapter) {
    this.selector = selector
    this.page = page
  }

  async evaluate<T>(fn: (element: Element, ...args: any[]) => T, ...args: any[]): Promise<T> {
    return this.page.evaluate(
      (selector, serializedFn, fnArgs) => {
        const element = document.querySelector(selector)
        if (!element) {
          throw new Error(`Element not found for selector: ${selector}`)
        }
        // eslint-disable-next-line no-new-func
        const callable = new Function(
          'element',
          'args',
          `return (${serializedFn})(element, ...args)`
        )
        return callable(element, fnArgs)
      },
      this.selector,
      fn.toString(),
      args
    )
  }
}

export class ElectronPageAdapter {
  private readonly window: BrowserWindow
  private readonly webContents: WebContents

  constructor(window: BrowserWindow) {
    this.window = window
    this.webContents = window.webContents
  }

  get id(): number {
    return this.window.id
  }

  get url(): string {
    return this.webContents.getURL()
  }

  get title(): string {
    return this.webContents.getTitle()
  }

  isDestroyed(): boolean {
    return this.window.isDestroyed() || this.webContents.isDestroyed()
  }

  focus(): void {
    if (!this.window.isDestroyed()) {
      this.window.focus()
    }
  }

  close(): void {
    if (!this.window.isDestroyed()) {
      this.window.close()
    }
  }

  async goto(url: string): Promise<void> {
    this.ensureAvailable()
    await this.webContents.loadURL(url)
    await this.waitForNetworkIdle()
  }

  async reload(): Promise<void> {
    this.ensureAvailable()
    this.webContents.reload()
    await this.waitForNetworkIdle()
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

  async evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
    this.ensureAvailable()
    const serializedArgs = JSON.stringify(args, (_key, value) =>
      value === undefined ? null : value
    )
    const script = `(${fn.toString()})(...${serializedArgs})`
    return this.webContents.executeJavaScript(script, true)
  }

  async waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<boolean> {
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

  async waitForNetworkIdle(options?: WaitForNetworkIdleOptions): Promise<void> {
    this.ensureAvailable()
    const timeout = options?.timeout ?? 15000
    const idleTime = options?.idleTime ?? 800

    return new Promise((resolve, reject) => {
      if (this.isDestroyed()) {
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

  $(selector: string): ElectronElementHandle {
    return new ElectronElementHandle(selector, this)
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

  async scroll(options?: ScrollOptions): Promise<void> {
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

  async getClickableElements(maxCount: number = 50): Promise<ClickableElement[]> {
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

  async screenshot(options?: ScreenshotOptions): Promise<string> {
    this.ensureAvailable()
    const highlightSelectors = options?.highlightSelectors || []
    let cleanup: (() => Promise<void>) | null = null

    if (highlightSelectors.length > 0) {
      cleanup = await this.highlightElements(highlightSelectors)
    }

    try {
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

      const image = await this.webContents.capturePage()
      return image.toPNG().toString('base64')
    } finally {
      if (cleanup) {
        await cleanup()
      }
    }
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

  private ensureAvailable(): void {
    if (this.isDestroyed()) {
      throw new Error('Page is no longer available')
    }
  }
}
