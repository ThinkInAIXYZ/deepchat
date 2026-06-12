import type { ProviderRequestTracePayload } from '../llmProviderPresenter/requestTrace'
import { redactRequestPreview } from '@/lib/redact'

export const MESSAGE_TRACE_MAX_BYTES = 512 * 1024

type PersistableMessageTracePayload = {
  endpoint: string
  headersJson: string
  bodyJson: string
  truncated: boolean
}

export function buildPersistableMessageTracePayload(
  payload: ProviderRequestTracePayload,
  maxBytes: number = MESSAGE_TRACE_MAX_BYTES
): PersistableMessageTracePayload {
  const endpoint = String(payload.endpoint ?? '')
  const redacted = redactRequestPreview({
    headers: payload.headers ?? {},
    body: payload.body
  })

  let headersJson = toStableJson(redacted.headers)
  let bodyJson = toStableJson(redacted.body)
  let truncated = false

  if (getTraceBytes(endpoint, headersJson, bodyJson) > maxBytes) {
    truncated = true

    const bodyBudget = Math.max(0, maxBytes - getBytes(endpoint) - getBytes(headersJson))
    bodyJson = buildTruncatedJson(bodyJson, bodyBudget)

    if (getTraceBytes(endpoint, headersJson, bodyJson) > maxBytes) {
      const headersBudget = Math.max(0, maxBytes - getBytes(endpoint) - getBytes(bodyJson))
      headersJson = buildTruncatedJson(headersJson, headersBudget)
    }
  }

  if (getTraceBytes(endpoint, headersJson, bodyJson) > maxBytes) {
    truncated = true
    const endpointBudget = Math.max(0, maxBytes - getBytes(headersJson) - getBytes(bodyJson))
    return {
      endpoint: truncateUtf8ByBytes(endpoint, endpointBudget),
      headersJson,
      bodyJson,
      truncated
    }
  }

  return {
    endpoint,
    headersJson,
    bodyJson,
    truncated
  }
}

function toStableJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return JSON.stringify({
      _nonSerializable: true,
      fallback: String(value),
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function getBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function getTraceBytes(endpoint: string, headersJson: string, bodyJson: string): number {
  return getBytes(endpoint) + getBytes(headersJson) + getBytes(bodyJson)
}

function buildTruncatedJson(originalJson: string, maxBytes: number): string {
  if (maxBytes <= 4) {
    return 'null'
  }

  const minimal = JSON.stringify({ _truncated: true })
  if (getBytes(minimal) > maxBytes) {
    return 'null'
  }

  const overhead = getBytes(JSON.stringify({ _truncated: true, preview: '' }))
  if (overhead >= maxBytes) {
    return minimal
  }

  const previewBudget = maxBytes - overhead
  const preview = truncateUtf8ByBytes(originalJson, previewBudget)
  return JSON.stringify({
    _truncated: true,
    preview
  })
}

function truncateUtf8ByBytes(input: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (getBytes(input) <= maxBytes) return input

  let low = 0
  let high = input.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = input.slice(0, mid)
    if (getBytes(candidate) <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return input.slice(0, low)
}
