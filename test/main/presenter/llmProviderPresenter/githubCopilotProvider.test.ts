import { afterEach, describe, expect, it, vi } from 'vitest'
import { GithubCopilotProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/githubCopilotProvider'
import type { IConfigPresenter } from '../../../../src/shared/presenter'
import { getGlobalGitHubCopilotDeviceFlow } from '../../../../src/main/presenter/githubCopilotDeviceFlow'

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../../src/main/presenter/githubCopilotDeviceFlow', () => ({
  getGlobalGitHubCopilotDeviceFlow: vi.fn(() => ({
    getCopilotToken: vi.fn(),
    checkExistingAuth: vi.fn()
  })),
  GitHubCopilotDeviceFlow: vi.fn()
}))

describe('GithubCopilotProvider request timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts completion requests when the model timeout elapses', async () => {
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
      configPresenter: { getModelConfig: ReturnType<typeof vi.fn> }
      baseApiUrl: string
      getCopilotToken: ReturnType<typeof vi.fn>
    }
    provider.provider = { id: 'github-copilot', name: 'GitHub Copilot' }
    provider.configPresenter = {
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

  it('refreshes cached auth state when provider config changes', () => {
    const provider = Object.create(GithubCopilotProvider.prototype) as GithubCopilotProvider & {
      provider: Record<string, unknown>
      configPresenter: Pick<IConfigPresenter, 'getProviderModels' | 'getCustomModels'>
      models: unknown[]
      customModels: unknown[]
      copilotToken: string | null
      tokenExpiresAt: number
      deviceFlow: unknown
    }

    provider.provider = {
      id: 'github-copilot',
      name: 'GitHub Copilot',
      copilotClientId: 'old-client'
    }
    provider.configPresenter = {
      getProviderModels: vi.fn(() => []),
      getCustomModels: vi.fn(() => [])
    }
    provider.models = []
    provider.customModels = []
    provider.copilotToken = 'cached-token'
    provider.tokenExpiresAt = 123
    provider.deviceFlow = { id: 'old-flow' }

    vi.mocked(getGlobalGitHubCopilotDeviceFlow).mockReturnValueOnce({ id: 'new-flow' } as any)

    provider.updateConfig({
      id: 'github-copilot',
      name: 'GitHub Copilot',
      copilotClientId: 'new-client',
      enable: true
    } as any)

    expect(provider.copilotToken).toBeNull()
    expect(provider.tokenExpiresAt).toBe(0)
    expect(provider.deviceFlow).toEqual({ id: 'new-flow' })
    expect(provider.provider.copilotClientId).toBe('new-client')
    expect(getGlobalGitHubCopilotDeviceFlow).toHaveBeenCalledWith('new-client')
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

  it('preserves cached auth state when acquiring a new device flow fails', () => {
    const provider = Object.create(GithubCopilotProvider.prototype) as GithubCopilotProvider & {
      provider: Record<string, unknown>
      configPresenter: Pick<IConfigPresenter, 'getProviderModels' | 'getCustomModels'>
      models: unknown[]
      customModels: unknown[]
      copilotToken: string | null
      tokenExpiresAt: number
      deviceFlow: unknown
    }

    provider.provider = {
      id: 'github-copilot',
      name: 'GitHub Copilot',
      copilotClientId: 'old-client'
    }
    provider.configPresenter = {
      getProviderModels: vi.fn(() => []),
      getCustomModels: vi.fn(() => [])
    }
    provider.models = []
    provider.customModels = []
    provider.copilotToken = 'cached-token'
    provider.tokenExpiresAt = 123
    provider.deviceFlow = { id: 'old-flow' }

    vi.mocked(getGlobalGitHubCopilotDeviceFlow).mockImplementationOnce(() => {
      throw new Error('device flow init failed')
    })

    expect(() =>
      provider.updateConfig({
        id: 'github-copilot',
        name: 'GitHub Copilot',
        copilotClientId: 'new-client',
        enable: true
      } as any)
    ).toThrow('device flow init failed')

    expect(provider.copilotToken).toBe('cached-token')
    expect(provider.tokenExpiresAt).toBe(123)
    expect(provider.deviceFlow).toEqual({ id: 'old-flow' })
    expect(provider.provider.copilotClientId).toBe('old-client')
  })
})
