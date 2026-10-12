import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthService } from '@/provider/auth'
import type { LLM_PROVIDER } from '@shared/types/provider'

const mocks = vi.hoisted(() => ({
  startDeviceFlow: vi.fn(),
  startLogin: vi.fn(),
  exchangeCodeForToken: vi.fn()
}))

vi.mock('@/provider/auth/githubCopilotDeviceFlow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/provider/auth/githubCopilotDeviceFlow')>()),
  getGlobalGitHubCopilotDeviceFlow: () => ({ startDeviceFlow: mocks.startDeviceFlow })
}))
vi.mock('@/provider/auth/githubCopilotOAuth', () => ({
  createGitHubCopilotOAuth: () => ({
    startLogin: mocks.startLogin,
    exchangeCodeForToken: mocks.exchangeCodeForToken
  })
}))
vi.mock('@/provider/auth/openaiCodex', () => ({
  initializeGlobalOpenAICodexAuth: vi.fn()
}))
vi.mock('@/provider/auth/xaiGrok', () => ({
  initializeGlobalXaiGrokAuth: vi.fn()
}))

describe('GitHub Copilot login validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
  })

  const setup = () => {
    const provider: LLM_PROVIDER = {
      id: 'github-copilot',
      name: 'GitHub Copilot',
      apiType: 'github-copilot',
      apiKey: 'saved-oauth-token',
      baseUrl: 'https://api.githubcopilot.com',
      enable: true
    }
    mocks.startDeviceFlow.mockResolvedValue('new-oauth-token')
    mocks.startLogin.mockResolvedValue('auth-code')
    mocks.exchangeCodeForToken.mockResolvedValue('new-oauth-token')
    const setProviderById = vi.fn()
    const service = new OAuthService({ getProviderById: () => provider, setProviderById }, vi.fn())
    return { provider, service, setProviderById }
  }

  for (const method of ['startGitHubCopilotDeviceFlowLogin', 'startGitHubCopilotLogin'] as const) {
    it(`${method} saves credentials only after Copilot accepts them`, async () => {
      const { provider, service, setProviderById } = setup()
      const fetchMock = vi.fn(async (_url: string) => {
        expect(setProviderById).not.toHaveBeenCalled()
        return Response.json({ token: 'copilot-session', expires_at: 2_000_000_000 })
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(service[method](provider.id)).resolves.toBe(true)

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/copilot_internal/v2/token')
      expect(setProviderById).toHaveBeenCalledWith(provider.id, {
        ...provider,
        apiKey: 'new-oauth-token'
      })
      expect(provider.apiKey).toBe('saved-oauth-token')
    })

    it(`${method} surfaces Copilot rejection without replacing saved credentials`, async () => {
      const { provider, service, setProviderById } = setup()
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json(
          { error_details: { message: 'Copilot access denied', code: 'not_authorized' } },
          {
            status: 403,
            statusText: 'Forbidden',
            headers: { 'x-github-request-id': 'ABCD:1234' }
          }
        )
      )
      vi.stubGlobal('fetch', fetchMock)

      await expect(service[method](provider.id)).rejects.toThrow(
        'GitHub Copilot token exchange failed: 403 Forbidden - Copilot access denied; code=not_authorized; request_id=ABCD:1234'
      )
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(setProviderById).not.toHaveBeenCalled()
      expect(provider.apiKey).toBe('saved-oauth-token')
    })
  }
})
