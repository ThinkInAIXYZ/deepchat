import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitHubCopilotDeviceFlow } from '@/presenter/githubCopilotDeviceFlow'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  shell: { openExternal: vi.fn() }
}))

vi.mock('@/presenter', () => ({
  presenter: {}
}))

describe('GitHubCopilotDeviceFlow cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const createAuthenticatedFlow = () => {
    const flow = new GitHubCopilotDeviceFlow({ clientId: 'client', scope: 'read:user' })
    ;(flow as unknown as { oauthToken: string }).oauthToken = 'oauth-token'
    return flow
  }

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
    const flow = createAuthenticatedFlow()
    const controller = new AbortController()
    const reason = { source: 'memory-caller' }

    const token = flow.getCopilotToken(controller.signal)
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
    const flow = createAuthenticatedFlow()
    const controller = new AbortController()
    const reason = new DOMException('Already cancelled', 'AbortError')
    controller.abort(reason)

    await expect(flow.getCopilotToken(controller.signal)).rejects.toBe(reason)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
