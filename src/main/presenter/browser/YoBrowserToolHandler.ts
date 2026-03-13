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
        case 'yo_browser_window_list':
        case 'yo_browser_tab_list':
          return await this.handleWindowList()
        case 'yo_browser_window_open':
        case 'yo_browser_tab_new': {
          const url = typeof args.url === 'string' ? args.url : undefined
          return await this.handleWindowOpen(url)
        }
        case 'yo_browser_window_focus': {
          const windowId = typeof args.windowId === 'number' ? args.windowId : null
          if (windowId == null) {
            throw new Error('windowId is required')
          }
          return await this.handleWindowFocus(windowId)
        }
        case 'yo_browser_window_close': {
          const windowId = typeof args.windowId === 'number' ? args.windowId : null
          if (windowId == null) {
            throw new Error('windowId is required')
          }
          return await this.handleWindowClose(windowId)
        }
        case 'yo_browser_tab_activate': {
          const pageId =
            typeof args.pageId === 'string'
              ? args.pageId
              : typeof args.tabId === 'string'
                ? args.tabId
                : ''
          if (!pageId) {
            throw new Error('pageId is required')
          }
          await this.presenter.activateTab(pageId)
          return JSON.stringify({ success: true, pageId })
        }
        case 'yo_browser_tab_close': {
          const pageId =
            typeof args.pageId === 'string'
              ? args.pageId
              : typeof args.tabId === 'string'
                ? args.tabId
                : ''
          if (!pageId) {
            throw new Error('pageId is required')
          }
          await this.presenter.closeTab(pageId)
          return JSON.stringify({ success: true, pageId })
        }
        case 'yo_browser_cdp_send': {
          const windowId = typeof args.windowId === 'number' ? args.windowId : undefined
          const pageId =
            typeof args.pageId === 'string'
              ? args.pageId
              : typeof args.tabId === 'string'
                ? args.tabId
                : undefined
          const method = typeof args.method === 'string' ? args.method : ''
          const params = this.normalizeCdpParams(args.params)
          return await this.handleCdpSend(windowId ?? pageId, method, params)
        }
        default:
          throw new Error(`Unknown YoBrowser tool: ${toolName}`)
      }
    } catch (error) {
      logger.error('[YoBrowserToolHandler] Tool execution failed', { toolName, error })
      throw error
    }
  }

  private async handleWindowList(): Promise<string> {
    const snapshot = await this.presenter.getBrowserContext()
    return JSON.stringify(snapshot)
  }

  private async handleWindowOpen(url?: string): Promise<string> {
    const browserWindow = await this.presenter.openWindow(url)
    if (!browserWindow) {
      throw new Error('Failed to open browser window')
    }
    return JSON.stringify(browserWindow)
  }

  private async handleWindowFocus(windowId: number): Promise<string> {
    await this.presenter.focusWindow(windowId)
    return JSON.stringify({ success: true, windowId })
  }

  private async handleWindowClose(windowId: number): Promise<string> {
    await this.presenter.closeWindow(windowId)
    return JSON.stringify({ success: true, windowId })
  }

  private async handleCdpSend(
    target: number | string | undefined,
    method: string,
    params: Record<string, unknown>
  ): Promise<string> {
    if (!method) {
      throw new Error('CDP method is required')
    }

    const browserPage = await this.presenter.getBrowserTab(target)
    if (!browserPage) {
      throw new Error(`Browser target ${String(target)} not found`)
    }

    try {
      const response = await browserPage.sendCdpCommand(method, params)
      return JSON.stringify(response ?? {})
    } catch (error) {
      if (error instanceof Error && error.name === 'YoBrowserNotReadyError') {
        logger.warn('[YoBrowser] tool blocked:not-ready', {
          toolName: 'yo_browser_cdp_send',
          target: target ?? 'active',
          method,
          pageId: browserPage.pageId,
          url: browserPage.url,
          status: browserPage.status
        })
      }
      throw error
    }
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
