/**
 * Redaction utilities for sensitive information in request trace payloads.
 */

const SENSITIVE_HEADER_KEYS = new Set(['authorization', 'api-key', 'x-api-key', 'x-goog-api-key'])

// Provider credentials are carried by the headers above. Keep body matching limited to the explicit
// API-key field; broad token/key matching hides ordinary provider diagnostics and tool arguments.
const SENSITIVE_BODY_KEYS = new Set(['api_key'])

const MASKED_LITERAL = '***MASKED***'

function maskKeepTail(value: string, tailLength: number = 4): string {
  if (!value) return value
  if (value.length <= tailLength) {
    return '*'.repeat(value.length)
  }
  return `${'*'.repeat(value.length - tailLength)}${value.slice(-tailLength)}`
}

function maskSensitiveString(value: string): string {
  const bearerMatch = value.match(/^([A-Za-z]+\s+)(.+)$/)
  if (bearerMatch && /bearer|token|key/i.test(bearerMatch[1])) {
    return `${bearerMatch[1]}${maskKeepTail(bearerMatch[2])}`
  }
  return maskKeepTail(value)
}

function normalizeBodyKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[\s-]+/gu, '_')
    .toLowerCase()
}

function isSensitiveHeaderKey(key: string): boolean {
  return SENSITIVE_HEADER_KEYS.has(key.trim().toLowerCase())
}

function isSensitiveBodyKey(key: string): boolean {
  return SENSITIVE_BODY_KEYS.has(normalizeBodyKey(key))
}

function maskUnknownValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskSensitiveString(value)
  }
  return MASKED_LITERAL
}

function redactUrl(value: URL): string {
  // AI SDK message mapping represents remote media as URL objects. Preserve the URL while keeping
  // its explicit authentication material out of the persisted request evidence.
  const redacted = new URL(value)
  if (redacted.username) redacted.username = MASKED_LITERAL
  if (redacted.password) Reflect.set(redacted, 'password', MASKED_LITERAL)
  for (const key of value.searchParams.keys()) {
    if (isSensitiveBodyKey(key)) {
      redacted.searchParams.set(key, MASKED_LITERAL)
    }
  }
  return redacted.toString()
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = isSensitiveHeaderKey(key) ? maskSensitiveString(String(value)) : value
  }

  return redacted
}

export function redactBody(body: unknown): unknown {
  if (body === null || body === undefined) {
    return body
  }

  if (body instanceof URL) {
    return redactUrl(body)
  }

  if (Array.isArray(body)) {
    return body.map((item) => redactBody(item))
  }

  if (typeof body === 'object') {
    const redacted: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(body)) {
      if (isSensitiveBodyKey(key)) {
        redacted[key] = maskUnknownValue(value)
        continue
      }

      if (typeof value === 'object' && value !== null) {
        redacted[key] = redactBody(value)
        continue
      }

      redacted[key] = value
    }

    return redacted
  }

  return body
}

export function redactRequestPreview(preview: { headers: Record<string, string>; body: unknown }): {
  headers: Record<string, string>
  body: unknown
} {
  return {
    headers: redactHeaders(preview.headers),
    body: redactBody(preview.body)
  }
}
