import type { ProviderSettingsPort } from '@/provider/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GithubCopilotProvider } from '../../../src/main/provider/providers/githubCopilotProvider'
import { extractProviderFailureMetadata } from '@/provider/providerFailure'

import { getGitHubCopilotToken } from '../../../src/main/provider/auth/githubCopilotDeviceFlow'

vi.mock('../../../src/main/provider/auth/githubCopilotDeviceFlow', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/main/provider/auth/githubCopilotDeviceFlow')
  >()),
  getGitHubCopilotToken: vi.fn()
}))

describe('GithubCopilotProvider request timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetAllMocks()
  })

  it('does not promote catalog capabilities into provider facts', async () => {
    const provider = Object.create(GithubCopilotProvider.prototype) as GithubCopilotProvider & {
      provider: { id: string }
      providerSettings: Pick<ProviderSettingsPort, 'getDbProviderModels'>
    }
    provider.provider = { id: 'github-copilot' }
    provider.providerSettings = {
      getDbProviderModels: vi.fn().mockReturnValue([
        {
          id: 'gpt-5.6-sol',
          name: 'GPT-5.6 Sol',
          provider: 'github-copilot',
          providerId: 'github-copilot',
          group: 'default',
          enabled: false,
          isCustom: false,
          contextLength: 1_050_000,
          maxTokens: 32_000,
          vision: true,
          functionCall: true,
          reasoning: true
        }
      ])
    }

    await expect((provider as any).fetchProviderModels()).resolves.toEqual([
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        group: 'default',
        providerId: 'github-copilot',
        isCustom: false
      }
    ])
  })

  it('aborts completion requests when the model timeout elapses', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = options?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => reject(new Error('transport wrapped abort')), {
          once: true
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = Object.create(GithubCopilotProvider.prototype) as GithubCopilotProvider & {
      provider: { id: string; name: string }
      providerSettings: { getModelConfig: ReturnType<typeof vi.fn> }
      baseApiUrl: string
      getCopilotToken: ReturnType<typeof vi.fn>
    }
    provider.provider = { id: 'github-copilot', name: 'GitHub Copilot' }
    provider.providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({ timeout: 25 })
    }
    provider.baseApiUrl = 'https://api.githubcopilot.com'
    provider.getCopilotToken = vi.fn().mockResolvedValue('token')

    const completionAssertion = expect(
      provider.completions([{ role: 'user', content: 'hello' }] as any, 'gpt-5')
    ).rejects.toThrow('Request timed out after 25ms')

    await vi.advanceTimersByTimeAsync(25)

    await completionAssertion
    expect(provider.getCopilotToken).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/chat/completions',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('forwards caller cancellation through generateText to the fetch request', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = options?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => reject(new Error('transport wrapped abort')), {
          once: true
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = Object.create(GithubCopilotProvider.prototype) as GithubCopilotProvider & {
      provider: { id: string; name: string }
      providerSettings: { getModelConfig: ReturnType<typeof vi.fn> }
      baseApiUrl: string
      getCopilotToken: ReturnType<typeof vi.fn>
    }
    provider.provider = { id: 'github-copilot', name: 'GitHub Copilot' }
    provider.providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({})
    }
    provider.baseApiUrl = 'https://api.githubcopilot.com'
    provider.getCopilotToken = vi.fn().mockResolvedValue('token')
    const controller = new AbortController()
    const reason = { source: 'memory-caller' }

    const completion = provider.generateText('hello', 'gpt-5', undefined, undefined, {
      signal: controller.signal
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort(reason)

    await expect(completion).rejects.toBe(reason)
    expect(provider.getCopilotToken).toHaveBeenCalledWith(controller.signal)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/chat/completions',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('does not retry a cancelled token exchange', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(getGitHubCopilotToken).mockImplementationOnce(
      (_oauthToken, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const provider = Object.create(GithubCopilotProvider.prototype) as any
    provider.provider = {
      id: 'github-copilot',
      name: 'GitHub Copilot',
      apiKey: 'fallback-oauth-token'
    }
    provider.copilotToken = null
    provider.tokenExpiresAt = 0
    const controller = new AbortController()
    const reason = new DOMException('Memory request aborted', 'AbortError')

    const token = provider.getCopilotToken(controller.signal)
    await vi.waitFor(() => expect(getGitHubCopilotToken).toHaveBeenCalledOnce())
    controller.abort(reason)

    await expect(token).rejects.toBe(reason)
    expect(getGitHubCopilotToken).toHaveBeenCalledWith('fallback-oauth-token', controller.signal)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts streamed requests when the model timeout elapses', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = options?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = Object.create(GithubCopilotProvider.prototype) as GithubCopilotProvider & {
      provider: { id: string; name: string }
      baseApiUrl: string
      getCopilotToken: ReturnType<typeof vi.fn>
    }
    provider.provider = { id: 'github-copilot', name: 'GitHub Copilot' }
    provider.baseApiUrl = 'https://api.githubcopilot.com'
    provider.getCopilotToken = vi.fn().mockResolvedValue('token')

    const nextAssertion = expect(
      provider
        .coreStream(
          [{ role: 'user', content: 'hello' }] as any,
          'gpt-5',
          { timeout: 25 } as any,
          0.7,
          1024,
          []
        )
        .next()
    ).rejects.toThrow('Request timed out after 25ms')

    await vi.advanceTimersByTimeAsync(25)

    await nextAssertion
    expect(provider.getCopilotToken).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/chat/completions',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('forwards caller cancellation to streamed requests', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = options?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = Object.create(GithubCopilotProvider.prototype) as any
    provider.provider = { id: 'github-copilot', name: 'GitHub Copilot' }
    provider.baseApiUrl = 'https://api.githubcopilot.com'
    provider.getCopilotToken = vi.fn().mockResolvedValue('token')
    const controller = new AbortController()
    const reason = new DOMException('Run aborted', 'AbortError')

    const next = provider
      .coreStream([{ role: 'user', content: 'hello' }], 'gpt-5', {}, 0.7, 1024, [], {
        signal: controller.signal
      })
      .next()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort(reason)

    await expect(next).rejects.toBe(reason)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/chat/completions',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('preserves retry headers without exposing a failed response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"secret":"response-body"}', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
          'retry-after': '3',
          'set-cookie': 'session=secret'
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = Object.create(GithubCopilotProvider.prototype) as any
    provider.provider = { id: 'github-copilot', name: 'GitHub Copilot' }
    provider.baseApiUrl = 'https://api.githubcopilot.com'
    provider.getCopilotToken = vi.fn().mockResolvedValue('token')

    let failure: unknown
    try {
      await provider
        .coreStream([{ role: 'user', content: 'hello' }], 'gpt-5', {}, 0.7, 1024, [])
        .next()
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      message: 'GitHub Copilot API error: 503 Service Unavailable'
    })
    expect(extractProviderFailureMetadata(failure)).toEqual({
      statusCode: 503,
      code: 'github_copilot_chat_http_error',
      retryHeaders: { 'retry-after': '3' }
    })
    expect(String(failure)).not.toContain('response-body')
  })

  it('emits an explicit completion marker for a successful SSE stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', {
          status: 200
        })
      )
    )
    const provider = Object.create(GithubCopilotProvider.prototype) as any
    provider.provider = { id: 'github-copilot', name: 'GitHub Copilot' }
    provider.baseApiUrl = 'https://api.githubcopilot.com'
    provider.getCopilotToken = vi.fn().mockResolvedValue('token')

    const events = []
    for await (const event of provider.coreStream(
      [{ role: 'user', content: 'hello' }],
      'gpt-5',
      {},
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'text', content: 'hello' },
      { type: 'stop', stop_reason: 'complete' }
    ])
  })

  it.each([true, false])(
    'uses the session token and Copilot client metadata (stream=%s)',
    async (stream) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          stream
            ? new Response('data: [DONE]\n\n')
            : Response.json({ choices: [{ message: { content: 'hello' } }] })
        )
      vi.stubGlobal('fetch', fetchMock)
      vi.mocked(getGitHubCopilotToken).mockResolvedValueOnce({
        token: 'session-token',
        expires_at: Date.now() / 1000 + 3600
      })
      const provider = Object.create(GithubCopilotProvider.prototype) as any
      provider.provider = {
        id: 'github-copilot',
        apiKey: 'oauth-token',
        baseUrl: 'https://api.githubcopilot.com'
      }
      provider.baseApiUrl = 'https://api.githubcopilot.com'
      provider.providerSettings = { getModelConfig: vi.fn().mockReturnValue({}) }

      if (stream) {
        for await (const _event of provider.coreStream(
          [{ role: 'user', content: 'hello' }],
          'gpt-4o',
          {},
          0.7,
          1024,
          []
        )) {
          // Consume the stream to exercise the complete request lifecycle.
        }
      } else {
        await provider.completions([{ role: 'user', content: 'hello' }], 'gpt-4o')
      }

      expect(getGitHubCopilotToken).toHaveBeenCalledWith('oauth-token', undefined)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.githubcopilot.com/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer session-token',
            'Editor-Version': 'vscode/1.115.0',
            'Editor-Plugin-Version': 'copilot-chat/0.44.0',
            'Copilot-Integration-Id': 'vscode-chat'
          })
        })
      )
    }
  )

  it('refreshes cached auth state when provider config changes', () => {
    const provider = Object.create(GithubCopilotProvider.prototype) as GithubCopilotProvider & {
      provider: Record<string, unknown>
      providerSettings: Pick<ProviderSettingsPort, 'getProviderModels' | 'getCustomModels'>
      models: unknown[]
      customModels: unknown[]
      copilotToken: string | null
      tokenExpiresAt: number
    }

    provider.provider = {
      id: 'github-copilot',
      name: 'GitHub Copilot',
      copilotClientId: 'old-client'
    }
    provider.providerSettings = {
      getProviderModels: vi.fn(() => []),
      getCustomModels: vi.fn(() => [])
    }
    provider.models = []
    provider.customModels = []
    provider.copilotToken = 'cached-token'
    provider.tokenExpiresAt = 123
    provider.updateConfig({
      id: 'github-copilot',
      name: 'GitHub Copilot',
      copilotClientId: 'new-client',
      enable: true
    } as any)

    expect(provider.copilotToken).toBeNull()
    expect(provider.tokenExpiresAt).toBe(0)
    expect(provider.provider.copilotClientId).toBe('new-client')
  })

  it('preserves assistant tool calls and empty reasoning_content when formatting messages', () => {
    const provider = Object.create(GithubCopilotProvider.prototype) as GithubCopilotProvider

    const result = (provider as any).formatMessages([
      {
        role: 'assistant',
        content: '',
        reasoning_content: '',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"weather"}' }
          }
        ]
      }
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: '',
        reasoning_content: '',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"weather"}' }
          }
        ]
      }
    ])
  })

  it('reuses a valid session and refreshes it after expiry', async () => {
    vi.useFakeTimers()
    const provider = Object.create(GithubCopilotProvider.prototype) as any
    provider.provider = { id: 'github-copilot', apiKey: 'oauth-token' }
    vi.mocked(getGitHubCopilotToken)
      .mockResolvedValueOnce({ token: 'first-session', expires_at: Date.now() / 1000 + 60 })
      .mockResolvedValueOnce({ token: 'second-session', expires_at: Date.now() / 1000 + 120 })

    await expect(provider.check()).resolves.toEqual({ isOk: true, errorMsg: null })
    await expect(provider.check()).resolves.toEqual({ isOk: true, errorMsg: null })
    expect(getGitHubCopilotToken).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(60_000)
    await expect(provider.check()).resolves.toEqual({ isOk: true, errorMsg: null })
    expect(getGitHubCopilotToken).toHaveBeenCalledTimes(2)
  })

  it('preserves saved credentials and the original error when token exchange fails', async () => {
    const provider = Object.create(GithubCopilotProvider.prototype) as any
    provider.provider = { id: 'github-copilot', apiKey: 'oauth-token', enable: true }
    provider.fetchModels = vi.fn().mockResolvedValue([])
    provider.autoEnableModelsIfNeeded = vi.fn().mockResolvedValue(undefined)
    const message = 'GitHub Copilot token exchange failed: 403 Forbidden - request_id=ABCD:1234'
    vi.mocked(getGitHubCopilotToken).mockRejectedValueOnce(new Error(message))

    await provider.init()
    await expect(provider.check()).resolves.toEqual({ isOk: false, errorMsg: message })
    expect(provider.provider.apiKey).toBe('oauth-token')
    expect(getGitHubCopilotToken).toHaveBeenCalledOnce()
  })

  it('does not cache an old account session after configuration changes during exchange', async () => {
    const provider = Object.create(GithubCopilotProvider.prototype) as any
    provider.provider = { id: 'github-copilot', apiKey: 'old-account' }
    provider.providerSettings = {
      getProviderModels: vi.fn(() => []),
      getCustomModels: vi.fn(() => [])
    }
    let finishExchange!: (value: { token: string; expires_at: number }) => void
    vi.mocked(getGitHubCopilotToken).mockImplementationOnce(() => {
      return new Promise((resolve) => {
        finishExchange = resolve
      })
    })
    const oldCheck = provider.check()
    provider.updateConfig({ id: 'github-copilot', apiKey: 'new-account' })
    finishExchange({ token: 'old-session', expires_at: Date.now() / 1000 + 3600 })
    await oldCheck
    vi.mocked(getGitHubCopilotToken).mockResolvedValueOnce({
      token: 'new-session',
      expires_at: Date.now() / 1000 + 3600
    })

    await expect(provider.check()).resolves.toEqual({ isOk: true, errorMsg: null })
    expect(getGitHubCopilotToken).toHaveBeenLastCalledWith('new-account', undefined)
  })
})
