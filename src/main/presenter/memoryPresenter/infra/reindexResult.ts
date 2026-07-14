import type { MemoryReindexError, MemoryReindexErrorCode } from '../domain/types'

const MAX_REINDEX_ERROR_MESSAGE_LENGTH = 500
const UNKNOWN_REINDEX_ERROR_MESSAGE = 'Unknown reindex error'

export class MemoryReindexFailure extends Error {
  constructor(
    readonly code: MemoryReindexErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'MemoryReindexFailure'
  }
}

const getStatusCode = (error: Error): number | undefined => {
  const value =
    (error as Error & { statusCode?: unknown; status?: unknown }).statusCode ??
    (error as Error & { status?: unknown }).status
  const statusCode = typeof value === 'number' ? value : Number(value)
  if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) {
    return statusCode
  }

  const matched = /\b(?:HTTP(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*(\d{3})\b/i.exec(
    error.message
  )
  return matched ? Number(matched[1]) : undefined
}

const sanitizeMessage = (message: string): string => {
  const sanitized = message
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(\b(?:incorrect\s+)?api[\s_-]?key\s+(?:provided|is)\s*:?\s*)["']?[^\s,;"']+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /\b(api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)\b(\s*[:=]\s*|\s+)(?!(?:provided|is)\b)["']?[^\s,;"']+/gi,
      '$1$2[REDACTED]'
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|key|secret|signature)=)[^&#\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\s+/g, ' ')
    .trim()

  return (sanitized || UNKNOWN_REINDEX_ERROR_MESSAGE).slice(0, MAX_REINDEX_ERROR_MESSAGE_LENGTH)
}

const isRetryableError = (error: Error): boolean => {
  if (
    error instanceof MemoryReindexFailure &&
    (error.code === 'agent-unavailable' || error.code === 'pending-restart')
  ) {
    return false
  }

  if (
    /pending[\s_-]*restart|requires? (?:an )?(?:app(?:lication)? )?restart/i.test(error.message)
  ) {
    return false
  }

  const statusCode = getStatusCode(error)
  if (statusCode !== undefined) {
    if (statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500) {
      return true
    }
    if (statusCode >= 400) {
      return false
    }
  }

  if (
    /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network|fetch failed|socket|timeout|timed out|deadline)\b/i.test(
      error.message
    )
  ) {
    return true
  }

  return true
}

export const toMemoryReindexError = (error: unknown): MemoryReindexError => {
  const normalized = error instanceof Error ? error : new Error(UNKNOWN_REINDEX_ERROR_MESSAGE)
  const code =
    normalized instanceof MemoryReindexFailure
      ? normalized.code
      : /^\s*\[Memory\]/.test(normalized.message)
        ? 'drain-stalled'
        : undefined
  return {
    message: sanitizeMessage(normalized.message),
    retryable: isRetryableError(normalized),
    ...(code ? { code } : {})
  }
}
