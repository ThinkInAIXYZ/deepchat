import * as fs from 'fs'
import * as path from 'path'
import { shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  XaiGrokAuth,
  resetGlobalXaiGrokAuthForTests
} from '../../../src/main/presenter/xaiGrokAuth'
import { XaiGrokCredentialStore } from '../../../src/main/presenter/xaiGrokAuth/credentialStore'
import {
  XAI_GROK_OAUTH_CLIENT_ID,
  isTrustedXaiApiEndpoint,
  isTrustedXaiOAuthEndpoint
} from '../../../src/main/presenter/xaiGrokAuth/constants'
import {
  createXaiGrokFetch,
  shouldUseXaiGrokOAuthFetch
} from '../../../src/main/presenter/llmProviderPresenter/xaiGrokAuthAdapter'

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
}

describe('xAI Grok OAuth', () => {
  let tempDir: string
  let files: Map<string, string>

  beforeEach(() => {
    files = new Map()
    tempDir = `/tmp/deepchat-xai-grok-auth-${Date.now()}`
    vi.mocked(fs.existsSync).mockImplementation((file) => files.has(String(file)))
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined)
    vi.mocked(fs.writeFileSync).mockImplementation((file, data) => {
      files.set(String(file), String(data))
    })
    vi.mocked(fs.readFileSync).mockImplementation((file) => files.get(String(file)) || '')
    vi.mocked(fs.rmSync).mockImplementation((file) => {
      files.delete(String(file))
    })
    vi.mocked(shell.openExternal).mockClear()
    delete process.env.DEEPCHAT_XAI_GROK_OAUTH_DISABLED
    delete process.env.XAI_GROK_ACCESS_TOKEN
    resetGlobalXaiGrokAuthForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete process.env.DEEPCHAT_XAI_GROK_OAUTH_DISABLED
    delete process.env.XAI_GROK_ACCESS_TOKEN
    resetGlobalXaiGrokAuthForTests()
  })

  it('accepts only trusted xAI OAuth endpoints', () => {
    expect(isTrustedXaiOAuthEndpoint('https://auth.x.ai/oauth2/token')).toBe(true)
    expect(isTrustedXaiOAuthEndpoint('https://accounts.x.ai/oauth2/token')).toBe(true)
    expect(isTrustedXaiOAuthEndpoint('http://auth.x.ai/oauth2/token')).toBe(false)
    expect(isTrustedXaiOAuthEndpoint('https://x.ai.evil.test/oauth2/token')).toBe(false)
    expect(isTrustedXaiOAuthEndpoint('not a url')).toBe(false)
    expect(isTrustedXaiApiEndpoint('https://api.x.ai/v1/chat/completions')).toBe(true)
    expect(isTrustedXaiApiEndpoint('https://api.x.ai.evil.test/v1')).toBe(false)
  })

  it('enables OAuth injection only for the built-in Grok provider on xAI endpoints', () => {
    const provider = {
      id: 'grok',
      name: 'Grok',
      apiType: 'grok',
      apiKey: '',
      baseUrl: 'https://api.x.ai/v1',
      enable: true
    }

    expect(shouldUseXaiGrokOAuthFetch(provider)).toBe(true)
    expect(
      shouldUseXaiGrokOAuthFetch({
        ...provider,
        baseUrl: 'https://grok-compatible.example.com/v1'
      })
    ).toBe(false)
    expect(
      shouldUseXaiGrokOAuthFetch({
        ...provider,
        id: 'custom-grok'
      })
    ).toBe(false)
  })

  it('refuses to send credentials when a wrapped request targets an untrusted endpoint', async () => {
    const underlyingFetch = vi.fn<typeof fetch>()
    const fetcher = createXaiGrokFetch(
      {
        id: 'grok',
        name: 'Grok',
        apiType: 'grok',
        apiKey: 'console-key',
        baseUrl: 'https://api.x.ai/v1',
        enable: true
      },
      {},
      underlyingFetch
    )

    await expect(fetcher('https://attacker.example.com/v1/models')).rejects.toThrow(
      'untrusted API endpoint'
    )
    expect(underlyingFetch).not.toHaveBeenCalled()
  })

  it('stores Grok OAuth credentials outside provider records', () => {
    const credentialPath = path.join(tempDir, 'credentials.json')
    const store = new XaiGrokCredentialStore(credentialPath)
    store.save({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600_000,
      accountId: 'account-id',
      accountLabel: 'user@example.com',
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
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

    const loaded = store.load()
    expect(loaded?.accessToken).toBe('access-token')
    expect(loaded?.refreshToken).toBe('refresh-token')
    expect(loaded?.accountLabel).toBe('user@example.com')
  })

  it('completes device-code login and exposes authenticated status', async () => {
    const credentialPath = path.join(tempDir, 'credentials.json')
    const store = new XaiGrokCredentialStore(credentialPath)
    const auth = new XaiGrokAuth(store)

    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes('.well-known/openid-configuration')) {
        return jsonResponse({
          device_authorization_endpoint: 'https://auth.x.ai/oauth2/device/code',
          token_endpoint: 'https://auth.x.ai/oauth2/token',
          revocation_endpoint: 'https://auth.x.ai/oauth2/revoke'
        })
      }
      if (url.includes('/oauth2/device/code')) {
        expect(init?.method).toBe('POST')
        expect(String(init?.body)).toContain(`client_id=${XAI_GROK_OAUTH_CLIENT_ID}`)
        return jsonResponse({
          device_code: 'device-1',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.x.ai/device',
          verification_uri_complete: 'https://auth.x.ai/device?user_code=ABCD-EFGH',
          expires_in: 600,
          interval: 1
        })
      }
      if (url.includes('/oauth2/token')) {
        return jsonResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: [
            Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
            Buffer.from(JSON.stringify({ sub: 'user-1', email: 'grok@example.com' })).toString(
              'base64url'
            ),
            'sig'
          ].join('.')
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchImpl)

    const pending = await auth.startDeviceLogin()
    expect(pending.state).toBe('pending-device')
    expect(pending.userCode).toBe('ABCD-EFGH')
    expect(shell.openExternal).toHaveBeenCalled()

    // Wait for background poll to finish
    await vi.waitFor(() => {
      expect(auth.getStatus().authenticated).toBe(true)
    })

    const status = auth.getStatus()
    expect(status.state).toBe('authenticated')
    expect(status.accountLabel).toBe('grok@example.com')
    expect(await auth.ensureAccessToken()).toBe('access-1')
  })

  it('refreshes near-expiry access tokens', async () => {
    const credentialPath = path.join(tempDir, 'credentials.json')
    const store = new XaiGrokCredentialStore(credentialPath)
    store.save({
      accessToken: 'access-old',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 1000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
      updatedAt: Date.now()
    })
    const auth = new XaiGrokAuth(store)

    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      expect(url).toBe('https://auth.x.ai/oauth2/token')
      expect(String(init?.body)).toContain('grant_type=refresh_token')
      expect(String(init?.body)).toContain('refresh_token=refresh-1')
      return jsonResponse({
        access_token: 'access-new',
        expires_in: 3600
      })
    })
    vi.stubGlobal('fetch', fetchImpl)

    const token = await auth.ensureAccessToken()
    expect(token).toBe('access-new')
    expect(store.load()?.accessToken).toBe('access-new')
  })

  it('coordinates concurrent forced token refreshes', async () => {
    const credentialPath = path.join(tempDir, 'credentials.json')
    const store = new XaiGrokCredentialStore(credentialPath)
    store.save({
      accessToken: 'access-old',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600_000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
      updatedAt: Date.now()
    })
    const auth = new XaiGrokAuth(store)
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ access_token: 'access-new', expires_in: 3600 })
    )
    vi.stubGlobal('fetch', fetchImpl)

    await expect(
      Promise.all([auth.forceRefreshAccessToken(), auth.forceRefreshAccessToken()])
    ).resolves.toEqual(['access-new', 'access-new'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not expose an expired access token to synchronous request paths', () => {
    const store = new XaiGrokCredentialStore(path.join(tempDir, 'credentials.json'))
    store.save({
      accessToken: 'access-expired',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
      updatedAt: Date.now()
    })

    expect(new XaiGrokAuth(store).peekAccessToken()).toBeNull()
  })

  it('reports disabled state when kill switch is set', () => {
    process.env.DEEPCHAT_XAI_GROK_OAUTH_DISABLED = '1'
    const auth = new XaiGrokAuth(new XaiGrokCredentialStore(path.join(tempDir, 'c.json')))
    expect(auth.getStatus()).toMatchObject({
      state: 'disabled',
      authenticated: false
    })
  })
})
