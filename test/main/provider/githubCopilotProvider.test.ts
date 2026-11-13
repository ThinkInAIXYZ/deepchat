import type { ProviderSettingsPort } from '@/provider/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GithubCopilotProvider } from '../../../src/main/provider/providers/githubCopilotProvider'

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
})
