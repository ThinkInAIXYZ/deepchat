import * as fs from 'fs'
import * as path from 'path'
import { shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICodexAuth } from '@/provider/auth/openaiCodex'
import { OpenAICodexCredentialStore } from '@/provider/auth/openaiCodex/credentialStore'
import { createOpenAICodexPkcePair } from '@/provider/auth/openaiCodex/pkce'

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

  beforeEach(() => {
    files = new Map()
    tempDir = `/tmp/deepchat-codex-auth-${Date.now()}`
    vi.mocked(fs.existsSync).mockImplementation((file) => files.has(String(file)))
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined)
    vi.mocked(fs.writeFileSync).mockImplementation((file, data) => {
      files.set(String(file), String(data))
    })
    vi.mocked(fs.readFileSync).mockImplementation((file) => files.get(String(file)) || '')
    vi.mocked(fs.rmSync).mockImplementation((file) => {
      files.delete(String(file))
    })
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

  it('stores Codex credentials outside provider records', () => {
    const credentialPath = path.join(tempDir, 'credentials.json')
    const store = new OpenAICodexCredentialStore(credentialPath)
    store.save({
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
    expect(fs.writeFileSync).toHaveBeenCalledWith(credentialPath, expect.any(String), {
      encoding: 'utf-8',
      mode: 0o600
    })
    expect(store.load()?.accessToken).toBe('access-token')
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('returns full backend auth while keeping status account IDs masked', async () => {
    const store = new OpenAICodexCredentialStore(path.join(tempDir, 'credentials.json'))
    store.save({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600 * 1000,
      accountId: 'account-123456789',
      accountLabel: 'user@example.com',
      updatedAt: Date.now()
    })

    const auth = new OpenAICodexAuth(store, vi.fn())
    const backendAuth = await auth.getBackendAuth()
    const status = auth.getStatus()

    expect(backendAuth).toEqual({
      accessToken: 'access-token',
      accountId: 'account-123456789'
    })
    expect(status.accountId).toBe('acco...6789')
  })

  it('refreshes expired access tokens with single-flight coordination', async () => {
    const store = new OpenAICodexCredentialStore(path.join(tempDir, 'credentials.json'))
    store.save({
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

    const auth = new OpenAICodexAuth(store, vi.fn())
    const [first, second] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()])

    expect(first).toBe('new-token')
    expect(second).toBe('new-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(store.load()?.refreshToken).toBe('new-refresh-token')
  })

  it('opens browser login externally and completes from a pasted callback URL', async () => {
    startOAuthLoopbackCallbackSessionMock.mockImplementationOnce(
      async (options: { expectedState: string; path: string }) => {
        const callbackPath = options.path.startsWith('/') ? options.path : `/${options.path}`
        const redirectUri = `http://localhost:43123${callbackPath}`
        let resolveCallback!: (value: { code: string }) => void
        let rejectCallback!: (error: Error) => void
        const callbackPromise = new Promise<{ code: string }>((resolve, reject) => {
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

    const store = new OpenAICodexCredentialStore(path.join(tempDir, 'browser.json'))
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

    const auth = new OpenAICodexAuth(store, vi.fn())

    const status = await auth.startBrowserLogin()
    const authUrl = new URL(vi.mocked(shell.openExternal).mock.calls[0][0])
    const redirectUri = authUrl.searchParams.get('redirect_uri')!
    const state = authUrl.searchParams.get('state')!

    expect(status.state).toBe('pending-browser')
    expect(store.load()).toBeNull()
    expect(shell.openExternal).toHaveBeenCalledWith(
      expect.stringContaining('https://auth.openai.com/oauth/authorize')
    )

    const callbackUrl = new URL(redirectUri)
    callbackUrl.searchParams.set('code', 'browser-code')
    callbackUrl.searchParams.set('state', state)
    await auth.completeBrowserLoginFromCallbackUrl(callbackUrl.toString())

    await vi.waitFor(() => expect(store.load()?.accessToken).toBe('browser-token'))
    expect(auth.getStatus().state).toBe('authenticated')
  })

  it('honors the environment kill switch', async () => {
    process.env.DEEPCHAT_OPENAI_CODEX_DISABLED = 'true'
    const auth = new OpenAICodexAuth(
      new OpenAICodexCredentialStore(path.join(tempDir, 'credentials.json')),
      vi.fn()
    )

    expect(auth.getStatus().state).toBe('disabled')
    await expect(auth.getAccessToken()).rejects.toThrow('disabled')
  })
})
