import { ProxyAgent } from 'undici'
import { proxyConfig } from '../proxyConfig'
import { OPENAI_CODEX_API_BASE_URL, isOpenAICodexDisabled } from '../openaiCodexAuth/constants'
import { getGlobalOpenAICodexAuth, type OpenAICodexBackendAuth } from '../openaiCodexAuth'

type FetchInitWithDispatcher = RequestInit & {
  dispatcher?: ProxyAgent
}

const OPENAI_CODEX_PRODUCT_SKU = 'codex'

function stripResponsesSuffix(pathname: string): string {
  return pathname.replace(/\/responses\/?$/i, '') || '/'
}

export function normalizeOpenAICodexBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!normalized) {
    return OPENAI_CODEX_API_BASE_URL
  }

  try {
    const url = new URL(normalized)
    if (url.hostname === 'api.openai.com') {
      return OPENAI_CODEX_API_BASE_URL
    }
    url.pathname = stripResponsesSuffix(url.pathname).replace(/\/+$/, '')
    return url.toString().replace(/\/+$/, '')
  } catch {
    return normalized.replace(/\/responses\/?$/i, '')
  }
}

export function buildOpenAICodexResponsesEndpoint(baseUrl: string | undefined): string {
  return `${normalizeOpenAICodexBaseUrl(baseUrl)}/responses`
}

function isLikelyEntitlementError(status: number, body: string): boolean {
  if (![401, 403, 404].includes(status)) {
    return false
  }

  return /entitlement|not entitled|eligible|subscription|plan|codex access|forbidden|permission/i.test(
    body
  )
}

function extractOpenAICodexErrorMessage(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) {
    return 'OpenAI Codex request was rejected by the ChatGPT backend.'
  }

  try {
    const payload = JSON.parse(trimmed) as unknown
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>
      const error = record.error
      if (error && typeof error === 'object') {
        const errorRecord = error as Record<string, unknown>
        if (typeof errorRecord.message === 'string' && errorRecord.message.trim()) {
          return errorRecord.message.trim()
        }
      }
      if (typeof record.message === 'string' && record.message.trim()) {
        return record.message.trim()
      }
      if (typeof record.detail === 'string' && record.detail.trim()) {
        return record.detail.trim()
      }
    }
  } catch {}

  return trimmed.slice(0, 1000)
}

export async function normalizeOpenAICodexErrorResponse(response: Response): Promise<Response> {
  if (response.ok) {
    return response
  }

  const body = await response
    .clone()
    .text()
    .catch(() => '')

  if (!isLikelyEntitlementError(response.status, body)) {
    if (response.status === 400) {
      return new Response(
        JSON.stringify({
          error: {
            message: `OpenAI Codex request failed: ${extractOpenAICodexErrorMessage(body)}`,
            type: 'invalid_request_error',
            code: 'openai_codex_bad_request'
          }
        }),
        {
          status: 400,
          statusText: response.statusText || 'Bad Request',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    }

    return response
  }

  return new Response(
    JSON.stringify({
      error: {
        message:
          'OpenAI Codex access is unavailable for this ChatGPT account. Sign in with an account that has Codex access, then retry.',
        type: 'permission_error',
        code: 'openai_codex_entitlement_required'
      }
    }),
    {
      status: 403,
      statusText: 'Forbidden',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
}

function normalizeOpenAICodexRequestBody(
  body: RequestInit['body'] | null | undefined
): RequestInit['body'] | null | undefined {
  if (typeof body !== 'string') {
    return body
  }

  try {
    const payload = JSON.parse(body) as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return body
    }

    const normalized: Record<string, unknown> = {
      ...(payload as Record<string, unknown>),
      store: false
    }
    delete normalized.max_output_tokens

    return JSON.stringify(normalized)
  } catch {
    return body
  }
}

function applyCodexHeaders(
  inputHeaders: HeadersInit | undefined,
  defaultHeaders: Record<string, string>,
  auth: OpenAICodexBackendAuth
): Headers {
  const headers = new Headers(inputHeaders ?? {})
  Object.entries(defaultHeaders).forEach(([key, value]) => headers.set(key, value))
  headers.delete('api-key')
  headers.delete('x-api-key')
  headers.delete('x-goog-api-key')
  headers.set('Authorization', `Bearer ${auth.accessToken}`)
  if (auth.accountId) {
    headers.set('ChatGPT-Account-ID', auth.accountId)
  }
  headers.set('OAI-Product-Sku', OPENAI_CODEX_PRODUCT_SKU)
  if (!headers.has('Accept')) {
    headers.set('Accept', 'text/event-stream')
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

export function createOpenAICodexFetch(defaultHeaders: Record<string, string>) {
  let currentProxyUrl: string | null = null
  let proxyAgent: ProxyAgent | undefined

  const closeProxyAgent = () => {
    if (proxyAgent) {
      void proxyAgent.close().catch(() => undefined)
    }
    proxyAgent = undefined
    currentProxyUrl = null
  }

  const getDispatcher = () => {
    const proxyUrl = proxyConfig.getProxyUrl()
    if (!proxyUrl) {
      closeProxyAgent()
      return undefined
    }

    if (currentProxyUrl !== proxyUrl || !proxyAgent) {
      closeProxyAgent()
      proxyAgent = new ProxyAgent(proxyUrl)
      currentProxyUrl = proxyUrl
    }

    return proxyAgent
  }

  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (isOpenAICodexDisabled()) {
      throw new Error('OpenAI Codex provider is disabled by environment')
    }

    const dispatcher = getDispatcher()
    const auth = getGlobalOpenAICodexAuth()
    const backendAuth = await auth.getBackendAuth()
    const nextInit: FetchInitWithDispatcher = {
      ...init,
      body: normalizeOpenAICodexRequestBody(init?.body),
      headers: applyCodexHeaders(init?.headers, defaultHeaders, backendAuth)
    }

    if (dispatcher) {
      nextInit.dispatcher = dispatcher
    }

    let response = await fetch(url, nextInit)
    if (response.status !== 401) {
      return normalizeOpenAICodexErrorResponse(response)
    }

    const refreshedAuth = await auth.forceRefreshBackendAuth()
    response = await fetch(url, {
      ...nextInit,
      headers: applyCodexHeaders(init?.headers, defaultHeaders, refreshedAuth)
    })
    return normalizeOpenAICodexErrorResponse(response)
  }
}
