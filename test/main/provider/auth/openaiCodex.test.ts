import * as fs from 'fs'
import * as path from 'path'
import { shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICodexAuth } from '@/provider/auth/openaiCodex'
import { OpenAICodexCredentialStore } from '@/provider/auth/openaiCodex/credentialStore'
import { createOpenAICodexPkcePair } from '@/provider/auth/openaiCodex/pkce'
import { extractProviderFailureMetadata } from '@/provider/providerFailure'
const crypto = {
  isAvailable: async () => false,
  encrypt: async (value: string) => Buffer.from(value).toString('base64'),
  decrypt: async (wrapped: string) => Buffer.from(wrapped, 'base64').toString('utf8')
}

const { startOAuthLoopbackCallbackSessionMock } = vi.hoisted(() => ({
  startOAuthLoopbackCallbackSessionMock: vi.fn()
}))
vi.mock('@/provider/auth/oauthLoopbackCallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/provider/auth/oauthLoopbackCallback')>()
  return {
    ...actual,
    startOAuthLoopbackCallbackSession: startOAuthLoopbackCallbackSessionMock
  }
})
describe('OpenAI Codex auth', () => {
  let tempDir: string
  let files: Map<string, string>
  let fdPaths: Map<number, string>
  beforeEach(() => {
    files = new Map()
    vi.mocked(fs.statSync).mockImplementation((file) => {
      const raw = files.get(String(file))
      if (raw === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { size: Buffer.byteLength(raw, 'utf8') } as fs.Stats
    })
    fdPaths = new Map()
    let nextFd = 1
    tempDir = `/tmp/deepchat-codex-auth-${Date.now()}`
    vi.mocked(fs.existsSync).mockImplementation((file) => files.has(String(file)))
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined)
    vi.mocked(fs.openSync).mockImplementation((file) => {
      const fd = nextFd++
      fdPaths.set(fd, String(file))
      return fd
    })
    vi.mocked(fs.closeSync).mockImplementation(() => {})
    vi.mocked(fs.fsyncSync).mockImplementation(() => {})
    vi.mocked(fs.writeFileSync).mockImplementation((file, data) => {
      const target = typeof file === 'number' ? fdPaths.get(file) : String(file)
      if (target !== undefined) {
        files.set(target, String(data))
      }
    })
    vi.mocked(fs.readFileSync).mockImplementation((file) => {
      const content = files.get(String(file))
      if (content === undefined) {
        throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
      }
      return content
    })
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      const content = files.get(String(from))
      if (content !== undefined) {
        files.delete(String(from))
        files.set(String(to), content)
      }
    })
    vi.mocked(fs.copyFileSync).mockImplementation((from, to) => {
      const content = files.get(String(from))
      if (content !== undefined) {
        files.set(String(to), content)
      }
    })
    vi.mocked(fs.rmSync).mockImplementation((file) => {
      files.delete(String(file))
    })
    vi.mocked(fs.readdirSync).mockImplementation(() => [])
    startOAuthLoopbackCallbackSessionMock.mockReset()
    vi.mocked(shell.openExternal).mockClear()
    delete process.env.DEEPCHAT_OPENAI_CODEX_DISABLED
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete process.env.DEEPCHAT_OPENAI_CODEX_DISABLED
    delete process.env.OPENAI_CODEX_REDIRECT_PORT
    delete process.env.OPENAI_CODEX_REDIRECT_URI
  })
  it('creates URL-safe PKCE verifier and challenge values', () => {
    const pair = createOpenAICodexPkcePair()
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.codeVerifier).not.toBe(pair.codeChallenge)
  })
  it('falls back when the redirect port env value is not a TCP port', async () => {
    vi.resetModules()
    process.env.OPENAI_CODEX_REDIRECT_PORT = '1455.5'
    const decimalPortConstants = await import('@/provider/auth/openaiCodex/constants')
    expect(decimalPortConstants.OPENAI_CODEX_REDIRECT_PORT).toBe(1455)
    vi.resetModules()
    process.env.OPENAI_CODEX_REDIRECT_PORT = '70000'
    const outOfRangePortConstants = await import('@/provider/auth/openaiCodex/constants')
    expect(outOfRangePortConstants.OPENAI_CODEX_REDIRECT_PORT).toBe(1455)
    vi.resetModules()
    process.env.OPENAI_CODEX_REDIRECT_PORT = '65535'
    const validPortConstants = await import('@/provider/auth/openaiCodex/constants')
    expect(validPortConstants.OPENAI_CODEX_REDIRECT_PORT).toBe(65535)
  })
  it('stores Codex credentials outside provider records', async () => {
    const credentialPath = path.join(tempDir, 'credentials.json')
    const store = new OpenAICodexCredentialStore({ filePath: credentialPath, crypto })
    await store.save({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600,
      accountId: 'account-id',
      accountLabel: 'user@example.com',
      updatedAt: Date.now()
    })
    expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(credentialPath), {
      recursive: true,
      mode: 0o700
    })
    const temporaryPath = String(vi.mocked(fs.openSync).mock.calls[0][0])
    expect(temporaryPath).toMatch(/credentials\.json\.tmp-/)
    expect(fs.openSync).toHaveBeenCalledWith(temporaryPath, 'w', 0o600)
    expect(fs.fsyncSync).toHaveBeenCalled()
    expect(fs.renameSync).toHaveBeenCalledWith(temporaryPath, credentialPath)
    expect((await store.load())?.accessToken).toBe('access-token')
    await store.clear()
    expect(await store.load()).toBeNull()
  })
  it('returns full backend auth while keeping status account IDs masked', async () => {
    const store = new OpenAICodexCredentialStore({
      filePath: path.join(tempDir, 'credentials.json'),
      crypto
    })
    await store.save({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600 * 1000,
      accountId: 'account-123456789',
      accountLabel: 'user@example.com',
      updatedAt: Date.now()
    })
    const auth = new OpenAICodexAuth(store, vi.fn(), shell.openExternal)
    const backendAuth = await auth.getBackendAuth()
    const status = await auth.getStatus()
    expect(backendAuth).toEqual({
      accessToken: 'access-token',
      accountId: 'account-123456789'
    })
    expect(status.accountId).toBe('acco...6789')
  })
  it('refreshes expired access tokens with single-flight coordination', async () => {
    const store = new OpenAICodexCredentialStore({
      filePath: path.join(tempDir, 'credentials.json'),
      crypto
    })
    await store.save({
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1000,
      updatedAt: Date.now()
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const auth = new OpenAICodexAuth(store, vi.fn(), shell.openExternal)
    const [first, second] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()])
    expect(first).toBe('new-token')
    expect(second).toBe('new-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect((await store.load())?.refreshToken).toBe('new-refresh-token')
  })
  it.each([1, 100])(
    'requires sign-in after a rejected refresh token with %i message repeats',
    async (messageRepeats) => {
      const store = new OpenAICodexCredentialStore({
        filePath: path.join(tempDir, 'credentials.json'),
        crypto
      })
      await store.save({
        accessToken: 'expired-token',
        refreshToken: 'rejected-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000,
        updatedAt: Date.now()
      })
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'invalid_refresh_token',
              message: 'private upstream response'.repeat(messageRepeats)
            }
          }),
          { status: 400 }
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      const auth = new OpenAICodexAuth(store, vi.fn(), shell.openExternal)
      await expect(auth.getBackendAuth()).rejects.toMatchObject({
        message: 'OpenAI Codex sign-in has expired. Sign in again.',
        failure: { statusCode: 400, code: 'openai_codex_sign_in_required', retryable: false }
      })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect((await store.load())?.refreshToken).toBe('rejected-refresh-token')
    }
  )
  it('limits OAuth diagnostic messages after parsing the complete error response', async () => {
    const store = new OpenAICodexCredentialStore({
      filePath: path.join(tempDir, 'credentials.json'),
      crypto
    })
    await store.save({
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1000,
      updatedAt: Date.now()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x'.repeat(2000), { status: 500 }))
    )
    const auth = new OpenAICodexAuth(store, vi.fn(), shell.openExternal)
    const failure = await auth.getBackendAuth().catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toHaveLength(1000)
    expect(failure.failure).toEqual({ statusCode: 500 })
  })
  it('opens browser login externally and completes from a pasted callback URL', async () => {
    startOAuthLoopbackCallbackSessionMock.mockImplementationOnce(
      async (options: { expectedState: string; path: string }) => {
        const callbackPath = options.path.startsWith('/') ? options.path : `/${options.path}`
        const redirectUri = `http://localhost:43123${callbackPath}`
        let resolveCallback!: (value: { code: string }) => void
        let rejectCallback!: (error: Error) => void
        const callbackPromise = new Promise<{
          code: string
        }>((resolve, reject) => {
          resolveCallback = resolve
          rejectCallback = reject
        })
        return {
          redirectUri,
          waitForCallback: vi.fn(() => callbackPromise),
          resolveCallbackUrl: vi.fn((rawUrl: string) => {
            const callbackUrl = new URL(rawUrl)
            const code = callbackUrl.searchParams.get('code')
            const state = callbackUrl.searchParams.get('state')
            if (!code || state !== options.expectedState) {
              const error = new Error('Invalid OAuth callback')
              rejectCallback(error)
              return { kind: 'failure' as const, error, url: callbackUrl.toString() }
            }
            const result = {
              kind: 'success' as const,
              code,
              state,
              url: callbackUrl.toString()
            }
            resolveCallback(result)
            return result
          }),
          close: vi.fn()
        }
      }
    )
    const store = new OpenAICodexCredentialStore({
      filePath: path.join(tempDir, 'browser.json'),
      crypto
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'browser-token',
          refresh_token: 'browser-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const auth = new OpenAICodexAuth(store, vi.fn(), shell.openExternal)
    const status = await auth.startBrowserLogin()
    const authUrl = new URL(vi.mocked(shell.openExternal).mock.calls[0][0])
    const redirectUri = authUrl.searchParams.get('redirect_uri')!
    const state = authUrl.searchParams.get('state')!
    expect(status.state).toBe('pending-browser')
    expect(await store.load()).toBeNull()
    expect(shell.openExternal).toHaveBeenCalledWith(
      expect.stringContaining('https://auth.openai.com/oauth/authorize')
    )
    const callbackUrl = new URL(redirectUri)
    callbackUrl.searchParams.set('code', 'browser-code')
    callbackUrl.searchParams.set('state', state)
    await auth.completeBrowserLoginFromCallbackUrl(callbackUrl.toString())
    await vi.waitFor(async () => expect((await store.load())?.accessToken).toBe('browser-token'))
    expect((await auth.getStatus()).state).toBe('authenticated')
  })
  it('honors the environment kill switch', async () => {
    process.env.DEEPCHAT_OPENAI_CODEX_DISABLED = 'true'
    const auth = new OpenAICodexAuth(
      new OpenAICodexCredentialStore({ filePath: path.join(tempDir, 'credentials.json'), crypto }),
      vi.fn(),
      shell.openExternal
    )
    expect((await auth.getStatus()).state).toBe('disabled')
    await expect(auth.getAccessToken()).rejects.toThrow('disabled')
  })
  it('prefers the credential-store load error over a stale login error', async () => {
    const credentialPath = path.join(tempDir, 'credentials.json')
    const store = new OpenAICodexCredentialStore({ filePath: credentialPath, crypto })
    const auth = new OpenAICodexAuth(store, vi.fn(), shell.openExternal)
    await auth.completeBrowserLoginFromCallbackUrl('https://example.com/callback')
    files.set(credentialPath, '{broken')
    const status = await auth.getStatus()
    expect(status.state).toBe('error')
    expect(status.error).toContain('not valid JSON')
  })
  it.each(['getBackendAuth', 'forceRefreshBackendAuth'] as const)(
    'keeps credential-store load errors separate from sign-in errors in %s',
    async (method) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const credentialPath = path.join(tempDir, 'credentials.json')
      const store = new OpenAICodexCredentialStore({ filePath: credentialPath, crypto })
      const auth = new OpenAICodexAuth(store, vi.fn(), shell.openExternal)
      files.set(credentialPath, '{broken')
      const failure = await auth[method]().catch((error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(failure.message).toMatch(/not valid JSON/)
      expect(extractProviderFailureMetadata(failure)?.code).not.toBe(
        'openai_codex_sign_in_required'
      )
      expect(files.get(credentialPath)).toBe('{broken')
    }
  )
  it('keeps a newly signed-in account after an older refresh resolves late', async () => {
    const store = new OpenAICodexCredentialStore({
      filePath: path.join(tempDir, 'account.json'),
      crypto
    })
    await store.save({
      accessToken: 'old-account',
      refreshToken: 'old-refresh',
      tokenType: 'Bearer',
      expiresAt: 0,
      updatedAt: 42
    })
    let refreshEntered!: () => void
    let finishRefresh!: (response: Response) => void
    const entered = new Promise<void>((resolve) => {
      refreshEntered = resolve
    })
    let finishCallback!: (value: { code: string }) => void
    const callback = new Promise<{ code: string }>((resolve) => {
      finishCallback = resolve
    })
    startOAuthLoopbackCallbackSessionMock.mockResolvedValueOnce({
      redirectUri: 'http://localhost:43123/auth/callback',
      waitForCallback: () => callback,
      resolveCallbackUrl: () => {
        finishCallback({ code: 'new-account-code' })
        return { kind: 'success', code: 'new-account-code' }
      },
      close: vi.fn()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        if (new URLSearchParams(String(init?.body)).get('grant_type') === 'refresh_token') {
          refreshEntered()
          return new Promise<Response>((resolve) => {
            finishRefresh = resolve
          })
        }
        return Response.json({
          access_token: 'new-account',
          refresh_token: 'new-refresh',
          token_type: 'Bearer',
          expires_in: 86400
        })
      })
    )
    const auth = new OpenAICodexAuth(store, vi.fn(), shell.openExternal)
    const refreshing = auth.forceRefreshAccessToken()
    const rejected = expect(refreshing).rejects.toMatchObject({ name: 'AbortError' })
    await entered
    await auth.startBrowserLogin()
    await auth.completeBrowserLoginFromCallbackUrl(
      'http://localhost:43123/auth/callback?code=new-account-code'
    )
    expect((await store.load())?.accessToken).toBe('new-account')
    finishRefresh(Response.json({ access_token: 'late-old-account', expires_in: 86400 }))
    await rejected
    expect((await store.load())?.accessToken).toBe('new-account')
    expect((await auth.getStatus()).authenticated).toBe(true)
    auth.stop()
  })
})
