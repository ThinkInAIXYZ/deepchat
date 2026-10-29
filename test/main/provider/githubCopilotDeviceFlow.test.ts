import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventEmitter } from 'node:events'
import { setImmediate as nextTurn, setTimeout as wait } from 'node:timers/promises'

import { createGitHubCopilotDeviceFlow } from '@/provider/auth/githubCopilotDeviceFlow'
import { GitHubCopilotOAuth } from '@/provider/auth/githubCopilotOAuth'
import { getGitHubCopilotToken } from '@/provider/auth/githubCopilotToken'
import { extractProviderFailureMetadata } from '@/provider/providerFailure'

import { clipboard, shell } from 'electron'

type AuthWindow = {
  webContents: EventEmitter & {
    executeJavaScript: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
  loadURL: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  finishClose(): void
}
const native = vi.hoisted(() => ({
  windows: [] as AuthWindow[],
  closeDataWindow: true,
  holdClosed: false
}))
const controllers = new Set<AbortController>()
const createController = () => {
  const controller = new AbortController()
  controllers.add(controller)
  return controller
}
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    private closed = false
    webContents = Object.assign(new EventEmitter(), {
      executeJavaScript: vi.fn(async () => undefined),
      setWindowOpenHandler: vi.fn()
    })
    loadURL = vi.fn(async (url: string) => {
      if (native.closeDataWindow && url.startsWith('data:'))
        queueMicrotask(() => this.finishClose())
    })
    show = vi.fn()
    isDestroyed = () => this.closed
    destroy = vi.fn(() => {
      if (!native.holdClosed) this.finishClose()
    })
    finishClose() {
      if (this.closed) return
      this.closed = true
      this.emit('closed')
    }
    constructor() {
      super()
      native.windows.push(this)
    }
  }
  return {
    BrowserWindow: Window,
    clipboard: { writeText: vi.fn() },
    shell: { openExternal: vi.fn(async () => {}) }
  }
})

const deviceCode = () =>
  Response.json({
    device_code: 'device-code',
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 1
  })
const browser = () =>
  new GitHubCopilotOAuth({
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://callback.example/oauth',
    scope: 'read:user read:org'
  })

describe('GitHub Copilot token exchange', () => {
  afterEach(() => {
    for (const controller of controllers) controller.abort()
    controllers.clear()
    for (const window of native.windows) window.finishClose()
    native.windows.length = 0
    native.holdClosed = false
    native.closeDataWindow = true
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.mocked(shell.openExternal).mockReset().mockResolvedValue(undefined)
    vi.mocked(clipboard.writeText).mockClear()
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
      const fetchMock = vi.fn(async (url: string) =>
        url.endsWith('/device/code') ? deviceCode() : Response.json({ access_token: 'oauth-token' })
      )
      vi.stubGlobal('fetch', fetchMock)
      const flow = createGitHubCopilotDeviceFlow(override)
      await expect(flow.startDeviceFlow(createController().signal)).resolves.toBe('oauth-token')

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://github.com/login/device/code',
        expect.objectContaining({
          body: JSON.stringify({ client_id: expected, scope: 'read:user read:org' })
        })
      )
    }
  )

  it.each(['browser', 'device'] as const)(
    '%s authorization waits for physical window and accepted browser effects after abort',
    async (kind) => {
      native.closeDataWindow = false
      native.holdClosed = true
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => deviceCode())
      )
      const controller = createController()
      const reason = { source: 'owner-retirement' }
      const external = Promise.withResolvers<void>()
      vi.mocked(shell.openExternal).mockReturnValue(external.promise)
      const operation =
        kind === 'browser'
          ? browser().startLogin(controller.signal)
          : createGitHubCopilotDeviceFlow().startDeviceFlow(controller.signal)
      const outcome = Promise.allSettled([operation])
      let settled = false
      void outcome.then(() => {
        settled = true
      })
      await vi.waitFor(() => expect(native.windows).toHaveLength(1))
      const window = native.windows[0]
      if (kind === 'device') {
        window.webContents.executeJavaScript.mockReturnValue(new Promise(() => {}))
        window.webContents.emit('dom-ready')
        window.webContents.emit(
          'console-message',
          {},
          {
            message: JSON.stringify({ type: 'open-external', url: 'file:///unapproved' })
          }
        )
        window.webContents.emit(
          'console-message',
          {},
          0,
          JSON.stringify({ type: 'copy-to-clipboard', text: 'unapproved' })
        )
        window.webContents.emit(
          'console-message',
          {},
          0,
          JSON.stringify({ type: 'copy-to-clipboard', text: 'ABCD-EFGH' })
        )
        await vi.waitFor(() =>
          expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith(
            'https://github.com/login/device'
          )
        )
        expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith('ABCD-EFGH')
      }
      controller.abort(reason)
      await vi.waitFor(() => expect(window.destroy).toHaveBeenCalledOnce())
      await nextTurn()
      expect(settled).toBe(false)
      window.finishClose()
      await nextTurn()
      if (kind === 'device') expect(settled).toBe(false)
      external.resolve()
      expect((await outcome)[0]).toEqual({ status: 'rejected', reason })
      const calls = vi.mocked(shell.openExternal).mock.calls.length
      window.webContents.emit('console-message', {}, 0, JSON.stringify({ type: 'open-external' }))
      await nextTurn()
      expect(vi.mocked(shell.openExternal).mock.calls).toHaveLength(calls)
    }
  )

  it.each([false, true])('requires the exact callback and state; accepted=%s', async (accepted) => {
    const controller = createController()
    const operation = browser().startLogin(controller.signal)
    const outcome = Promise.allSettled([operation])
    const window = native.windows[0]
    const state = new URL(String(window.loadURL.mock.calls[0][0])).searchParams.get('state')!
    const navigation = { preventDefault: vi.fn() }
    for (const url of [
      'https://callback.example/oauth-suffix',
      'https://callback.example.evil/oauth'
    ])
      window.webContents.emit('will-redirect', navigation, `${url}?code=foreign&state=${state}`)
    expect(navigation.preventDefault).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
    window.webContents.emit(
      'will-redirect',
      navigation,
      `https://callback.example/oauth?code=auth-code&state=${accepted ? state : 'foreign'}`
    )
    const result = (await outcome)[0]
    if (accepted) expect(result).toEqual({ status: 'fulfilled', value: 'auth-code' })
    else
      expect(result).toMatchObject({
        status: 'rejected',
        reason: {
          message: 'Security verification failed: state parameter mismatch'
        }
      })
    expect(navigation.preventDefault).toHaveBeenCalledOnce()
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it(
    'serializes device polling and applies the server slowdown interval',
    { timeout: 20_000 },
    async () => {
      const first = Promise.withResolvers<Response>()
      const polls = vi.fn()
      const entered = Promise.withResolvers<void>()
      const requests: number[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.endsWith('/device/code')) return deviceCode()
          polls()
          requests.push(performance.now())
          entered.resolve()
          return polls.mock.calls.length === 1
            ? await first.promise
            : Response.json({ access_token: 'oauth-token' })
        })
      )
      const login = createGitHubCopilotDeviceFlow().startDeviceFlow(createController().signal)
      void login.catch(() => {})
      await entered.promise
      expect(polls).toHaveBeenCalledOnce()
      await wait(1200)
      expect(polls).toHaveBeenCalledOnce()
      const slowdown = performance.now()
      first.resolve(Response.json({ error: 'slow_down', interval: 6 }))
      await expect(login).resolves.toBe('oauth-token')
      expect(polls).toHaveBeenCalledTimes(2)
      expect(requests[1] - slowdown).toBeGreaterThanOrEqual(6000)
    }
  )

  it('awaits actual response-body cancellation before acknowledging an aborted exchange', async () => {
    const canceled = Promise.withResolvers<void>()
    const retired = Promise.withResolvers<void>()
    const cancel = vi.fn(async () => {
      canceled.resolve()
      await retired.promise
    })
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"access_token":'))
        },
        cancel
      })
    )
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = createController()
    const reason = { source: 'native-auth-shutdown' }
    const outcome = Promise.allSettled([browser().exchangeCodeForToken('code', controller.signal)])
    let settled = false
    void outcome.then(() => {
      settled = true
    })
    await nextTurn()
    controller.abort(reason)
    await canceled.promise
    await nextTurn()
    expect(settled).toBe(false)
    retired.resolve()
    expect((await outcome)[0]).toEqual({ status: 'rejected', reason })
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ signal: controller.signal })
    )
  })

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
    const controller = createController()
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
    const controller = createController()
    const reason = new DOMException('Already cancelled', 'AbortError')
    controller.abort(reason)

    await expect(getGitHubCopilotToken('oauth-token', controller.signal)).rejects.toBe(reason)
    await expect(browser().startLogin(controller.signal)).rejects.toBe(reason)
    await expect(createGitHubCopilotDeviceFlow().startDeviceFlow(controller.signal)).rejects.toBe(
      reason
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(native.windows).toHaveLength(0)
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
