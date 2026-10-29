import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  disposeGlobalGitHubCopilotDeviceFlow,
  getGlobalGitHubCopilotDeviceFlow
} from '@/provider/auth/githubCopilotDeviceFlow'
import { getGitHubCopilotToken } from '@/provider/auth/githubCopilotToken'
import { extractProviderFailureMetadata } from '@/provider/providerFailure'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function BrowserWindow() {}),
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn() }
}))

describe('GitHub Copilot token exchange', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    disposeGlobalGitHubCopilotDeviceFlow()
    vi.restoreAllMocks()
  })

  it.each([
    [undefined, undefined, 'Iv1.b507a08c87ecfe98'],
    [' ', ' ', 'Iv1.b507a08c87ecfe98'],
    [undefined, ' env-client ', 'env-client'],
    [' custom-client ', 'env-client', 'custom-client']
  ])(
    'requests a device code with the resolved client (%s, %s)',
    async (override, environment, expected) => {
      vi.stubEnv('VITE_GITHUB_CLIENT_ID', environment)
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        })
      )
      vi.stubGlobal('fetch', fetchMock)
      const flow = getGlobalGitHubCopilotDeviceFlow(override)
      vi.spyOn(flow as any, 'showUserCodeAndOpenBrowser').mockResolvedValue(undefined)
      vi.spyOn(flow as any, 'pollForAccessToken').mockResolvedValue('oauth-token')

      await expect(flow.startDeviceFlow()).resolves.toBe('oauth-token')

      expect(fetchMock).toHaveBeenCalledWith(
        'https://github.com/login/device/code',
        expect.objectContaining({
          body: JSON.stringify({ client_id: expected, scope: 'read:user read:org' })
        })
      )
    }
  )

  it('forwards the exact caller signal to the Copilot token exchange', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = options?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => reject(new Error('transport wrapped abort')), {
          once: true
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const reason = { source: 'memory-caller' }

    const token = getGitHubCopilotToken('oauth-token', controller.signal)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort(reason)

    await expect(token).rejects.toBe(reason)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/v2/token',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('does not start a token exchange for a pre-aborted request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const reason = new DOMException('Already cancelled', 'AbortError')
    controller.abort(reason)

    await expect(getGitHubCopilotToken('oauth-token', controller.signal)).rejects.toBe(reason)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exchanges the current OAuth credential using the GitHub token protocol', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ token: 'session-token', expires_at: 2_000_000_000 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getGitHubCopilotToken('oauth-token')).resolves.toEqual({
      token: 'session-token',
      expires_at: 2_000_000_000
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/v2/token',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token oauth-token',
          'X-GitHub-Api-Version': '2025-04-01'
        })
      })
    )
  })

  it.each([
    {},
    { token: ' ', expires_at: 2_000_000_000 },
    { token: 'session\r\nsecret', expires_at: 2_000_000_000 },
    { token: 'session-token', expires_at: '2000000000' }
  ])('rejects malformed successful token responses: %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))

    await expect(getGitHubCopilotToken('oauth-token')).rejects.toThrow(
      'Invalid GitHub Copilot token response'
    )
  })

  it('rejects invalid OAuth credentials before they can reach HTTP errors or logs', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getGitHubCopilotToken('oauth\r\nsecret')).rejects.toThrow(
      'No GitHub OAuth token available'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves token failure details and retry headers without exposing credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error_details: {
              code: 'not_authorized',
              message: 'Denied oauth-token; Bearer session-secret; access_token="another-secret"'
            },
            token: 'private-response-field'
          },
          {
            status: 403,
            statusText: 'Forbidden',
            headers: { 'x-github-request-id': 'ABCD:1234', 'retry-after': '3' }
          }
        )
      )
    )
    let failure: unknown
    try {
      await getGitHubCopilotToken('oauth-token')
    } catch (error) {
      failure = error
    }

    expect(String(failure)).toContain('token exchange failed: 403 Forbidden')
    expect(String(failure)).toContain('code=not_authorized; request_id=ABCD:1234')
    for (const secret of [
      'oauth-token',
      'session-secret',
      'another-secret',
      'private-response-field'
    ]) {
      expect(String(failure)).not.toContain(secret)
    }
    expect(extractProviderFailureMetadata(failure)).toEqual({
      statusCode: 403,
      code: 'github_copilot_token_http_error',
      retryHeaders: { 'retry-after': '3' }
    })
  })
})
