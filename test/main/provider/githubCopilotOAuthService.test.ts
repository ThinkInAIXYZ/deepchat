import { afterEach, describe, expect, it, vi } from 'vitest'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { OAuthService } from '../../../src/harness/core/oauth'
import type { GitHubCopilotSignInTarget } from '@shared/types/oauth'

const mocks = vi.hoisted(() => ({
  startDeviceFlow: vi.fn(),
  startLogin: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  stop: vi.fn()
}))

const accepted = () => Response.json({ token: 'copilot-session', expires_at: 2_000_000_000 })
const setup = () => {
  const target: GitHubCopilotSignInTarget = {
    providerId: 'github-copilot',
    clientId: 'test-client',
    configurationId: 'opaque-configuration-identity'
  }
  const owner = {
    getGitHubCopilotSignInTarget: vi.fn(async () => target),
    commitGitHubCopilotCredential: vi.fn(async () => {}),
    invalidateGitHubCopilotSignIns: vi.fn(async () => {})
  }
  mocks.startDeviceFlow.mockResolvedValue('new-oauth-token')
  mocks.startLogin.mockResolvedValue('auth-code')
  mocks.exchangeCodeForToken.mockResolvedValue('new-oauth-token')
  const signedOut = async () => ({
    state: 'signed-out' as const,
    authenticated: false,
    storage: 'none' as const
  })
  const accounts = {
    getOpenAICodexStatus: vi.fn(signedOut),
    startOpenAICodexBrowserLogin: vi.fn(signedOut),
    completeOpenAICodexBrowserLoginFromUrl: vi.fn(async (_url: string) => signedOut()),
    cancelOpenAICodexLogin: vi.fn(signedOut),
    logoutOpenAICodex: vi.fn(signedOut),
    getXaiGrokStatus: vi.fn(signedOut),
    startXaiGrokDeviceLogin: vi.fn(signedOut),
    cancelXaiGrokLogin: vi.fn(signedOut),
    logoutXaiGrok: vi.fn(signedOut),
    stop: mocks.stop
  }
  const service = new OAuthService(owner, accounts, {
    device: async () => await mocks.startDeviceFlow(),
    browser: async () => {
      const code = await mocks.startLogin()
      return await mocks.exchangeCodeForToken(code)
    }
  })
  return { target, owner, service, accounts }
}

describe('GitHub Copilot login owner commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
  })

  it.each([false, true])(
    'drains accepted authorization and account stop when owner fails=%s',
    async (fails) => {
      const { owner, service, accounts } = setup()
      const stopped = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const authorization = Promise.withResolvers<string>()
      mocks.startDeviceFlow.mockImplementation(async () => {
        entered.resolve()
        return await authorization.promise
      })
      const login = Promise.allSettled([
        service.startGitHubCopilotDeviceFlowLogin('github-copilot')
      ])
      await entered.promise
      accounts.stop.mockReturnValue(stopped.promise)
      let acknowledged = false
      const stopping = service.stop()
      void stopping.then(
        () => {
          acknowledged = true
        },
        () => {
          acknowledged = true
        }
      )
      const result = fails
        ? expect(stopping).rejects.toThrow('Account stop failed')
        : expect(stopping).resolves.toBeUndefined()
      await Promise.resolve()
      expect(acknowledged).toBe(false)
      expect(owner.invalidateGitHubCopilotSignIns).toHaveBeenCalledOnce()
      if (fails) stopped.reject(new Error('Account stop failed'))
      else stopped.resolve()
      await nextTurn()
      expect(acknowledged).toBe(false)
      authorization.resolve('late-token')
      expect((await login)[0]).toMatchObject({
        status: 'rejected',
        reason: {
          message: 'OAuth service is stopped'
        }
      })
      await result
      await expect(service.startGitHubCopilotDeviceFlowLogin('github-copilot')).rejects.toThrow(
        'stopped'
      )
      expect(mocks.startDeviceFlow).toHaveBeenCalledOnce()
    }
  )

  for (const method of ['startGitHubCopilotDeviceFlowLogin', 'startGitHubCopilotLogin'] as const) {
    it(`${method} validates Copilot access before submitting the owner mutation`, async () => {
      const { target, owner, service } = setup()
      const fetchMock = vi.fn(async (_url: string) => {
        expect(owner.commitGitHubCopilotCredential).not.toHaveBeenCalled()
        return accepted()
      })
      vi.stubGlobal('fetch', fetchMock)
      await expect(service[method](target.providerId)).resolves.toBe(true)
      expect(owner.getGitHubCopilotSignInTarget).toHaveBeenCalledWith(target.providerId)
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/copilot_internal/v2/token')
      expect(owner.commitGitHubCopilotCredential).toHaveBeenCalledWith(target, 'new-oauth-token')
    })

    it(`${method} waits for actual credential acknowledgement and propagates persistence failure`, async () => {
      const { target, owner, service } = setup()
      const writing = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      owner.commitGitHubCopilotCredential.mockImplementation(async () => {
        entered.resolve()
        await writing.promise
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => accepted())
      )
      let completed = false
      const login = service[method](target.providerId).then(() => {
        completed = true
      })
      const rejected = expect(login).rejects.toThrow('persistence failed')
      await entered.promise
      expect(completed).toBe(false)
      writing.reject(new Error('persistence failed'))
      await rejected
    })

    it(`${method} preserves saved credentials when Copilot refuses access`, async () => {
      const { target, owner, service } = setup()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            { error_details: { message: 'Copilot access denied', code: 'not_authorized' } },
            {
              status: 403,
              statusText: 'Forbidden',
              headers: { 'x-github-request-id': 'ABCD:1234' }
            }
          )
        )
      )
      await expect(service[method](target.providerId)).rejects.toThrow('Copilot access denied')
      expect(owner.commitGitHubCopilotCredential).not.toHaveBeenCalled()
    })

    it(`${method} cannot open a login after a pending owner query is stopped`, async () => {
      const { target, owner, service } = setup()
      const reading = Promise.withResolvers<GitHubCopilotSignInTarget>()
      owner.getGitHubCopilotSignInTarget.mockReturnValue(reading.promise)
      const login = service[method](target.providerId)
      const rejected = expect(login).rejects.toThrow('stopped')
      await vi.waitFor(() => expect(owner.getGitHubCopilotSignInTarget).toHaveBeenCalledOnce())
      const stopping = service.stop()
      reading.resolve(target)
      await rejected
      await stopping
      expect(owner.invalidateGitHubCopilotSignIns).toHaveBeenCalledOnce()
      expect(mocks.startDeviceFlow).not.toHaveBeenCalled()
      expect(mocks.startLogin).not.toHaveBeenCalled()
      expect(owner.commitGitHubCopilotCredential).not.toHaveBeenCalled()
    })

    it(`${method} aborts token validation and rejects a late transport result after stop`, async () => {
      const { target, owner, service } = setup()
      const response = Promise.withResolvers<Response>()
      const entered = Promise.withResolvers<AbortSignal>()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, init: RequestInit) => {
          entered.resolve(init.signal!)
          return await response.promise
        })
      )
      const login = service[method](target.providerId)
      const rejected = Promise.allSettled([login])
      const signal = await entered.promise
      const stopping = service.stop()
      expect(signal.aborted).toBe(true)
      const canceled = Promise.withResolvers<void>()
      const retired = Promise.withResolvers<void>()
      response.resolve(
        new Response(
          new ReadableStream({
            cancel: async () => {
              canceled.resolve()
              await retired.promise
            }
          })
        )
      )
      await canceled.promise
      let settled = false
      void stopping.then(() => {
        settled = true
      })
      await nextTurn()
      expect(settled).toBe(false)
      retired.resolve()
      expect((await rejected)[0]).toEqual({ status: 'rejected', reason: signal.reason })
      await stopping
      expect(owner.commitGitHubCopilotCredential).not.toHaveBeenCalled()
    })
  }
})
