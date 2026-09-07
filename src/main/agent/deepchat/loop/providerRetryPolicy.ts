import type { ErrorStreamEvent, ProviderFailureMetadata } from '@shared/types/core/llm-events'
import type {
  DeepChatProviderAttemptIdentity,
  DeepChatProviderFailureClassification,
  DeepChatProviderRetryDecision
} from '@shared/types/provider-attempt'
import {
  extractProviderFailureMetadata,
  sanitizeProviderFailureMetadata
} from '@/provider/providerFailure'

export const MAX_TRANSIENT_RETRIES_PER_LOGICAL_ROUND = 2
export const PROVIDER_RETRY_BASE_DELAY_MS = 500
export const PROVIDER_RETRY_MAX_BACKOFF_MS = 8_000
export const PROVIDER_RETRY_MAX_SERVER_DELAY_MS = 60_000

const MAX_FAILURE_CAUSE_DEPTH = 5
const MAX_FAILURE_TEXT_LENGTH = 2_048
const RETRY_JITTER_RATIO = 0.25
const NUMERIC_RETRY_AFTER_PATTERN = /^\d+(?:\.\d+)?$/
const PERMANENT_ERROR_CODE_PATTERN =
  /(?:auth|api[_-]?key|billing|payment|quota|insufficient[_-]?(?:funds|credits)|invalid[_-]?request|bad[_-]?request|model[_-]?not[_-]?found|content[_-]?filter|permission[_-]?denied|forbidden)/i
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EPIPE',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'ESOCKETTIMEDOUT',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'PROVIDER_REQUEST_TIMEOUT'
])
const PERMANENT_FAILURE_TEXT_PATTERN =
  /(?:authentication failed|unauthori[sz]ed|forbidden|invalid api key|api key[^.\n]*(?:invalid|expired)|billing|payment required|insufficient (?:quota|funds|credits)|quota (?:has been )?exceeded|invalid request|bad request|unprocessable|model[^.\n]*(?:not found|does not exist)|content[- ]filter)/i
const TRANSIENT_FAILURE_TEXT_PATTERN =
  /(?:rate limit|too many requests|temporar(?:y|ily) unavailable|service unavailable|gateway timeout|overloaded|network(?: request)? (?:error|failed)|fetch failed|socket hang up|connection (?:reset|refused|timed out)|timed? out|timeout|\bECONN(?:ABORTED|REFUSED|RESET)\b|\bEAI_AGAIN\b)/i

export interface ProviderFailureAssessment {
  classification: DeepChatProviderFailureClassification
  metadata?: ProviderFailureMetadata
}

export type ProviderRetryDelayDecision =
  | { kind: 'retry'; delayMs: number; source: 'server' | 'backoff' }
  | { kind: 'reject'; serverDelayMs: number }

export type ProviderRetryLifecycleEvent =
  | {
      type: 'retry_scheduled'
      failedAttempt: DeepChatProviderAttemptIdentity
      nextAttempt: DeepChatProviderAttemptIdentity
      retryNumber: number
      delayMs: number
    }
  | {
      type: 'retry_started'
      attempt: DeepChatProviderAttemptIdentity
      retryNumber: number
    }
  | {
      type: 'retry_finished'
      attempt: DeepChatProviderAttemptIdentity
      retryNumber: number
      status: 'completed' | 'context_overflow' | 'aborted' | 'error'
      failureClassification: DeepChatProviderFailureClassification | null
      retryDecision: DeepChatProviderRetryDecision
    }

export type ProviderRetryObserver = (event: ProviderRetryLifecycleEvent) => void

type UnknownRecord = Record<PropertyKey, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function readProperty(value: unknown, key: PropertyKey): unknown {
  if (!isRecord(value)) return undefined
  try {
    return value[key]
  } catch {
    return undefined
  }
}

function mergeMetadata(
  primary: ProviderFailureMetadata | undefined,
  secondary: ProviderFailureMetadata | undefined
): ProviderFailureMetadata | undefined {
  if (!primary) return secondary
  if (!secondary) return primary
  const retryHeaders = {
    ...secondary.retryHeaders,
    ...primary.retryHeaders
  }
  const statusCode = primary.statusCode ?? secondary.statusCode
  const code = primary.code ?? secondary.code
  const retryable = primary.retryable ?? secondary.retryable
  return {
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(Object.keys(retryHeaders).length > 0 ? { retryHeaders } : {})
  }
}

function collectFailureText(error: unknown, errorEvent?: ErrorStreamEvent): string {
  const parts: string[] = []
  if (errorEvent?.error_message) {
    parts.push(errorEvent.error_message.slice(0, MAX_FAILURE_TEXT_LENGTH))
  }

  const visited = new Set<unknown>()
  let current = error
  for (let depth = 0; depth < MAX_FAILURE_CAUSE_DEPTH && current !== undefined; depth += 1) {
    if (visited.has(current)) break
    visited.add(current)
    const message = typeof current === 'string' ? current : readProperty(current, 'message')
    if (typeof message === 'string' && message.length > 0) {
      parts.push(message.slice(0, MAX_FAILURE_TEXT_LENGTH))
    }
    current = readProperty(current, 'cause')
  }
  return parts.join('\n')
}

function isPermanentStatus(statusCode: number | undefined): boolean {
  return (
    statusCode !== undefined &&
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 408 &&
    statusCode !== 409 &&
    statusCode !== 429
  )
}

function isTransientStatus(statusCode: number | undefined): boolean {
  return (
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 429 ||
    (statusCode !== undefined && statusCode >= 500 && statusCode <= 599)
  )
}

export function classifyProviderFailure(input: {
  signalAborted: boolean
  contextOverflow: boolean
  error?: unknown
  errorEvent?: ErrorStreamEvent
  prematureEof?: boolean
}): ProviderFailureAssessment {
  const eventMetadata = sanitizeProviderFailureMetadata(input.errorEvent?.failure)
  const metadata = mergeMetadata(eventMetadata, extractProviderFailureMetadata(input.error))
  if (input.signalAborted) return { classification: 'aborted', ...(metadata ? { metadata } : {}) }
  if (input.contextOverflow) {
    return { classification: 'context_overflow', ...(metadata ? { metadata } : {}) }
  }

  const code = metadata?.code
  const text = collectFailureText(input.error, input.errorEvent)
  if (
    (code !== undefined && PERMANENT_ERROR_CODE_PATTERN.test(code)) ||
    isPermanentStatus(metadata?.statusCode) ||
    PERMANENT_FAILURE_TEXT_PATTERN.test(text) ||
    metadata?.retryHeaders?.['x-should-retry']?.trim().toLowerCase() === 'false'
  ) {
    return { classification: 'permanent', ...(metadata ? { metadata } : {}) }
  }
  if (
    input.prematureEof ||
    metadata?.retryHeaders?.['x-should-retry']?.trim().toLowerCase() === 'true' ||
    metadata?.retryable === true ||
    isTransientStatus(metadata?.statusCode) ||
    (code !== undefined && TRANSIENT_ERROR_CODES.has(code.toUpperCase())) ||
    TRANSIENT_FAILURE_TEXT_PATTERN.test(text)
  ) {
    return { classification: 'transient', ...(metadata ? { metadata } : {}) }
  }
  return { classification: 'unknown', ...(metadata ? { metadata } : {}) }
}

function parseServerRetryDelayMs(
  metadata: ProviderFailureMetadata | undefined,
  nowMs: number
): number | undefined {
  const retryAfterMs = metadata?.retryHeaders?.['retry-after-ms']?.trim()
  if (retryAfterMs && NUMERIC_RETRY_AFTER_PATTERN.test(retryAfterMs)) {
    const parsed = Number(retryAfterMs)
    return Number.isFinite(parsed) ? Math.ceil(parsed) : PROVIDER_RETRY_MAX_SERVER_DELAY_MS + 1
  }

  const retryAfter = metadata?.retryHeaders?.['retry-after']?.trim()
  if (!retryAfter) return undefined
  if (NUMERIC_RETRY_AFTER_PATTERN.test(retryAfter)) {
    const parsed = Number(retryAfter)
    return Number.isFinite(parsed)
      ? Math.ceil(parsed * 1_000)
      : PROVIDER_RETRY_MAX_SERVER_DELAY_MS + 1
  }

  const retryAt = Date.parse(retryAfter)
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : undefined
}

export function resolveProviderRetryDelay(input: {
  metadata?: ProviderFailureMetadata
  retryIndex: number
  nowMs?: number
  random?: () => number
}): ProviderRetryDelayDecision {
  if (!Number.isSafeInteger(input.retryIndex) || input.retryIndex < 0) {
    throw new RangeError('Provider retry index must be a non-negative safe integer.')
  }

  const serverDelayMs = parseServerRetryDelayMs(input.metadata, input.nowMs ?? Date.now())
  if (serverDelayMs !== undefined) {
    if (serverDelayMs > PROVIDER_RETRY_MAX_SERVER_DELAY_MS) {
      return { kind: 'reject', serverDelayMs }
    }
    return { kind: 'retry', delayMs: serverDelayMs, source: 'server' }
  }

  const exponentialDelayMs = Math.min(
    PROVIDER_RETRY_BASE_DELAY_MS * 2 ** input.retryIndex,
    PROVIDER_RETRY_MAX_BACKOFF_MS
  )
  const randomValue = (input.random ?? Math.random)()
  const boundedRandom = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0
  return {
    kind: 'retry',
    delayMs: Math.floor(exponentialDelayMs * (1 - boundedRandom * RETRY_JITTER_RATIO)),
    source: 'backoff'
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('Aborted', 'AbortError')
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export function waitForProviderRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    return Promise.reject(new RangeError('Provider retry delay must be a non-negative number.'))
  }
  if (signal.aborted) return Promise.reject(signal.reason ?? createAbortError())

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal.reason ?? createAbortError())
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function emitProviderRetryLifecycleEvent(
  observer: ProviderRetryObserver | undefined,
  event: ProviderRetryLifecycleEvent
): void {
  try {
    observer?.(event)
  } catch {
    // Diagnostics must never influence provider execution.
  }
}
