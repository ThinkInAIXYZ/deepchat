import {
  getValidProviderCustomHeaders,
  supportsProviderCustomHeaders
} from '@shared/providerCustomHeaders'
import type { LLM_PROVIDER } from '@shared/types/provider'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_PROVIDER_REDIRECTS = 20
const CROSS_ORIGIN_SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'api-key',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
  'host'
]

export const MASKED_PROVIDER_CUSTOM_HEADER_VALUE = '***MASKED***'

type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const getRequestUrl = (input: string | URL | Request): URL | null => {
  try {
    return new URL(input instanceof Request ? input.url : input.toString())
  } catch {
    return null
  }
}

const getProviderOrigin = (provider: LLM_PROVIDER): string | null => {
  if (!supportsProviderCustomHeaders(provider)) return null

  try {
    return new URL(provider.baseUrl).origin
  } catch {
    return null
  }
}

const isSameProviderOrigin = (provider: LLM_PROVIDER, input: string | URL | Request): boolean => {
  const providerOrigin = getProviderOrigin(provider)
  const requestUrl = getRequestUrl(input)
  return Boolean(providerOrigin && requestUrl && requestUrl.origin === providerOrigin)
}

const mergeInputHeaders = (input: string | URL | Request, init?: RequestInit): Headers => {
  return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
}

const applyCustomHeaders = (
  provider: LLM_PROVIDER,
  input: string | URL | Request,
  headers: Headers
): Headers => {
  if (!isSameProviderOrigin(provider, input)) return headers

  const customHeaders = getValidProviderCustomHeaders(provider.customHeaders)
  if (!customHeaders) return headers

  for (const [name, value] of Object.entries(customHeaders)) {
    headers.set(name, value)
  }
  return headers
}

const stripCrossOriginHeaders = (provider: LLM_PROVIDER, headers: Headers): void => {
  for (const name of CROSS_ORIGIN_SENSITIVE_HEADERS) {
    headers.delete(name)
  }
  for (const name of Object.keys(getValidProviderCustomHeaders(provider.customHeaders) ?? {})) {
    headers.delete(name)
  }
}

const shouldRewriteRedirectToGet = (status: number, method: string): boolean => {
  const normalizedMethod = method.toUpperCase()
  return (
    (status === 303 && normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') ||
    ((status === 301 || status === 302) && normalizedMethod === 'POST')
  )
}

export function buildProviderTraceHeaders(
  provider: LLM_PROVIDER,
  endpoint: string,
  source: Record<string, string>
): Record<string, string> {
  const headers = new Headers(source)
  const sameProviderOrigin = isSameProviderOrigin(provider, endpoint)

  for (const name of Object.keys(getValidProviderCustomHeaders(provider.customHeaders) ?? {})) {
    if (sameProviderOrigin || headers.has(name)) {
      headers.set(name, MASKED_PROVIDER_CUSTOM_HEADER_VALUE)
    }
  }
  return Object.fromEntries(headers.entries())
}

export async function fetchWithProviderHeaders(
  provider: LLM_PROVIDER,
  input: string | URL | Request,
  init?: RequestInit,
  fetchImpl: ProviderFetch = fetch
): Promise<Response> {
  if (
    !getValidProviderCustomHeaders(provider.customHeaders) ||
    !isSameProviderOrigin(provider, input)
  ) {
    return fetchImpl(input, init)
  }

  const redirectMode = init?.redirect ?? (input instanceof Request ? input.redirect : 'follow')
  if (redirectMode !== 'follow') {
    const headers = applyCustomHeaders(provider, input, mergeInputHeaders(input, init))
    return fetchImpl(input instanceof Request ? input.clone() : input, { ...init, headers })
  }

  let currentInput = input
  let currentInit = { ...init }

  for (let redirectCount = 0; ; redirectCount += 1) {
    const currentUrl = getRequestUrl(currentInput)
    const headers = applyCustomHeaders(
      provider,
      currentInput,
      mergeInputHeaders(currentInput, currentInit)
    )
    const response = await fetchImpl(
      currentInput instanceof Request ? currentInput.clone() : currentInput,
      {
        ...currentInit,
        headers,
        redirect: 'manual'
      }
    )

    if (!REDIRECT_STATUSES.has(response.status)) return response
    if (!currentUrl || redirectCount >= MAX_PROVIDER_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Provider request redirect limit exceeded')
    }

    const location = response.headers.get('location')
    if (!location) return response

    const nextUrl = new URL(location, currentUrl)
    const nextHeaders = mergeInputHeaders(currentInput, currentInit)
    if (nextUrl.origin !== currentUrl.origin) {
      stripCrossOriginHeaders(provider, nextHeaders)
    }

    const currentMethod =
      currentInit.method ?? (currentInput instanceof Request ? currentInput.method : 'GET')
    const rewriteToGet = shouldRewriteRedirectToGet(response.status, currentMethod)
    const nextBody = rewriteToGet
      ? undefined
      : (currentInit.body ??
        (currentInput instanceof Request && !['GET', 'HEAD'].includes(currentMethod.toUpperCase())
          ? currentInput.clone().body
          : undefined))
    const requestRedirectInit =
      currentInput instanceof Request
        ? {
            cache: currentInput.cache,
            credentials: currentInput.credentials,
            integrity: currentInput.integrity,
            keepalive: currentInput.keepalive,
            mode: currentInput.mode,
            referrer: currentInput.referrer,
            referrerPolicy: currentInput.referrerPolicy,
            signal: currentInput.signal
          }
        : undefined

    if (rewriteToGet) {
      nextHeaders.delete('content-length')
      nextHeaders.delete('content-type')
    }

    await response.body?.cancel().catch(() => undefined)
    currentInput = nextUrl
    currentInit = {
      ...requestRedirectInit,
      ...currentInit,
      method: rewriteToGet ? 'GET' : currentMethod,
      body: nextBody,
      headers: nextHeaders,
      redirect: 'manual',
      // Streaming request bodies are not buffered. As with native fetch, another
      // body-preserving redirect can fail after the stream has been consumed.
      ...(nextBody instanceof ReadableStream ? { duplex: 'half' as const } : {})
    }
  }
}
