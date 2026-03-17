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

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string
  ): Promise<string> {
    try {
      const sessionId = conversationId?.trim()
      if (!sessionId) {
        throw new Error('conversationId is required for YoBrowser tools')
      }

      switch (toolName) {
        case 'get_browser_status':
          return JSON.stringify(await this.presenter.getBrowserStatus(sessionId))
        case 'load_url': {
          const url = typeof args.url === 'string' ? args.url : ''
          if (!url) {
            throw new Error('url is required')
          }
          return JSON.stringify(await this.presenter.loadUrl(sessionId, url))
        }
        case 'cdp_send': {
          const method = typeof args.method === 'string' ? args.method : ''
          if (!method) {
            throw new Error('CDP method is required')
          }

          const page = await this.presenter.getBrowserPage(sessionId)
          if (!page) {
            throw new Error(`Session browser for ${sessionId} is not initialized`)
          }

          try {
            const params = this.normalizeCdpParams(args.params)
            const response = await this.presenter.sendCdpCommand(sessionId, method, params)
            return JSON.stringify(response ?? {})
          } catch (error) {
            if (error instanceof Error && error.name === 'YoBrowserNotReadyError') {
              logger.warn('[YoBrowser] tool blocked:not-ready', {
                toolName: 'cdp_send',
                sessionId,
                method,
                pageId: page.id,
                url: page.url,
                status: page.status
              })
            }
            throw error
          }
        }
        default:
          throw new Error(`Unknown YoBrowser tool: ${toolName}`)
      }
    } catch (error) {
      logger.error('[YoBrowserToolHandler] Tool execution failed', { toolName, error })
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
