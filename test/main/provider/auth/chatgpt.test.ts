import { createSign, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGPTAuth, chatGPTAccessLease } from '@/provider/auth/chatgpt'
import type { ChatGPTAccountState, ChatGPTAccountStore } from '@/provider/auth/chatgpt/accountStore'
import { extractProviderFailureMetadata } from '@/provider/providerFailure'

const { startSession } = vi.hoisted(() => ({ startSession: vi.fn() }))
vi.mock('@/provider/auth/oauthLoopbackCallback', () => ({
  startOAuthLoopbackCallbackSession: startSession
}))

const ISSUER = 'https://auth.openai.com'
const REDIRECT = 'http://127.0.0.1:1455/auth/callback'
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1' }

function idToken(claims: Record<string, unknown>, key = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-1' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = createSign('RSA-SHA256').update(`${header}.${body}`).sign(key)
  return `${header}.${body}.${signature.toString('base64url')}`
}

class MemoryStore {
  state: ChatGPTAccountState | null = null
  load() {
    return this.state ? structuredClone(this.state) : null
  }
  save(state: ChatGPTAccountState) {
    this.state = structuredClone(state)
  }
  getLoadError() {
    return null
  }
  getStorage() {
    return 'safeStorage' as const
  }
  isUnavailable() {
    return false
  }
}

type Callback = (url: string) => void

function harness() {
  const store = new MemoryStore()
  const tokenRequests: URLSearchParams[] = []
  const revokeRequests: URLSearchParams[] = []
  type TokenReply = { status: number; body: Record<string, unknown> }
  let tokenReply: () => TokenReply | Promise<TokenReply> = () => ({
    status: 500,
    body: {}
  })
  let callback: Callback = () => {}
  const opened: string[] = []
  const accountChanges: boolean[] = []
  let nonce = ''

  let bindGate: Promise<void> | null = null
  const closes: Array<ReturnType<typeof vi.fn>> = []
  startSession.mockImplementation(async (options: { expectedState: string }) => {
    if (bindGate) await bindGate
    let resolve!: (value: unknown) => void
    let reject!: (error: Error) => void
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    callback = (url) => {
      const parsed = new URL(url)
      if (parsed.searchParams.get('state') !== options.expectedState) {
        reject(new Error('Invalid ChatGPT sign-in callback'))
      } else if (parsed.searchParams.get('error')) {
        reject(Object.assign(new Error('denied'), { name: 'AccessDenied' }))
      } else {
        resolve({ code: parsed.searchParams.get('code'), state: options.expectedState, url })
      }
    }
    const close = vi.fn()
    closes.push(close)
    return { redirectUri: REDIRECT, waitForCallback: () => promise, close }
  })

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    if (url.endsWith('/.well-known/openid-configuration')) {
      return json(200, {
        issuer: ISSUER,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        revocation_endpoint: `${ISSUER}/oauth/revoke`
      })
    }
    if (url.endsWith('/jwks.json')) return json(200, { keys: [jwk] })
    if (url.endsWith('/oauth/revoke')) {
      revokeRequests.push(new URLSearchParams(String(init?.body)))
      return new Response('', { status: 200 })
    }
    if (url.endsWith('/api/accounts/oauth/token')) {
      tokenRequests.push(new URLSearchParams(String(init?.body)))
      const reply = await tokenReply()
      return json(reply.status, reply.body)
    }
    throw new Error(`unexpected ${url}`)
  })

  const auth = new ChatGPTAuth({
    store: store as unknown as ChatGPTAccountStore,
    publishEvent: vi.fn(),
    fetch: fetchMock as unknown as typeof fetch,
    openExternal: async (url) => {
      opened.push(url)
      nonce = new URL(url).searchParams.get('nonce') ?? ''
    },
    onAccountChanged: (signedIn) => accountChanges.push(signedIn)
  })

  const grant = (
    overrides: Record<string, unknown> = {},
    claims: Record<string, unknown> = {},
    clientId = 'oaiapp_issued'
  ) => ({
    status: 200,
    body: {
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      id_token: idToken({
        iss: ISSUER,
        aud: clientId,
        sub: 'user-1',
        email: 'alice@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce,
        ...claims
      }),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke',
      ...overrides
    }
  })

  const signIn = async (callbackQuery: string) => {
    await auth.startLogin()
    const state = new URL(opened.at(-1)!).searchParams.get('state')
    callback(`${REDIRECT}?state=${state}&${callbackQuery}`)
    await vi.waitFor(() => expect(auth.getStatus().state).not.toBe('pending-browser'))
  }

  return {
    auth,
    store,
    opened,
    tokenRequests,
    revokeRequests,
    accountChanges,
    setTokenReply: (reply: typeof tokenReply) => {
      tokenReply = reply
    },
    holdBinding: () => {
      let release!: () => void
      bindGate = new Promise((resolve) => (release = resolve))
      return () => {
        bindGate = null
        release()
      }
    },
    closes,
    grant,
    signIn
  }
}

describe('ChatGPT account owner', () => {
  beforeEach(() => {
    startSession.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers a new client, verifies identity and stores the plan grant', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant())
    await h.signIn('code=code-1&client_id=oaiapp_issued')

    const authorize = new URL(h.opened[0])
    expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/api/accounts/authorize`)
    expect(authorize.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(authorize.searchParams.get('agent_name_hint')).toBe('DeepChat')
    expect(authorize.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:/)
    expect(authorize.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(authorize.searchParams.get('resource')).toBe('https://api.openai.com/v1')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')

    expect(h.tokenRequests[0].get('client_id')).toBe('oaiapp_issued')
    expect(h.tokenRequests[0].get('redirect_uri')).toBe(REDIRECT)
    expect(h.auth.getStatus()).toMatchObject({
      state: 'authenticated',
      email: 'alice@example.com',
      planUsageEnabled: true
    })
    expect(h.accountChanges).toEqual([true])
    await expect(h.auth.getAccessToken()).resolves.toBe('access-1')
  })

  it('reauthorizes with the saved client and keeps the host identity', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant())
    await h.signIn('code=code-1&client_id=oaiapp_issued')
    const hostId = h.store.state!.hostId
    await h.auth.logout()

    h.setTokenReply(() => h.grant({ access_token: 'access-2' }))
    await h.signIn('code=code-2')
    const authorize = new URL(h.opened[1])
    expect(authorize.searchParams.get('client_id')).toBe('oaiapp_issued')
    expect(authorize.searchParams.get('agent_name_hint')).toBeNull()
    expect(authorize.searchParams.get('login_hint')).toBe('alice@example.com')
    expect(authorize.searchParams.get('ext_agent_host_id')).toBe(hostId)
    expect(h.store.state!.registrations).toHaveLength(1)
    await expect(h.auth.getAccessToken()).resolves.toBe('access-2')
  })

  it('rejects a different client or subject on reauthorization and keeps the registration', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant())
    await h.signIn('code=code-1&client_id=oaiapp_issued')
    await h.auth.logout()

    await h.signIn('code=code-2&client_id=oaiapp_other')
    expect(h.auth.getStatus().state).toBe('error')
    expect(h.tokenRequests).toHaveLength(1)

    h.setTokenReply(() => h.grant({}, { sub: 'someone-else' }))
    await h.signIn('code=code-3')
    expect(h.auth.getStatus().state).toBe('error')
    expect(h.store.state!.registrations[0]).toMatchObject({ subject: 'user-1' })
    expect(h.store.state!.registrations[0].tokens).toBeUndefined()
  })

  it('rejects an ID token with a bad signature, audience or nonce', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    for (const reply of [
      (h: ReturnType<typeof harness>) => ({
        ...h.grant(),
        body: { ...h.grant().body, id_token: idToken({ iss: ISSUER }, other) }
      }),
      (h: ReturnType<typeof harness>) => h.grant({}, { aud: 'oaiapp_wrong' }),
      (h: ReturnType<typeof harness>) => h.grant({}, { nonce: 'replayed' })
    ]) {
      const h = harness()
      h.setTokenReply(() => reply(h))
      await h.signIn('code=code-1&client_id=oaiapp_issued')
      expect(h.auth.getStatus()).toMatchObject({ state: 'error', planUsageEnabled: false })
      expect(h.store.state!.registrations).toHaveLength(0)
      // The issued client is kept so the next attempt does not register again.
      expect(h.store.state!.pendingClientId).toBe('oaiapp_issued')
    }
  })

  it('does not enable inference when plan permission is missing', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant({ scope: 'openid profile email offline_access' }))
    await h.signIn('code=code-1&client_id=oaiapp_issued')
    expect(h.auth.getStatus()).toMatchObject({ state: 'plan-disabled', planUsageEnabled: false })
    await expect(h.auth.getAccessToken()).rejects.toSatisfy(
      (error) => extractProviderFailureMetadata(error)?.code === 'chatgpt_plan_not_enabled'
    )

    await h.auth.startLogin({ requestPlanConsent: true })
    expect(new URL(h.opened.at(-1)!).searchParams.get('prompt')).toBe('consent')
  })

  it('refreshes once for concurrent callers and stores the rotated refresh token', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant({ expires_in: 30 }))
    await h.signIn('code=code-1&client_id=oaiapp_issued')

    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.setTokenReply(() => ({
      status: 200,
      body: {
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke'
      }
    }))
    const first = gate.then(() => h.auth.getAccessToken())
    const second = gate.then(() => h.auth.getAccessToken())
    release()
    await expect(Promise.all([first, second])).resolves.toEqual(['access-2', 'access-2'])

    const refreshes = h.tokenRequests.filter((body) => body.get('grant_type') === 'refresh_token')
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0].get('client_id')).toBe('oaiapp_issued')
    expect(refreshes[0].get('scope')).toBeNull()
    expect(h.store.state!.registrations[0].tokens?.refreshToken).toBe('refresh-2')

    // A rejected lease that is no longer current does not refresh again.
    await expect(h.auth.forceRefreshAccessToken(chatGPTAccessLease('access-1'))).resolves.toBe(
      'access-2'
    )
    expect(
      h.tokenRequests.filter((body) => body.get('grant_type') === 'refresh_token')
    ).toHaveLength(1)
  })

  it('requires reconnecting after an unusable refresh token but keeps it on transient failures', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant({ expires_in: 30 }))
    await h.signIn('code=code-1&client_id=oaiapp_issued')

    h.setTokenReply(() => ({ status: 503, body: {} }))
    await expect(h.auth.getAccessToken()).rejects.toSatisfy(
      (error) => extractProviderFailureMetadata(error)?.retryable === true
    )
    expect(h.store.state!.registrations[0].tokens?.refreshToken).toBe('refresh-1')

    h.setTokenReply(() => ({ status: 400, body: { error: 'refresh_token_reused' } }))
    await expect(h.auth.getAccessToken()).rejects.toSatisfy(
      (error) => extractProviderFailureMetadata(error)?.code === 'chatgpt_sign_in_required'
    )
    expect(h.auth.getStatus().state).toBe('reauth-required')
    expect(h.store.state!.registrations[0]).toMatchObject({ clientId: 'oaiapp_issued' })
    expect(h.accountChanges.at(-1)).toBe(false)
  })

  it('revokes the refresh token on sign-out and keeps the registration', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant())
    await h.signIn('code=code-1&client_id=oaiapp_issued')

    const result = await h.auth.logout()
    expect(result.revocationConfirmed).toBe(true)
    expect(h.revokeRequests[0].get('token')).toBe('refresh-1')
    expect(h.revokeRequests[0].get('token_type_hint')).toBe('refresh_token')
    expect(h.revokeRequests[0].get('client_id')).toBe('oaiapp_issued')
    expect(result.status.state).toBe('signed-out')
    expect(h.store.state!.registrations[0].tokens).toBeUndefined()
    expect(h.store.state!.registrations[0].clientId).toBe('oaiapp_issued')
  })

  it('drops a sign-in cancelled while its callback listener is binding', async () => {
    const h = harness()
    const release = h.holdBinding()
    const starting = h.auth.startLogin()
    h.auth.cancelLogin()
    release()
    await starting

    expect(h.opened).toHaveLength(0)
    expect(h.closes[0]).toHaveBeenCalled()
    expect(h.auth.getStatus().state).toBe('signed-out')
  })

  it('announces sign-out before awaiting remote revocation', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant())
    await h.signIn('code=code-1&client_id=oaiapp_issued')

    const signingOut = h.auth.logout()
    expect(h.accountChanges).toEqual([true, false])
    await signingOut
    expect(h.accountChanges).toEqual([true, false])
  })

  it('withholds a refreshed bearer after sign-out or when the plan scope is gone', async () => {
    const h = harness()
    h.setTokenReply(() => h.grant({ expires_in: 30 }))
    await h.signIn('code=code-1&client_id=oaiapp_issued')

    // Sign out while the refresh request is in flight; the token endpoint answers afterwards.
    let refreshRequested!: () => void
    const requested = new Promise<void>((resolve) => (refreshRequested = resolve))
    let answer!: () => void
    const answered = new Promise<void>((resolve) => (answer = resolve))
    h.setTokenReply(async () => {
      refreshRequested()
      await answered
      return {
        status: 200,
        body: {
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          token_type: 'Bearer',
          expires_in: 3600
        }
      }
    })
    const refreshing = h.auth.getAccessToken()
    await requested
    await h.auth.logout()
    answer()
    await expect(refreshing).rejects.toSatisfy(
      (error) => extractProviderFailureMetadata(error)?.code === 'chatgpt_sign_in_required'
    )
    expect(h.store.state!.registrations[0].tokens).toBeUndefined()

    h.setTokenReply(() => h.grant({ expires_in: 30 }))
    await h.signIn('code=code-2')
    h.setTokenReply(() => ({
      status: 200,
      body: {
        access_token: 'access-3',
        refresh_token: 'refresh-3',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email offline_access'
      }
    }))
    await expect(h.auth.getAccessToken()).rejects.toSatisfy(
      (error) => extractProviderFailureMetadata(error)?.code === 'chatgpt_plan_not_enabled'
    )
    expect(h.auth.getStatus().state).toBe('plan-disabled')
  })
})
