import {
  ElectronBrowserAdapter,
  BrowserAdapterOptions,
  PageSummary
} from '../browserAdapter/ElectronBrowserAdapter'
import { ElectronPageAdapter } from '../browserAdapter/ElectronPageAdapter'

export interface BrowserSessionManagerOptions extends BrowserAdapterOptions {
  sessionTimeoutMs?: number
}

interface BrowserSession {
  id: string
  adapter: ElectronBrowserAdapter
  createdAt: number
  lastAccessed: number
  cleanupTimer?: NodeJS.Timeout
}

export class BrowserSessionManager {
  private readonly showWindow: boolean
  private readonly sessionTimeoutMs: number
  private readonly sessions = new Map<string, BrowserSession>()

  constructor(options?: BrowserSessionManagerOptions) {
    this.showWindow = options?.showWindow ?? false
    this.sessionTimeoutMs = options?.sessionTimeoutMs ?? 30 * 60 * 1000
  }

  getSession(conversationId: string): BrowserSession {
    const existing = this.sessions.get(conversationId)
    if (existing) {
      this.touch(existing)
      return existing
    }

    const adapter = new ElectronBrowserAdapter({ showWindow: this.showWindow })
    const session: BrowserSession = {
      id: conversationId,
      adapter,
      createdAt: Date.now(),
      lastAccessed: Date.now()
    }
    this.sessions.set(conversationId, session)
    this.scheduleCleanup(conversationId, session)
    return session
  }

  async getOrCreatePage(
    conversationId: string,
    options?: { newPage?: boolean; url?: string }
  ): Promise<ElectronPageAdapter> {
    const session = this.getSession(conversationId)
    let page = session.adapter.getActivePage()

    if (!page || options?.newPage) {
      page = await session.adapter.newPage(options?.url)
    } else if (options?.url) {
      await page.goto(options.url)
    }

    this.touch(session)
    return page
  }

  listPages(conversationId: string): PageSummary[] {
    const session = this.getSession(conversationId)
    this.touch(session)
    return session.adapter.listPages()
  }

  switchPage(conversationId: string, pageId: number): PageSummary | undefined {
    const session = this.getSession(conversationId)
    const page = session.adapter.setActivePage(pageId)
    this.touch(session)
    if (!page) return undefined
    return {
      id: page.id,
      url: page.url,
      title: page.title,
      isActive: true
    }
  }

  async closePage(conversationId: string, pageId?: number): Promise<void> {
    const session = this.sessions.get(conversationId)
    if (!session) return
    await session.adapter.closePage(pageId)
    this.touch(session)
  }

  listDownloads(conversationId: string) {
    const session = this.sessions.get(conversationId)
    if (!session) return []
    this.touch(session)
    return session.adapter.listDownloads()
  }

  async cleanupSession(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId)
    if (!session) return
    clearTimeout(session.cleanupTimer)
    await session.adapter.close()
    this.sessions.delete(conversationId)
  }

  async dispose(): Promise<void> {
    const ids = Array.from(this.sessions.keys())
    for (const id of ids) {
      await this.cleanupSession(id)
    }
  }

  private scheduleCleanup(conversationId: string, session: BrowserSession): void {
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer)
    }

    session.cleanupTimer = setTimeout(() => {
      this.cleanupSession(conversationId).catch((error) =>
        console.error(`[BrowserSessionManager] Failed to cleanup session ${conversationId}`, error)
      )
    }, this.sessionTimeoutMs)
  }

  private touch(session: BrowserSession): void {
    session.lastAccessed = Date.now()
    this.scheduleCleanup(session.id, session)
  }
}
