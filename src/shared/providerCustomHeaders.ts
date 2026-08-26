import { z } from 'zod'

export type ProviderCustomHeaders = Record<string, string>

export type ProviderCustomHeadersErrorCode =
  | 'invalid_object'
  | 'too_many_headers'
  | 'invalid_name'
  | 'name_too_long'
  | 'duplicate_name'
  | 'reserved_name'
  | 'invalid_value'
  | 'value_too_large'
  | 'headers_too_large'

export type ProviderCustomHeadersValidationResult =
  | { ok: true; value: ProviderCustomHeaders }
  | { ok: false; code: ProviderCustomHeadersErrorCode; headerName?: string }

export const PROVIDER_CUSTOM_HEADERS_MAX_COUNT = 64
export const PROVIDER_CUSTOM_HEADER_NAME_MAX_LENGTH = 128
export const PROVIDER_CUSTOM_HEADER_VALUE_MAX_BYTES = 8 * 1024
export const PROVIDER_CUSTOM_HEADERS_MAX_BYTES = 64 * 1024

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u
const INVALID_HEADER_VALUE_PATTERN = /[\r\n\0]|[^\u0000-\u00ff]/u

export const RESERVED_PROVIDER_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'api-key',
  'x-api-key',
  'x-goog-api-key',
  'content-type',
  'content-length',
  'host',
  'connection',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'keep-alive'
])

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength

export function validateProviderCustomHeaders(
  value: unknown
): ProviderCustomHeadersValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_object' }
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, code: 'invalid_object' }
  }

  const entries = Object.entries(value)
  if (entries.length > PROVIDER_CUSTOM_HEADERS_MAX_COUNT) {
    return { ok: false, code: 'too_many_headers' }
  }

  const normalizedNames = new Set<string>()
  for (const [name, headerValue] of entries) {
    if (name.length > PROVIDER_CUSTOM_HEADER_NAME_MAX_LENGTH) {
      return { ok: false, code: 'name_too_long', headerName: name }
    }
    if (!HEADER_NAME_PATTERN.test(name)) {
      return { ok: false, code: 'invalid_name', headerName: name }
    }

    const normalizedName = name.toLowerCase()
    if (normalizedNames.has(normalizedName)) {
      return { ok: false, code: 'duplicate_name', headerName: name }
    }
    if (RESERVED_PROVIDER_HEADER_NAMES.has(normalizedName)) {
      return { ok: false, code: 'reserved_name', headerName: name }
    }
    normalizedNames.add(normalizedName)

    if (typeof headerValue !== 'string' || INVALID_HEADER_VALUE_PATTERN.test(headerValue)) {
      return { ok: false, code: 'invalid_value', headerName: name }
    }
    if (utf8ByteLength(headerValue) > PROVIDER_CUSTOM_HEADER_VALUE_MAX_BYTES) {
      return { ok: false, code: 'value_too_large', headerName: name }
    }
  }

  if (utf8ByteLength(JSON.stringify(value)) > PROVIDER_CUSTOM_HEADERS_MAX_BYTES) {
    return { ok: false, code: 'headers_too_large' }
  }

  return { ok: true, value: value as ProviderCustomHeaders }
}

export function getValidProviderCustomHeaders(value: unknown): ProviderCustomHeaders | undefined {
  const result = validateProviderCustomHeaders(value)
  return result.ok && Object.keys(result.value).length > 0 ? result.value : undefined
}

export function canonicalizeProviderCustomHeaders(value: unknown): string {
  const headers = getValidProviderCustomHeaders(value)
  if (!headers) return ''

  return JSON.stringify(
    Object.entries(headers)
      .map(([name, headerValue]) => [name.toLowerCase(), headerValue] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  )
}

export function supportsProviderCustomHeaders(provider: {
  id: string
  apiType: string
  baseUrl: string
}): boolean {
  if (
    provider.id === 'acp' ||
    provider.id === 'aws-bedrock' ||
    provider.apiType === 'acp' ||
    provider.apiType === 'aws-bedrock'
  ) {
    return false
  }

  try {
    const url = new URL(provider.baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const ProviderCustomHeadersSchema = z
  .custom<ProviderCustomHeaders>()
  .superRefine((value, context) => {
    const result = validateProviderCustomHeaders(value)
    if (!result.ok) {
      context.addIssue({
        code: 'custom',
        message: `Invalid custom request headers: ${result.code}`
      })
    }
  })
