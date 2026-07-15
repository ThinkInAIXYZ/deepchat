import type { YoBrowserStatus } from '@shared/types/browser'

export const YO_BROWSER_UNAVAILABLE_ERROR_CODE = 'yobrowser_unavailable'

export interface YoBrowserUnavailableErrorPayload {
  ok: false
  error: {
    code: typeof YO_BROWSER_UNAVAILABLE_ERROR_CODE
    message: string
    recoverable: true
    sessionId: string
    method: string
    browserStatus: YoBrowserStatus | null
    suggestedNextActions: string[]
  }
}

export class YoBrowserUnavailableError extends Error {
  readonly payload: YoBrowserUnavailableErrorPayload
  readonly originalError?: unknown

  constructor(payload: YoBrowserUnavailableErrorPayload, originalError?: unknown) {
    super(payload.error.message)
    this.name = 'YoBrowserUnavailableError'
    this.payload = payload
    this.originalError = originalError
  }
}

export const isYoBrowserUnavailableError = (error: unknown): error is YoBrowserUnavailableError =>
  error instanceof YoBrowserUnavailableError ||
  (error instanceof Error &&
    error.name === 'YoBrowserUnavailableError' &&
    typeof (error as { payload?: unknown }).payload === 'object' &&
    (error as { payload?: YoBrowserUnavailableErrorPayload }).payload?.error?.code ===
      YO_BROWSER_UNAVAILABLE_ERROR_CODE)

export const buildYoBrowserUnavailablePayload = (
  sessionId: string,
  method: string,
  browserStatus: YoBrowserStatus | null
): YoBrowserUnavailableErrorPayload => ({
  ok: false,
  error: {
    code: YO_BROWSER_UNAVAILABLE_ERROR_CODE,
    message: 'YoBrowser is not available for this session, so the CDP command was not run.',
    recoverable: true,
    sessionId,
    method,
    browserStatus,
    suggestedNextActions: [
      'Call get_browser_status to inspect the current browser state.',
      'Call load_url with the target URL to recreate or reopen the session browser.',
      'If no URL is available, ask the user to reopen the browser panel or continue without browser verification.'
    ]
  }
})
