/**
 * Redaction utilities for sensitive information in request preview
 */

/**
 * Sensitive header keys that should be redacted
 */
const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'api-key',
  'x-api-key',
  'apikey',
  'bearer',
  'token',
  'secret',
  'password',
  'credential',
  'auth'
]

/**
 * Sensitive body keys that should be redacted
 * Note: We use exact match to avoid filtering legitimate keys like 'max_tokens'
 */
const SENSITIVE_BODY_KEYS = ['api_key', 'apiKey', 'apikey', 'secret', 'password', 'token']

/**
 * Body keys that should never be redacted (even if they contain sensitive keywords)
 */
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

/**
 * Redact sensitive values in headers
 * @param headers Original headers
 * @returns Redacted headers
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    const keyLower = key.toLowerCase()
    const shouldRedact = SENSITIVE_HEADER_KEYS.some((sensitiveKey) =>
      keyLower.includes(sensitiveKey)
    )

    if (shouldRedact) {
      redacted[key] = '***REDACTED***'
    } else {
      redacted[key] = value
    }
  }

  return redacted
}

/**
 * Redact sensitive values in request body
 * @param body Original body
 * @returns Redacted body
 */
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
      // Skip redaction for allowed keys (like max_tokens, max_completion_tokens, etc.)
      if (ALLOWED_BODY_KEYS.includes(key)) {
        if (typeof value === 'object' && value !== null) {
          redacted[key] = redactBody(value)
        } else {
          redacted[key] = value
        }
        continue
      }

      // Check if key matches sensitive patterns (exact match or ends with sensitive keyword)
      const keyLower = key.toLowerCase()
      const shouldRedact = SENSITIVE_BODY_KEYS.some((sensitiveKey) => {
        const sensitiveKeyLower = sensitiveKey.toLowerCase()
        // Exact match
        if (keyLower === sensitiveKeyLower) {
          return true
        }
        // Key ends with sensitive keyword (e.g., 'api_token', 'access_token')
        // But exclude keys that contain allowed patterns (e.g., 'max_tokens')
        if (keyLower.endsWith(`_${sensitiveKeyLower}`) || keyLower.endsWith(sensitiveKeyLower)) {
          // Double check: make sure it's not a false positive
          return !ALLOWED_BODY_KEYS.some((allowed) => keyLower.includes(allowed.toLowerCase()))
        }
        return false
      })

      if (shouldRedact) {
        redacted[key] = '***REDACTED***'
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = redactBody(value)
      } else {
        redacted[key] = value
      }
    }

    return redacted
  }

  return body
}

/**
 * Redact sensitive information in full request preview
 * @param preview Request preview data
 * @returns Redacted preview
 */
export function redactRequestPreview(preview: { headers: Record<string, string>; body: unknown }): {
  headers: Record<string, string>
  body: unknown
} {
  return {
    headers: redactHeaders(preview.headers),
    body: redactBody(preview.body)
  }
}
