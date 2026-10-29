import { BrowserWindow } from 'electron'
import { resolveFeishuAuthDomains } from '@/remote/channels/feishu/feishuAuth'
import type {
  RemoteAuthWindowEvent,
  RemoteAuthWindowInput,
  RemoteAuthWindowPort
} from '@/remote/ports'

export class DesktopRemoteAuthWindows implements RemoteAuthWindowPort {
  private readonly windows = new Map<
    string,
    { window: BrowserWindow; url: string; closed: Promise<void>; closing: boolean }
  >()

  constructor(private readonly publish: (event: RemoteAuthWindowEvent) => void) {}

  async open(input: RemoteAuthWindowInput): Promise<void> {
    if (input.kind === 'feishu' && !this.isAllowedFeishuNavigation(input.url, input))
      throw new Error('Invalid Feishu authorization URL')
    const existing = this.windows.get(input.id)
    if (existing) {
      if (existing.url !== input.url) throw new Error('Auth window identity is already in use')
      existing.window.show()
      existing.window.focus()
      return
    }
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const window = new BrowserWindow({
      width: input.kind === 'feishu' ? 480 : 420,
      height: 760,
      minWidth: input.kind === 'feishu' ? 420 : 380,
      minHeight: 680,
      autoHideMenuBar: true,
      title: input.kind === 'feishu' ? 'Feishu / Lark Authorization' : 'WeChat iLink Login',
      ...(parent ? { parent } : {}),
      webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true }
    })
    const closed = Promise.withResolvers<void>()
    const entry = { window, url: input.url, closed: closed.promise, closing: false }
    this.windows.set(input.id, entry)
    window.on('close', () => {
      entry.closing = true
    })
    window.webContents.on('will-prevent-unload', (event) => event.preventDefault())
    const allowed = (url: string) =>
      input.kind === 'weixin-ilink' || this.isAllowedFeishuNavigation(url, input)
    if (input.kind === 'feishu') {
      window.webContents.on('will-navigate', (event, url) => {
        if (!allowed(url)) event.preventDefault()
      })
    }
    const navigate = (url: string) => {
      void window.loadURL(url).catch(() => {
        // Closing a loading window can reject navigation before the native closed event.
        if (entry.closing || window.isDestroyed()) return
        if (this.windows.get(input.id) === entry) this.publish({ id: input.id, type: 'error' })
      })
    }
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) navigate(url)
      return { action: 'deny' }
    })
    window.once('closed', () => {
      closed.resolve()
      if (this.windows.get(input.id) !== entry) return
      this.windows.delete(input.id)
      this.publish({ id: input.id, type: 'closed' })
    })
    try {
      navigate(input.url)
      window.show()
      window.focus()
    } catch (error) {
      await this.close(input.id)
      throw error
    }
  }

  async close(id: string): Promise<void> {
    const entry = this.windows.get(id)
    if (!entry) return
    entry.closing = true
    // An auth page must not retain an owned window with a beforeunload handler after cancellation.
    if (!entry.window.isDestroyed()) entry.window.destroy()
    await entry.closed
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.windows.keys(), (id) => this.close(id)))
  }

  private isAllowedFeishuNavigation(
    url: string,
    input: Extract<RemoteAuthWindowInput, { kind: 'feishu' }>
  ): boolean {
    try {
      const parsed = new URL(url)
      const redirect = new URL(input.redirectUri)
      const domains = resolveFeishuAuthDomains(input.brand)
      return (
        (parsed.protocol === 'https:' &&
          [domains.accountsBaseUrl, domains.openBaseUrl].some(
            (base) => parsed.host === new URL(base).host
          )) ||
        (parsed.protocol === redirect.protocol &&
          parsed.host === redirect.host &&
          parsed.pathname === redirect.pathname)
      )
    } catch {
      return false
    }
  }
}
