/**
 * Redaction utilities for sensitive information in request trace payloads.
 */

const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'api-key',
  'x-api-key',
  'apikey',
  'token',
  'secret',
  'password',
  'credential',
  'access-key',
  'access_key',
  'client-secret',
  'client_secret'
]

const SENSITIVE_BODY_KEYS = [
  'api_key',
  'apikey',
  'apiKey',
  'secret',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key'
]

const ALLOWED_BODY_KEYS = [
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'temperature',
  'stream',
  'model',
  'messages',
  'tools'
]

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

function isSensitiveHeaderKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_HEADER_KEYS.some((sensitiveKey) => lower.includes(sensitiveKey))
}

function isSensitiveBodyKey(key: string): boolean {
  if (ALLOWED_BODY_KEYS.includes(key)) {
    return false
  }

  const keyLower = key.toLowerCase()
  return SENSITIVE_BODY_KEYS.some((sensitiveKey) => {
    const sensitiveLower = sensitiveKey.toLowerCase()
    if (keyLower === sensitiveLower) {
      return true
    }
    if (keyLower.endsWith(`_${sensitiveLower}`) || keyLower.endsWith(sensitiveLower)) {
      return !ALLOWED_BODY_KEYS.some((allowed) => keyLower.includes(allowed.toLowerCase()))
    }
    return false
  })
}

function maskUnknownValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskSensitiveString(value)
  }
  return MASKED_LITERAL
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
