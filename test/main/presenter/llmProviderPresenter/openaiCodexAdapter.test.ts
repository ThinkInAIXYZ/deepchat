import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  forceRefreshAccessToken: vi.fn(),
  getBackendAuth: vi.fn(),
  forceRefreshBackendAuth: vi.fn()
}))

const proxyState = vi.hoisted(() => ({
  getProxyUrl: vi.fn()
}))

vi.mock('../../../../src/main/presenter/openaiCodexAuth', () => ({
  getGlobalOpenAICodexAuth: () => authState
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: proxyState.getProxyUrl
  }
}))

describe('OpenAI Codex adapter', () => {
  beforeEach(() => {
    authState.getAccessToken.mockReset()
    authState.forceRefreshAccessToken.mockReset()
    authState.getBackendAuth.mockReset()
    authState.forceRefreshBackendAuth.mockReset()
    proxyState.getProxyUrl.mockReset()
    proxyState.getProxyUrl.mockReturnValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes Codex base URLs away from the OpenAI API host', async () => {
    const { normalizeOpenAICodexBaseUrl } =
      await import('../../../../src/main/presenter/llmProviderPresenter/openaiCodexAdapter')

    expect(normalizeOpenAICodexBaseUrl('https://api.openai.com/v1')).toBe(
      'https://chatgpt.com/backend-api/codex'
    )
    expect(normalizeOpenAICodexBaseUrl('https://chatgpt.com/backend-api/codex/responses')).toBe(
      'https://chatgpt.com/backend-api/codex'
    )
  })

  it('injects Codex bearer tokens and retries one 401 with a refresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    )
    authState.getBackendAuth.mockResolvedValueOnce({
      accessToken: 'old-token',
      accountId: 'acct-1'
    })
    authState.forceRefreshBackendAuth.mockResolvedValueOnce({
      accessToken: 'new-token',
      accountId: 'acct-1'
    })

    const { createOpenAICodexFetch } =
      await import('../../../../src/main/presenter/llmProviderPresenter/openaiCodexAdapter')
    const fetcher = createOpenAICodexFetch({ 'X-Client': 'DeepChat' })

    const response = await fetcher('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: {
        'api-key': 'old-api-key',
        'x-api-key': 'old-x-api-key'
      }
    })

    const fetchMock = vi.mocked(fetch)
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Headers
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers
    expect(response.status).toBe(200)
    expect(firstHeaders.get('Authorization')).toBe('Bearer old-token')
    expect(firstHeaders.get('ChatGPT-Account-ID')).toBe('acct-1')
    expect(firstHeaders.get('OAI-Product-Sku')).toBe('codex')
    expect(firstHeaders.get('Accept')).toBe('text/event-stream')
    expect(firstHeaders.has('api-key')).toBe(false)
    expect(firstHeaders.has('x-api-key')).toBe(false)
    expect(secondHeaders.get('Authorization')).toBe('Bearer new-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reuses the proxy dispatcher until the proxy URL changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    )
    authState.getBackendAuth.mockResolvedValue({
      accessToken: 'token'
    })
    proxyState.getProxyUrl.mockReturnValue('http://127.0.0.1:1080')

    const { createOpenAICodexFetch } =
      await import('../../../../src/main/presenter/llmProviderPresenter/openaiCodexAdapter')
    const fetcher = createOpenAICodexFetch({})

    await fetcher('https://chatgpt.com/backend-api/codex/responses')
    await fetcher('https://chatgpt.com/backend-api/codex/responses')
    proxyState.getProxyUrl.mockReturnValue('http://127.0.0.1:1081')
    await fetcher('https://chatgpt.com/backend-api/codex/responses')

    const fetchMock = vi.mocked(fetch)
    const firstDispatcher = (fetchMock.mock.calls[0][1] as { dispatcher?: unknown }).dispatcher
    const secondDispatcher = (fetchMock.mock.calls[1][1] as { dispatcher?: unknown }).dispatcher
    const thirdDispatcher = (fetchMock.mock.calls[2][1] as { dispatcher?: unknown }).dispatcher

    expect(firstDispatcher).toBeDefined()
    expect(secondDispatcher).toBe(firstDispatcher)
    expect(thirdDispatcher).not.toBe(firstDispatcher)
  })

  it('normalizes Codex Responses request bodies for backend compatibility', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 })))
    authState.getBackendAuth.mockResolvedValueOnce({
      accessToken: 'token'
    })

    const { createOpenAICodexFetch } =
      await import('../../../../src/main/presenter/llmProviderPresenter/openaiCodexAdapter')
    const fetcher = createOpenAICodexFetch({})

    await fetcher('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-5.5',
        input: 'Hello',
        store: true,
        max_output_tokens: 1024
      })
    })

    const requestInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(requestInit.body))
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      input: 'Hello',
      store: false
    })
    expect(body).not.toHaveProperty('max_output_tokens')
  })

  it('preserves streaming responses and abort signals', async () => {
    const streamBody = 'data: {"type":"response.output_text.delta","delta":"hello"}\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(streamBody, { status: 200 })))
    authState.getBackendAuth.mockResolvedValueOnce({
      accessToken: 'stream-token'
    })

    const { createOpenAICodexFetch } =
      await import('../../../../src/main/presenter/llmProviderPresenter/openaiCodexAdapter')
    const fetcher = createOpenAICodexFetch({})
    const controller = new AbortController()
    const response = await fetcher('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      signal: controller.signal
    })

    expect(await response.text()).toBe(streamBody)
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal)
    expect(authState.forceRefreshBackendAuth).not.toHaveBeenCalled()
  })

  it('normalizes Codex entitlement errors to a stable permission error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'codex access requires an eligible plan' }), {
          status: 403,
          headers: {
            'Content-Type': 'application/json'
          }
        })
      )
    )
    authState.getBackendAuth.mockResolvedValueOnce({
      accessToken: 'token'
    })

    const { createOpenAICodexFetch } =
      await import('../../../../src/main/presenter/llmProviderPresenter/openaiCodexAdapter')
    const fetcher = createOpenAICodexFetch({})
    const response = await fetcher('https://chatgpt.com/backend-api/codex/responses')
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toMatchObject({
      type: 'permission_error',
      code: 'openai_codex_entitlement_required'
    })
  })

  it('normalizes Codex bad request bodies to readable AI SDK errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'missing ChatGPT account' } }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        })
      )
    )
    authState.getBackendAuth.mockResolvedValueOnce({
      accessToken: 'token'
    })

    const { createOpenAICodexFetch } =
      await import('../../../../src/main/presenter/llmProviderPresenter/openaiCodexAdapter')
    const fetcher = createOpenAICodexFetch({})
    const response = await fetcher('https://chatgpt.com/backend-api/codex/responses')
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatchObject({
      message: 'OpenAI Codex request failed: missing ChatGPT account',
      type: 'invalid_request_error',
      code: 'openai_codex_bad_request'
    })
  })
})
