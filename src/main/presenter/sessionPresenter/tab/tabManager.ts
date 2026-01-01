import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS } from '@/events'

export interface ITabAdapter {
  getTab(tabId: number): Promise<any>
  switchTab(tabId: number): Promise<void>
  getWindowId(tabId: number): number | undefined
}

export type TabMetadata = {
  windowType: 'main' | 'floating' | 'browser'
  createdAt: number
  lastActivated: number
}

export class TabManager {
  tabIdToSessionId: Map<number, string>
  sessionIdToTabIds: Map<string, Set<number>>
  tabMetadata: Map<number, TabMetadata>

  constructor(private readonly tabAdapter: ITabAdapter) {
    this.tabIdToSessionId = new Map()
    this.sessionIdToTabIds = new Map()
    this.tabMetadata = new Map()
  }

  getBoundSession(tabId: number): string | null {
    return this.tabIdToSessionId.get(tabId) || null
  }

  getTabsForSession(sessionId: string): number[] {
    const tabIds = this.sessionIdToTabIds.get(sessionId)
    return tabIds ? Array.from(tabIds) : []
  }

  async findTabForSession(
    sessionId: string,
    preferredWindowType?: 'main' | 'floating'
  ): Promise<number | null> {
    const tabIds = this.getTabsForSession(sessionId)
    if (tabIds.length === 0) {
      return null
    }

    if (preferredWindowType) {
      for (const tabId of tabIds) {
        const metadata = this.tabMetadata.get(tabId)
        if (metadata?.windowType === preferredWindowType) {
          try {
            const tab = await this.tabAdapter.getTab(tabId)
            if (tab && !tab.webContents.isDestroyed()) {
              return tabId
            }
          } catch {
            continue
          }
        }
      }
    }

    for (const tabId of tabIds) {
      try {
        const tab = await this.tabAdapter.getTab(tabId)
        if (tab && !tab.webContents.isDestroyed()) {
          return tabId
        }
      } catch {
        continue
      }
    }

    return null
  }

  async bindToTab(
    sessionId: string,
    tabId: number,
    windowType: 'main' | 'floating' | 'browser'
  ): Promise<void> {
    const existingSessionId = this.tabIdToSessionId.get(tabId)
    if (existingSessionId) {
      await this.unbindFromTab(tabId)
    }

    this.tabIdToSessionId.set(tabId, sessionId)
    if (!this.sessionIdToTabIds.has(sessionId)) {
      this.sessionIdToTabIds.set(sessionId, new Set())
    }
    this.sessionIdToTabIds.get(sessionId)!.add(tabId)

    const now = Date.now()
    this.tabMetadata.set(tabId, {
      windowType,
      createdAt: now,
      lastActivated: now
    })
  }

  async unbindFromTab(tabId: number): Promise<void> {
    const sessionId = this.tabIdToSessionId.get(tabId)
    if (!sessionId) {
      return
    }

    this.tabIdToSessionId.delete(tabId)
    const tabIds = this.sessionIdToTabIds.get(sessionId)
    if (tabIds) {
      tabIds.delete(tabId)
      if (tabIds.size === 0) {
        this.sessionIdToTabIds.delete(sessionId)
      }
    }

    this.tabMetadata.delete(tabId)

    eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, { tabId })
  }

  async activateSession(tabId: number, sessionId: string): Promise<void> {
    const existingTabId = await this.findTabForSession(sessionId)

    if (existingTabId && existingTabId !== tabId) {
      const existingMetadata = this.tabMetadata.get(existingTabId)
      const targetMetadata = this.tabMetadata.get(tabId)

      if (
        existingMetadata &&
        targetMetadata &&
        existingMetadata.windowType === targetMetadata.windowType
      ) {
        await this.tabAdapter.switchTab(existingTabId)
        return
      }

      if (existingTabId) {
        await this.unbindFromTab(existingTabId)
      }

      await this.bindToTab(sessionId, tabId, targetMetadata?.windowType || 'main')

      const windowId = this.tabAdapter.getWindowId(tabId)
      eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
        sessionId,
        tabId,
        windowId
      })
      return
    }

    const currentSessionId = this.tabIdToSessionId.get(tabId)
    if (currentSessionId === sessionId) {
      return
    }

    if (currentSessionId) {
      await this.unbindFromTab(tabId)
    }

    const metadata = this.tabMetadata.get(tabId)
    await this.bindToTab(sessionId, tabId, metadata?.windowType || 'main')

    const windowId = this.tabAdapter.getWindowId(tabId)
    eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      sessionId,
      tabId,
      windowId
    })
  }

  unbindAllForSession(sessionId: string): void {
    const tabIds = this.getTabsForSession(sessionId)
    for (const tabId of tabIds) {
      this.tabIdToSessionId.delete(tabId)
      this.tabMetadata.delete(tabId)

      eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, { tabId })
    }
    this.sessionIdToTabIds.delete(sessionId)
  }

  updateTabActivation(tabId: number): void {
    const metadata = this.tabMetadata.get(tabId)
    if (metadata) {
      metadata.lastActivated = Date.now()
    }
  }

  getTabMetadata(tabId: number): TabMetadata | undefined {
    return this.tabMetadata.get(tabId)
  }

  onTabCreated(tabId: number, windowType: 'main' | 'floating' | 'browser'): void {
    const now = Date.now()
    this.tabMetadata.set(tabId, {
      windowType,
      createdAt: now,
      lastActivated: now
    })
  }

  async onTabClosed(tabId: number): Promise<void> {
    await this.unbindFromTab(tabId)
    this.tabMetadata.delete(tabId)
  }

  onTabActivated(tabId: number): void {
    this.updateTabActivation(tabId)
  }
}
