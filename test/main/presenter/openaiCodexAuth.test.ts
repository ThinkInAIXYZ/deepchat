import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow, shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICodexAuth } from '../../../src/main/presenter/openaiCodexAuth'
import { OpenAICodexCredentialStore } from '../../../src/main/presenter/openaiCodexAuth/credentialStore'
import { createOpenAICodexPkcePair } from '../../../src/main/presenter/openaiCodexAuth/pkce'

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

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
    vi.mocked(BrowserWindow).mockClear()
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
    const decimalPortConstants =
      await import('../../../src/main/presenter/openaiCodexAuth/constants')
    expect(decimalPortConstants.OPENAI_CODEX_REDIRECT_PORT).toBe(1455)

    vi.resetModules()
    process.env.OPENAI_CODEX_REDIRECT_PORT = '70000'
    const outOfRangePortConstants =
      await import('../../../src/main/presenter/openaiCodexAuth/constants')
    expect(outOfRangePortConstants.OPENAI_CODEX_REDIRECT_PORT).toBe(1455)

    vi.resetModules()
    process.env.OPENAI_CODEX_REDIRECT_PORT = '65535'
    const validPortConstants = await import('../../../src/main/presenter/openaiCodexAuth/constants')
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

    const auth = new OpenAICodexAuth(store)
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

    const auth = new OpenAICodexAuth(store)
    const [first, second] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()])

    expect(first).toBe('new-token')
    expect(second).toBe('new-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(store.load()?.refreshToken).toBe('new-refresh-token')
  })

  it('opens browser login in an internal authorization window', async () => {
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

    const auth = new OpenAICodexAuth(store)

    const status = await auth.startBrowserLogin()
    const authWindow = vi.mocked(BrowserWindow).mock.results[0]?.value

    expect(status.state).toBe('pending-browser')
    expect(store.load()).toBeNull()
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'OpenAI Codex Authorization',
        width: 520,
        height: 720
      })
    )
    expect(authWindow.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('https://auth.openai.com/oauth/authorize')
    )
    expect(authWindow.show).toHaveBeenCalledTimes(1)
    expect(authWindow.focus).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).not.toHaveBeenCalled()

    const navigateHandler = authWindow.webContents.on.mock.calls.find(
      ([eventName]: [string]) => eventName === 'will-navigate'
    )?.[1]
    const preventDefault = vi.fn()
    navigateHandler(
      {
        preventDefault
      },
      'http://localhost:1455/auth/callback?code=browser-code&state=' +
        encodeURIComponent(new URL(authWindow.loadURL.mock.calls[0][0]).searchParams.get('state')!)
    )

    await vi.waitFor(() => expect(store.load()?.accessToken).toBe('browser-token'))
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(authWindow.close).toHaveBeenCalledTimes(1)
    expect(auth.getStatus().state).toBe('authenticated')
  })

  it('honors the environment kill switch', async () => {
    process.env.DEEPCHAT_OPENAI_CODEX_DISABLED = 'true'
    const auth = new OpenAICodexAuth(
      new OpenAICodexCredentialStore(path.join(tempDir, 'credentials.json'))
    )

    expect(auth.getStatus().state).toBe('disabled')
    await expect(auth.getAccessToken()).rejects.toThrow('disabled')
  })
})
