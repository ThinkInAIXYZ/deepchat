import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import logger from '@shared/logger'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { ChatGPTAuthStatus, ChatGPTLogoutResult, ChatGPTNotice } from '@shared/types/chatgpt'
import { ProviderHttpError } from '../../providerFailure'
import {
  startOAuthLoopbackCallbackSession,
  type OAuthLoopbackCallbackSession
} from '../oauthLoopbackCallback'
import {
  ChatGPTAccountStore,
  createChatGPTAccountState,
  type ChatGPTAccountState,
  type ChatGPTRegistration,
  type ChatGPTTokenSet
} from './accountStore'
import {
  CHATGPT_AGENT_NAME,
  CHATGPT_API_BASE_URL,
  CHATGPT_AUTHORIZE_URL,
  CHATGPT_BROWSER_TIMEOUT_MS,
  CHATGPT_DISCOVERY_URL,
  CHATGPT_DYNAMIC_CLIENT_ID,
  CHATGPT_ISSUER,
  CHATGPT_PLAN_SCOPES,
  CHATGPT_REDIRECT_HOST,
  CHATGPT_REDIRECT_PATH,
  CHATGPT_REDIRECT_PORT,
  CHATGPT_REFRESH_SKEW_MS,
  CHATGPT_REQUEST_TIMEOUT_MS,
  CHATGPT_REVOKE_RETRY_DELAYS_MS,
  CHATGPT_SCOPES,
  CHATGPT_TOKEN_URL,
  CHATGPT_UNUSABLE_REFRESH_ERRORS
} from './constants'
import { ChatGPTIdentityError, verifyChatGPTIdToken } from './identity'

export const CHATGPT_SIGN_IN_REQUIRED = 'chatgpt_sign_in_required'
export const CHATGPT_PLAN_NOT_ENABLED = 'chatgpt_plan_not_enabled'

type Fetch = typeof fetch

export interface ChatGPTAuthOptions {
  store?: ChatGPTAccountStore
  publishEvent: DeepchatEventPublisher
  /** Persisted outside the account: whether the retired-Codex notice is still owed. */
  codexRetiredNotice?: { pending(): boolean; dismiss(): void }
  /** The signed-in account changed; the provider catalog belongs to the previous one. */
  onAccountChanged?: (signedIn: boolean) => void
  fetch?: Fetch
  openExternal?: (url: string) => Promise<void>
  now?: () => number
}

type Discovery = { jwksUri: string; revocationEndpoint?: string }
type Jwk = { kid?: string; kty?: string; n?: string; e?: string }

type PendingLogin = {
  state: string
  nonce: string
  verifier: string
  /** Issued client this attempt reauthorizes; absent for a new registration. */
  clientId?: string
  registrationId?: string
  callback: OAuthLoopbackCallbackSession
  authorizationUrl: string
  cancelled: boolean
}

class AccessDeniedError extends Error {
  constructor() {
    super('ChatGPT plan use was not authorized')
  }
}

class TokenEndpointError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined
  ) {
    super(
      code ? `ChatGPT token request failed: ${code}` : `ChatGPT token request failed (${status})`
    )
  }
}

let globalChatGPTAuth: ChatGPTAuth | null = null

const base64Url = (bytes: Buffer) => bytes.toString('base64url')
const randomToken = () => base64Url(randomBytes(32))
const leaseOf = (accessToken: string) => createHash('sha256').update(accessToken).digest('hex')

function hasPlan(scopes: string[]): boolean {
  return CHATGPT_PLAN_SCOPES.every((scope) => scopes.includes(scope))
}

function isValidIssuedClientId(id: string): boolean {
  return (
    id !== CHATGPT_DYNAMIC_CLIENT_ID && id.length > 0 && id.length <= 256 && /^[\w-]+$/.test(id)
  )
}

function sanitize(error: unknown): string {
  if (error instanceof ChatGPTIdentityError) return error.message
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/(access_token|refresh_token|id_token|id_token_hint|code)=[^&\s]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+\S+/g, 'Bearer [redacted]')
    .slice(0, 500)
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.origin === origin &&
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    )
  } catch {
    return false
  }
}

/**
 * The single owner of this installation's ChatGPT account: authorization, the verified identity,
 * token renewal and revocation. Tokens never leave this module except as a bearer for requests to
 * the plan resource.
 */
export class ChatGPTAuth {
  private readonly store: ChatGPTAccountStore
  private readonly fetch: Fetch
  private readonly openExternal: (url: string) => Promise<void>
  private readonly now: () => number
  private pending: PendingLogin | null = null
  private refreshing: Promise<ChatGPTTokenSet> | null = null
  private discovery: Promise<Discovery> | null = null
  private keys: Jwk[] | null = null
  private lastError: string | null = null
  private denied = false

  constructor(private readonly options: ChatGPTAuthOptions) {
    this.store = options.store ?? new ChatGPTAccountStore()
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init))
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url))
    this.now = options.now ?? Date.now
  }

  getStatus(): ChatGPTAuthStatus {
    const state = this.store.load()
    const loadError = this.store.getLoadError()
    const registration = state ? this.active(state) : undefined
    const tokens = registration?.tokens
    const planUsageEnabled = Boolean(tokens && hasPlan(tokens.scopes))
    const status: ChatGPTAuthStatus['state'] = this.pending
      ? 'pending-browser'
      : planUsageEnabled
        ? 'authenticated'
        : tokens || this.denied
          ? 'plan-disabled'
          : registration?.reauthRequired
            ? 'reauth-required'
            : loadError || this.lastError
              ? 'error'
              : 'signed-out'
    const error = loadError ?? this.lastError
    return {
      state: status,
      ...(registration?.email ? { email: registration.email } : {}),
      planUsageEnabled,
      storage: this.store.getStorage(),
      ...(error ? { error } : {}),
      notices: {
        welcome: planUsageEnabled && !state?.welcomeAcknowledged,
        codexRetired: this.options.codexRetiredNotice?.pending() ?? false
      }
    }
  }

  /** Whether requests can be made with the plan grant now, without contacting the issuer. */
  isReady(): boolean {
    const state = this.store.load()
    const tokens = state ? this.active(state)?.tokens : undefined
    return Boolean(tokens && hasPlan(tokens.scopes))
  }

  async startLogin(options: { requestPlanConsent?: boolean } = {}): Promise<ChatGPTAuthStatus> {
    this.cancelPending()
    this.lastError = null
    this.denied = false
    try {
      const existing = this.store.load()
      const state = existing ?? createChatGPTAccountState()
      // The host ID must be persisted before its first sign-in.
      if (!existing) this.store.save(state)
      const registration = this.active(state)
      const clientId = registration?.clientId ?? state.pendingClientId
      const login: Omit<PendingLogin, 'callback' | 'authorizationUrl'> = {
        state: randomToken(),
        nonce: randomToken(),
        verifier: randomToken(),
        ...(clientId ? { clientId } : {}),
        ...(registration ? { registrationId: registration.id } : {}),
        cancelled: false
      }
      const callback = await startOAuthLoopbackCallbackSession({
        expectedState: login.state,
        path: CHATGPT_REDIRECT_PATH,
        preferredPort: CHATGPT_REDIRECT_PORT,
        listenHost: CHATGPT_REDIRECT_HOST,
        redirectHost: CHATGPT_REDIRECT_HOST,
        timeoutMs: CHATGPT_BROWSER_TIMEOUT_MS,
        invalidCallbackMessage: 'Invalid ChatGPT sign-in callback',
        validateParameters: (parameters) => {
          for (const name of ['state', 'code', 'error', 'client_id']) {
            if (parameters.getAll(name).length > 1) throw new Error('Invalid ChatGPT callback')
          }
          if (parameters.get('error') === 'access_denied') throw new AccessDeniedError()
        }
      })
      const url = new URL(CHATGPT_AUTHORIZE_URL)
      const query: Array<[string, string]> = [
        ['client_id', clientId ?? CHATGPT_DYNAMIC_CLIENT_ID],
        ['ext_agent_host_id', state.hostId],
        ['response_type', 'code'],
        ['redirect_uri', callback.redirectUri],
        ['scope', CHATGPT_SCOPES],
        ['resource', CHATGPT_API_BASE_URL],
        ['state', login.state],
        ['nonce', login.nonce],
        ['code_challenge_method', 'S256'],
        ['code_challenge', base64Url(createHash('sha256').update(login.verifier).digest())]
      ]
      if (!clientId) query.push(['agent_name_hint', CHATGPT_AGENT_NAME])
      if (registration?.tokens?.idToken) query.push(['id_token_hint', registration.tokens.idToken])
      if (registration?.email) query.push(['login_hint', registration.email])
      if (options.requestPlanConsent) query.push(['prompt', 'consent'])
      for (const [name, value] of query) url.searchParams.set(name, value)

      const pending: PendingLogin = { ...login, callback, authorizationUrl: url.toString() }
      this.pending = pending
      void this.complete(pending)
      await this.openExternal(pending.authorizationUrl)
    } catch (error) {
      this.failPending(error)
    }
    this.publish()
    return this.getStatus()
  }

  async reopenBrowser(): Promise<ChatGPTAuthStatus> {
    if (this.pending) {
      try {
        await this.openExternal(this.pending.authorizationUrl)
      } catch (error) {
        this.lastError = sanitize(error)
        this.publish()
      }
    }
    return this.getStatus()
  }

  cancelLogin(): ChatGPTAuthStatus {
    this.cancelPending()
    this.publish()
    return this.getStatus()
  }

  dismissNotice(notice: ChatGPTNotice): ChatGPTAuthStatus {
    if (notice === 'codexRetired') {
      this.options.codexRetiredNotice?.dismiss()
    } else {
      const state = this.store.load()
      if (state && !state.welcomeAcknowledged) {
        state.welcomeAcknowledged = true
        this.store.save(state)
      }
    }
    this.publish()
    return this.getStatus()
  }

  async logout(): Promise<ChatGPTLogoutResult> {
    this.cancelPending()
    this.lastError = null
    this.denied = false
    const state = this.store.load()
    const registration = state ? this.active(state) : undefined
    const tokens = registration?.tokens
    let revocationConfirmed = true
    if (state && registration && tokens) {
      // Stop issuing this grant before the remote call so no new request starts with it.
      delete registration.tokens
      delete registration.reauthRequired
      this.store.save(state)
      if (tokens.refreshToken) {
        revocationConfirmed = await this.revoke(registration.clientId, tokens.refreshToken)
      }
      this.options.onAccountChanged?.(false)
    } else if (state && registration?.reauthRequired) {
      delete registration.reauthRequired
      this.store.save(state)
    }
    this.publish()
    return { status: this.getStatus(), revocationConfirmed }
  }

  /** A bearer for the plan resource, renewed near expiry. */
  async getAccessToken(): Promise<string> {
    const tokens = this.usableTokens()
    if (
      tokens.expiresAt > this.now() + CHATGPT_REFRESH_SKEW_MS ||
      (tokens.expiresAt > this.now() &&
        tokens.earliestRefreshAt !== undefined &&
        tokens.earliestRefreshAt > this.now())
    ) {
      return tokens.accessToken
    }
    return (await this.refresh(tokens)).accessToken
  }

  /** Renews after the resource rejected `rejectedLease`, unless another caller already did. */
  async forceRefreshAccessToken(rejectedLease: string): Promise<string> {
    const tokens = this.usableTokens()
    if (leaseOf(tokens.accessToken) !== rejectedLease) return tokens.accessToken
    return (await this.refresh(tokens)).accessToken
  }

  private usableTokens(): ChatGPTTokenSet {
    const state = this.store.load()
    const loadError = this.store.getLoadError()
    if (loadError) throw new Error(loadError)
    const tokens = state ? this.active(state)?.tokens : undefined
    if (!tokens) {
      throw new ProviderHttpError('Sign in with ChatGPT to continue', {
        statusCode: 401,
        code: CHATGPT_SIGN_IN_REQUIRED,
        retryable: false
      })
    }
    if (!hasPlan(tokens.scopes)) {
      throw new ProviderHttpError('ChatGPT plan use is not enabled for DeepChat', {
        statusCode: 403,
        code: CHATGPT_PLAN_NOT_ENABLED,
        retryable: false
      })
    }
    return tokens
  }

  private active(state: ChatGPTAccountState): ChatGPTRegistration | undefined {
    return state.registrations.find((entry) => entry.id === state.activeRegistrationId)
  }

  private cancelPending(): void {
    if (!this.pending) return
    this.pending.cancelled = true
    this.pending.callback.close()
    this.pending = null
  }

  private failPending(error: unknown): void {
    if (this.pending) {
      this.pending.callback.close()
      this.pending = null
    }
    if (error instanceof AccessDeniedError) {
      this.denied = true
      this.lastError = null
    } else {
      this.lastError = sanitize(error)
      logger.warn('[ChatGPT] Sign-in failed:', this.lastError)
    }
  }

  private async complete(pending: PendingLogin): Promise<void> {
    try {
      const result = await pending.callback.waitForCallback()
      if (pending.cancelled) return
      const returned = new URL(result.url).searchParams.get('client_id') ?? undefined
      let clientId: string
      if (pending.clientId) {
        // A reauthorization must stay with the selected registration.
        if (returned !== undefined && returned !== pending.clientId) {
          throw new Error('ChatGPT returned a different client for this account')
        }
        clientId = pending.clientId
      } else {
        if (!returned || !isValidIssuedClientId(returned)) {
          throw new Error('ChatGPT registration did not complete')
        }
        clientId = returned
        // Keep the issued client before the exchange so a failed exchange does not register again.
        const state = this.store.load()
        if (state && !state.pendingClientId) {
          state.pendingClientId = clientId
          this.store.save(state)
        }
      }
      await this.exchange(pending, result.code, clientId)
      if (pending.cancelled) return
      this.pending = null
      pending.callback.close()
      this.options.onAccountChanged?.(true)
    } catch (error) {
      if (pending.cancelled || this.pending !== pending) return
      this.failPending(error)
    }
    this.publish()
  }

  private async exchange(pending: PendingLogin, code: string, clientId: string): Promise<void> {
    const reply = await this.postToken({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.callback.redirectUri,
      resource: CHATGPT_API_BASE_URL
    })
    const idToken = typeof reply.id_token === 'string' ? reply.id_token : ''
    if (!idToken) throw new ChatGPTIdentityError()
    const identity = await verifyChatGPTIdToken({
      idToken,
      issuer: CHATGPT_ISSUER,
      clientId,
      nonce: pending.nonce,
      getKeys: (refresh) => this.getKeys(refresh),
      now: this.now()
    })
    const tokens = this.parseTokens(reply, idToken)
    if (pending.cancelled) return

    // Re-read: a refresh or another write may have landed while this attempt was in flight.
    const state = this.store.load() ?? createChatGPTAccountState()
    let registration = pending.registrationId
      ? state.registrations.find((entry) => entry.id === pending.registrationId)
      : state.registrations.find((entry) => entry.clientId === clientId)
    if (registration) {
      if (registration.subject !== identity.subject || registration.clientId !== clientId) {
        throw new Error('This ChatGPT account does not match the saved DeepChat registration')
      }
    } else {
      registration = {
        id: randomToken(),
        issuer: CHATGPT_ISSUER,
        subject: identity.subject,
        clientId
      }
      state.registrations.push(registration)
    }
    if (identity.email) registration.email = identity.email
    registration.tokens = tokens
    delete registration.reauthRequired
    if (state.pendingClientId === clientId) delete state.pendingClientId
    state.activeRegistrationId = registration.id
    this.lastError = null
    this.denied = false
    this.store.save(state)
  }

  private refresh(current: ChatGPTTokenSet): Promise<ChatGPTTokenSet> {
    this.refreshing ??= this.refreshOnce(current).finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async refreshOnce(current: ChatGPTTokenSet): Promise<ChatGPTTokenSet> {
    const state = this.store.load()
    const registration = state ? this.active(state) : undefined
    if (!state || !registration?.tokens?.refreshToken) {
      throw new ProviderHttpError('Sign in with ChatGPT to continue', {
        statusCode: 401,
        code: CHATGPT_SIGN_IN_REQUIRED,
        retryable: false
      })
    }
    // Another caller renewed while this one waited for the file.
    if (registration.tokens.accessToken !== current.accessToken) return registration.tokens
    const refreshToken = registration.tokens.refreshToken
    try {
      const reply = await this.postToken({
        grant_type: 'refresh_token',
        client_id: registration.clientId,
        refresh_token: refreshToken,
        resource: CHATGPT_API_BASE_URL
      })
      const next = this.parseTokens(reply, registration.tokens.idToken, registration.tokens)
      const latest = this.store.load()
      const target = latest?.registrations.find((entry) => entry.id === registration.id)
      // Persist the rotated refresh token unless the user signed out meanwhile.
      if (latest && target?.tokens?.refreshToken === refreshToken) {
        target.tokens = next
        this.store.save(latest)
      }
      this.publish()
      return next
    } catch (error) {
      if (error instanceof TokenEndpointError && error.code) {
        if (CHATGPT_UNUSABLE_REFRESH_ERRORS.has(error.code)) {
          const latest = this.store.load()
          const target = latest?.registrations.find((entry) => entry.id === registration.id)
          if (latest && target?.tokens?.refreshToken === refreshToken) {
            delete target.tokens
            target.reauthRequired = true
            this.store.save(latest)
          }
          this.publish()
          this.options.onAccountChanged?.(false)
          throw new ProviderHttpError('ChatGPT sign-in expired. Reconnect ChatGPT.', {
            statusCode: 401,
            code: CHATGPT_SIGN_IN_REQUIRED,
            retryable: false
          })
        }
        if (error.code === 'invalid_client') {
          throw new ProviderHttpError('DeepChat is not a valid ChatGPT client', {
            statusCode: error.status,
            code: 'invalid_client',
            retryable: false
          })
        }
      }
      throw new ProviderHttpError(sanitize(error), {
        statusCode: error instanceof TokenEndpointError ? error.status : 503,
        retryable: true
      })
    }
  }

  private parseTokens(
    reply: Record<string, unknown>,
    idToken: string,
    previous?: ChatGPTTokenSet
  ): ChatGPTTokenSet {
    const accessToken = typeof reply.access_token === 'string' ? reply.access_token : ''
    const tokenType = typeof reply.token_type === 'string' ? reply.token_type : 'Bearer'
    const expiresIn = typeof reply.expires_in === 'number' ? reply.expires_in : 0
    if (!accessToken || expiresIn <= 0 || tokenType.toLowerCase() !== 'bearer') {
      throw new Error('ChatGPT token response is invalid')
    }
    const scopes =
      typeof reply.scope === 'string'
        ? [...new Set(reply.scope.split(/\s+/).filter(Boolean))].sort()
        : (previous?.scopes ?? [])
    const earliest = reply.earliest_refresh_at
    const earliestRefreshAt =
      typeof earliest === 'number'
        ? earliest * 1000
        : typeof earliest === 'string' && Number.isFinite(Date.parse(earliest))
          ? Date.parse(earliest)
          : undefined
    const refreshToken =
      typeof reply.refresh_token === 'string' && reply.refresh_token
        ? reply.refresh_token
        : previous?.refreshToken
    const now = this.now()
    return {
      idToken: typeof reply.id_token === 'string' && reply.id_token ? reply.id_token : idToken,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      tokenType: 'Bearer',
      scopes,
      expiresAt: now + expiresIn * 1000,
      ...(earliestRefreshAt !== undefined ? { earliestRefreshAt } : {}),
      savedAt: now
    }
  }

  private async revoke(clientId: string, refreshToken: string): Promise<boolean> {
    let endpoint: string | undefined
    try {
      endpoint = (await this.getDiscovery()).revocationEndpoint
    } catch {
      return false
    }
    if (!endpoint) return false
    const body = new URLSearchParams({
      token: refreshToken,
      token_type_hint: 'refresh_token',
      client_id: clientId
    })
    for (const delay of [0, ...CHATGPT_REVOKE_RETRY_DELAYS_MS]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        const response = await this.request(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        })
        if (response.status === 200) return true
        if (response.status < 500) return false
      } catch {}
    }
    return false
  }

  private getDiscovery(): Promise<Discovery> {
    this.discovery ??= (async () => {
      const response = await this.request(CHATGPT_DISCOVERY_URL, { method: 'GET' })
      if (!response.ok) throw new Error(`ChatGPT discovery failed (${response.status})`)
      const document = (await response.json()) as Record<string, unknown>
      const origin = new URL(CHATGPT_ISSUER).origin
      const jwksUri = typeof document.jwks_uri === 'string' ? document.jwks_uri : ''
      const revocation =
        typeof document.revocation_endpoint === 'string' ? document.revocation_endpoint : undefined
      if (
        document.issuer !== CHATGPT_ISSUER ||
        !sameOrigin(jwksUri, origin) ||
        (revocation !== undefined && !sameOrigin(revocation, origin))
      ) {
        throw new Error('ChatGPT discovery document is invalid')
      }
      return { jwksUri, ...(revocation ? { revocationEndpoint: revocation } : {}) }
    })().catch((error) => {
      this.discovery = null
      throw error
    })
    return this.discovery
  }

  private async getKeys(refresh: boolean): Promise<Jwk[]> {
    if (this.keys && !refresh) return this.keys
    const response = await this.request((await this.getDiscovery()).jwksUri, { method: 'GET' })
    if (!response.ok) throw new Error(`ChatGPT key request failed (${response.status})`)
    const document = (await response.json()) as { keys?: unknown }
    this.keys = Array.isArray(document.keys) ? (document.keys as Jwk[]) : []
    return this.keys
  }

  private async postToken(params: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.request(CHATGPT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(params)
    })
    const text = await response.text().catch(() => '')
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {}
    if (!response.ok) {
      const code =
        typeof payload.error === 'string'
          ? payload.error
          : typeof (payload.error as { code?: unknown })?.code === 'string'
            ? ((payload.error as { code: string }).code as string)
            : undefined
      throw new TokenEndpointError(response.status, code)
    }
    return payload
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CHATGPT_REQUEST_TIMEOUT_MS)
    try {
      return await this.fetch(url, { ...init, redirect: 'error', signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) throw new Error('ChatGPT request timed out')
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private publish(): void {
    this.options.publishEvent('oauth.chatgpt.statusChanged', {
      status: this.getStatus(),
      version: this.now()
    })
  }
}

export function chatGPTAccessLease(accessToken: string): string {
  return leaseOf(accessToken)
}

export function initializeGlobalChatGPTAuth(options: ChatGPTAuthOptions): ChatGPTAuth {
  globalChatGPTAuth ??= new ChatGPTAuth(options)
  return globalChatGPTAuth
}

export function getGlobalChatGPTAuth(): ChatGPTAuth {
  if (!globalChatGPTAuth) throw new Error('ChatGPT auth is not initialized')
  return globalChatGPTAuth
}
