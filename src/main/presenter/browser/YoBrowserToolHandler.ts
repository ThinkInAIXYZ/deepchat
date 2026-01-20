import logger from '@shared/logger'
import { getYoBrowserToolDefinitions } from './YoBrowserToolDefinitions'
import type { YoBrowserPresenter } from './YoBrowserPresenter'

export class YoBrowserToolHandler {
  private readonly presenter: YoBrowserPresenter

  constructor(presenter: YoBrowserPresenter) {
    this.presenter = presenter
  }

  getToolDefinitions(): any[] {
    return getYoBrowserToolDefinitions()
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (toolName) {
        case 'yo_browser_tab_list': {
          return await this.handleTabList()
        }
        case 'yo_browser_tab_new': {
          const url = typeof args.url === 'string' ? args.url : undefined
          return await this.handleTabNew(url)
        }
        case 'yo_browser_tab_activate': {
          const tabId = typeof args.tabId === 'string' ? args.tabId : ''
          if (!tabId) {
            throw new Error('tabId is required')
          }
          return await this.handleTabActivate(tabId)
        }
        case 'yo_browser_tab_close': {
          const tabId = typeof args.tabId === 'string' ? args.tabId : ''
          if (!tabId) {
            throw new Error('tabId is required')
          }
          return await this.handleTabClose(tabId)
        }
        case 'yo_browser_cdp_send': {
          const tabId = typeof args.tabId === 'string' ? args.tabId : undefined
          const method = typeof args.method === 'string' ? args.method : ''
          const params = this.normalizeCdpParams(args.params)
          return await this.handleCdpSend(tabId, method, params)
        }
        default:
          throw new Error(`Unknown YoBrowser tool: ${toolName}`)
      }
    } catch (error) {
      logger.error('[YoBrowserToolHandler] Tool execution failed', { toolName, error })
      throw error
    }
  }

  private async handleTabList(): Promise<string> {
    const tabs = await this.presenter.listTabs()
    const activeTab = await this.presenter.getActiveTab()
    return JSON.stringify({
      activeTabId: activeTab?.id ?? null,
      tabs: tabs.map((tab: any) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        isActive: tab.id === activeTab?.id
      }))
    })
  }

  private async handleTabNew(url?: string): Promise<string> {
    const tab = await this.presenter.createTab(url)
    if (!tab) {
      throw new Error('Failed to create new tab')
    }
    return JSON.stringify({
      id: tab.id,
      url: tab.url,
      title: tab.title
    })
  }

  private async handleTabActivate(tabId: string): Promise<string> {
    await this.presenter.activateTab(tabId)
    return JSON.stringify({ success: true, tabId })
  }

  private async handleTabClose(tabId: string): Promise<string> {
    await this.presenter.closeTab(tabId)
    return JSON.stringify({ success: true, tabId })
  }

  private async handleCdpSend(
    tabId: string | undefined,
    method: string,
    params: Record<string, unknown>
  ): Promise<string> {
    if (!method) {
      throw new Error('CDP method is required')
    }
    const browserTab = await this.presenter.getBrowserTab(tabId)
    if (!browserTab) {
      throw new Error(tabId ? `Tab ${tabId} not found` : 'No active tab available')
    }

    const response = await browserTab.sendCdpCommand(method, params)
    return JSON.stringify(response ?? {})
  }

  private normalizeCdpParams(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        return {}
      }
    }
    return {}
  }
}
