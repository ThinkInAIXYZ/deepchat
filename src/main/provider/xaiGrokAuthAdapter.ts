import { getGlobalXaiGrokAuth } from '../provider/auth/xaiGrok'
import {
  XAI_GROK_API_BASE_URL,
  XAI_GROK_PROVIDER_ID,
  isTrustedXaiApiEndpoint
} from '../provider/auth/xaiGrok/constants'
import type { LLM_PROVIDER } from '@shared/types/provider'

function applyBearerHeaders(
  headersInit: HeadersInit | undefined,
  defaultHeaders: Record<string, string>,
  accessToken: string
): Headers {
  const headers = new Headers(headersInit ?? {})
  Object.entries(defaultHeaders).forEach(([key, value]) => headers.set(key, value))
  headers.set('Authorization', `Bearer ${accessToken}`)
  return headers
}

/**
 * Custom fetch for the Grok provider that prefers refreshed OAuth access tokens
 * and falls back to the configured API key.
 */
export function createXaiGrokFetch(
  provider: LLM_PROVIDER,
  defaultHeaders: Record<string, string>,
  baseFetch?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
) {
  const underlyingFetch = baseFetch ?? fetch

  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = url instanceof Request ? url.url : url.toString()
    if (!isTrustedXaiApiEndpoint(requestUrl)) {
      throw new Error('Refusing to send xAI credentials to an untrusted API endpoint')
    }

    const signal = init?.signal ?? (url instanceof Request ? url.signal : undefined)
    signal?.throwIfAborted()
    const auth = getGlobalXaiGrokAuth()
    const check = auth.captureOperation()
    const oauthToken = await auth.ensureAccessToken().catch((error) => {
      signal?.throwIfAborted()
      if (error instanceof Error && error.name === 'AbortError') throw error
      return null
    })
    check()
    signal?.throwIfAborted()
    const accessToken = oauthToken || provider.apiKey?.trim() || ''
    if (!accessToken) {
      throw new Error('Grok requires xAI OAuth sign-in or an API key')
    }

    const nextInit: RequestInit = {
      ...init,
      headers: applyBearerHeaders(init?.headers, defaultHeaders, accessToken)
    }

    let response = await underlyingFetch(url, nextInit)
    signal?.throwIfAborted()
    if (response.status !== 401 || !oauthToken) {
      return response
    }

    // OAuth token may have been revoked mid-session; force refresh once.
    try {
      check()
      signal?.throwIfAborted()
      const refreshed = await auth.forceRefreshAccessToken()
      check()
      signal?.throwIfAborted()
      if (!refreshed || refreshed === accessToken) {
        return response
      }
      return underlyingFetch(url, {
        ...nextInit,
        headers: applyBearerHeaders(init?.headers, defaultHeaders, refreshed)
      })
    } catch (error) {
      check()
      signal?.throwIfAborted()
      if (error instanceof Error && error.name === 'AbortError') throw error
      return response
    }
  }
}

export function shouldUseXaiGrokOAuthFetch(provider: LLM_PROVIDER): boolean {
  return (
    provider.id === XAI_GROK_PROVIDER_ID &&
    isTrustedXaiApiEndpoint(provider.baseUrl || XAI_GROK_API_BASE_URL)
  )
}
