import type {
  ProviderFailureMetadata,
  ProviderRetryHeaderName
} from '@shared/types/core/llm-events'

const RETRY_HEADER_NAMES = [
  'retry-after',
  'retry-after-ms',
  'x-should-retry'
] as const satisfies readonly ProviderRetryHeaderName[]
const MAX_CAUSE_DEPTH = 5
const MAX_CODE_LENGTH = 128
const MAX_RETRY_HEADER_LENGTH = 256
const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

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

function normalizeStatusCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined
}

function normalizeErrorCode(value: unknown): string | undefined {
  const code = typeof value === 'string' ? value : ''
  const normalized = code.trim()
  if (
    normalized.length === 0 ||
    normalized.length > MAX_CODE_LENGTH ||
    !SAFE_ERROR_CODE_PATTERN.test(normalized)
  ) {
    return undefined
  }
  return normalized
}

function normalizeRetryHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string' && /[\r\n]/.test(value)) {
    return undefined
  }
  const normalized =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : ''
  if (normalized.length === 0 || normalized.length > MAX_RETRY_HEADER_LENGTH) {
    return undefined
  }
  return normalized
}

function getHeaderValue(headers: unknown, name: ProviderRetryHeaderName): unknown {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined
  }
  if (!isRecord(headers)) return undefined

  try {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name) {
        return headers[key]
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

function extractRetryHeaders(
  headers: unknown
): ProviderFailureMetadata['retryHeaders'] | undefined {
  const retryHeaders: NonNullable<ProviderFailureMetadata['retryHeaders']> = {}
  for (const name of RETRY_HEADER_NAMES) {
    const value = normalizeRetryHeaderValue(getHeaderValue(headers, name))
    if (value !== undefined) retryHeaders[name] = value
  }
  return Object.keys(retryHeaders).length > 0 ? retryHeaders : undefined
}

function mergeFailureMetadata(
  target: ProviderFailureMetadata,
  source: ProviderFailureMetadata | undefined
): void {
  if (!source) return
  if (source.statusCode !== undefined && target.statusCode === undefined) {
    target.statusCode = source.statusCode
  }
  if (source.code !== undefined && target.code === undefined) {
    target.code = source.code
  }
  if (source.retryable !== undefined && target.retryable === undefined) {
    target.retryable = source.retryable
  }
  if (source.retryHeaders) {
    target.retryHeaders ??= {}
    for (const name of RETRY_HEADER_NAMES) {
      const value = source.retryHeaders[name]
      if (value !== undefined && target.retryHeaders[name] === undefined) {
        target.retryHeaders[name] = value
      }
    }
  }
}

export function sanitizeProviderFailureMetadata(
  value: unknown
): ProviderFailureMetadata | undefined {
  if (!isRecord(value)) return undefined

  const statusCode = normalizeStatusCode(readProperty(value, 'statusCode'))
  const code = normalizeErrorCode(readProperty(value, 'code'))
  const retryableValue = readProperty(value, 'retryable')
  const retryable = typeof retryableValue === 'boolean' ? retryableValue : undefined
  const retryHeaders = extractRetryHeaders(readProperty(value, 'retryHeaders'))
  const metadata: ProviderFailureMetadata = {
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(retryHeaders ? { retryHeaders } : {})
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export function extractProviderFailureMetadata(
  error: unknown
): ProviderFailureMetadata | undefined {
  const metadata: ProviderFailureMetadata = {}
  const visited = new Set<unknown>()
  let current = error

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && isRecord(current); depth += 1) {
    if (visited.has(current)) break
    visited.add(current)

    mergeFailureMetadata(
      metadata,
      sanitizeProviderFailureMetadata(readProperty(current, 'failure'))
    )

    const statusCode =
      normalizeStatusCode(readProperty(current, 'statusCode')) ??
      normalizeStatusCode(readProperty(current, 'status'))
    const code = normalizeErrorCode(readProperty(current, 'code'))
    const retryableValue =
      readProperty(current, 'isRetryable') ?? readProperty(current, 'retryable')
    const retryable = typeof retryableValue === 'boolean' ? retryableValue : undefined
    const retryHeaders =
      extractRetryHeaders(readProperty(current, 'responseHeaders')) ??
      extractRetryHeaders(readProperty(current, 'headers'))

    mergeFailureMetadata(metadata, {
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
      ...(retryHeaders ? { retryHeaders } : {})
    })
    current = readProperty(current, 'cause')
  }

  if (metadata.retryHeaders && Object.keys(metadata.retryHeaders).length === 0) {
    delete metadata.retryHeaders
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export class ProviderHttpError extends Error {
  readonly failure: ProviderFailureMetadata

  constructor(
    message: string,
    input: {
      statusCode: number
      code?: string
      retryable?: boolean
      headers?: Headers | Record<string, string>
      cause?: unknown
    }
  ) {
    super(message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'ProviderHttpError'
    this.failure =
      sanitizeProviderFailureMetadata({
        statusCode: input.statusCode,
        code: input.code,
        retryable: input.retryable,
        retryHeaders: extractRetryHeaders(input.headers)
      }) ?? {}
  }
}

export function createProviderHttpErrorFromResponse(
  message: string,
  response: Pick<Response, 'body' | 'headers' | 'status'>,
  code: string
): ProviderHttpError {
  try {
    const cancellation = response.body?.cancel()
    if (cancellation) void cancellation.catch(() => {})
  } catch {
    // Releasing an unread error body is best effort and must not hide the provider failure.
  }
  return new ProviderHttpError(message, {
    statusCode: response.status,
    code,
    headers: response.headers
  })
}
