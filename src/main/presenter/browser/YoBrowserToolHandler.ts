import logger from '@shared/logger'
import { getYoBrowserToolDefinitions } from './YoBrowserToolDefinitions'
import type { YoBrowserPresenter } from './YoBrowserPresenter'
import { BrowserPageStatus, type YoBrowserStatus } from '@shared/types/browser'
import {
  YoBrowserUnavailableError,
  buildYoBrowserUnavailablePayload,
  isYoBrowserUnavailableError
} from './YoBrowserErrors'

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
          return JSON.stringify(
            await this.presenter.loadUrl(sessionId, url, undefined, undefined, 'agent')
          )
        }
        case 'cdp_send': {
          const method = typeof args.method === 'string' ? args.method : ''
          if (!method) {
            throw new Error('CDP method is required')
          }

          const status = await this.presenter.getBrowserStatus(sessionId)
          const page = status.page
          if (
            !status.initialized ||
            !status.visible ||
            !page ||
            page.status === BrowserPageStatus.Closed
          ) {
            throw await this.createUnavailableError(sessionId, method, status)
          }

          try {
            const params = this.normalizeCdpParams(args.params)
            const response = await this.presenter.sendCdpCommand(sessionId, method, params, 'agent')
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
              throw await this.createUnavailableError(sessionId, method, status, error)
            }
            throw error
          }
        }
        default:
          throw new Error(`Unknown YoBrowser tool: ${toolName}`)
      }
    } catch (error) {
      if (isYoBrowserUnavailableError(error)) {
        logger.warn('[YoBrowserToolHandler] Tool execution failed:browser-unavailable', {
          toolName,
          error: error.payload.error
        })
      } else {
        logger.error('[YoBrowserToolHandler] Tool execution failed', { toolName, error })
      }
      throw error
    }
  }

  private async createUnavailableError(
    sessionId: string,
    method: string,
    knownStatus?: YoBrowserStatus,
    originalError?: unknown
  ): Promise<YoBrowserUnavailableError> {
    if (knownStatus) {
      return new YoBrowserUnavailableError(
        buildYoBrowserUnavailablePayload(sessionId, method, knownStatus),
        originalError
      )
    }

    return this.presenter
      .getBrowserStatus(sessionId)
      .catch(() => null)
      .then(
        (status) =>
          new YoBrowserUnavailableError(
            buildYoBrowserUnavailablePayload(sessionId, method, status),
            originalError
          )
      )
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
