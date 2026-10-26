import logger from '@shared/logger'
import { readAuthResponse } from '../responseBody'
import { URL } from 'url'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import {
  resolveOAuthLoopbackCallbackUrl,
  startOAuthLoopbackCallbackSession,
  type OAuthLoopbackCallbackSession
} from '../oauthLoopbackCallback'
import {
  OPENAI_CODEX_ACCESS_TOKEN_ENV,
  OPENAI_CODEX_AUTH_REQUEST_TIMEOUT_MS,
  OPENAI_CODEX_AUTHORIZE_URL,
  OPENAI_CODEX_BROWSER_TIMEOUT_MS,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_REDIRECT_PATH,
  OPENAI_CODEX_REDIRECT_PORT,
  OPENAI_CODEX_REDIRECT_URI,
  OPENAI_CODEX_REVOKE_URL,
  OPENAI_CODEX_SCOPE,
  OPENAI_CODEX_TOKEN_REFRESH_SKEW_MS,
  OPENAI_CODEX_TOKEN_URL,
  isOpenAICodexDisabled
} from './constants'
import { OpenAICodexCredentialStore, type OpenAICodexTokenSet } from './credentialStore'
import { createOpenAICodexPkcePair, createOpenAICodexState } from './pkce'
import type { OpenAICodexAuthStatus } from '@shared/types/openai-codex'
import { ProviderHttpError } from '../../providerFailure'

export type OpenAICodexBackendAuth = {
  accessToken: string
  accountId?: string
}

type PendingBrowserFlow = {
  generation: number
  state: string
  codeVerifier: string
  redirectUri: string
  callbackSession: OAuthLoopbackCallbackSession
  cancelled: boolean
  flowPromise?: Promise<void>
}

type TokenResponse = Record<string, unknown>

let globalOpenAICodexAuth: OpenAICodexAuth | null = null

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/access_token["\s:=]+[^"'\s,}]+/gi, 'access_token:[redacted]')
    .replace(/refresh_token["\s:=]+[^"'\s,}]+/gi, 'refresh_token:[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/g, 'Bearer [redacted]')
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  if (!token) {
    return {}
  }

  const parts = token.split('.')
  if (parts.length < 2) {
    return {}
  }

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function maskAccountId(accountId: string | undefined): string | undefined {
  if (!accountId) {
    return undefined
  }

  if (accountId.length <= 8) {
    return accountId
  }

  return `${accountId.slice(0, 4)}...${accountId.slice(-4)}`
}

function extractTokenText(payload: TokenResponse, key: string): string | undefined {
  return toStringValue(payload[key])
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text.trim()) {
      return `${response.status} ${response.statusText}`
    }
    return text
  } catch {
    return `${response.status} ${response.statusText}`
  }
}

export type OpenAICodexCallbackResolution =
  | { kind: 'not-found' }
  | { kind: 'success'; code: string; message: string }
  | { kind: 'failure'; error: Error; message: string }

export function resolveOpenAICodexCallbackUrl(
  rawUrl: string | undefined,
  expectedState: string,
  redirectUri = OPENAI_CODEX_REDIRECT_URI
): OpenAICodexCallbackResolution {
  const callback = resolveOAuthLoopbackCallbackUrl(
    rawUrl,
    expectedState,
    redirectUri,
    'Invalid OpenAI Codex OAuth callback'
  )
  if (callback.kind === 'not-found') {
    return { kind: 'not-found' }
  }

  if (callback.kind === 'failure') {
    return {
      kind: 'failure',
      error: callback.error,
      message: 'Authentication complete. You can return to DeepChat.'
    }
  }

  return {
    kind: 'success',
    code: callback.code,
    message: 'Authentication complete. You can return to DeepChat.'
  }
}

export class OpenAICodexAuth {
  private readonly store: OpenAICodexCredentialStore
  private pendingBrowserFlow: PendingBrowserFlow | null = null
  private refreshPromise: Promise<OpenAICodexTokenSet> | null = null
  private lastError: string | null = null
  private generation = 0
  private stopped = false
  private loginPending = false
  private publication = 0
  private readonly requests = new Set<AbortController>()

  constructor(
    store: OpenAICodexCredentialStore,
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly openExternal: (url: string) => Promise<void>
  ) {
    this.store = store
  }

  private assertGeneration(generation: number): void {
    if (this.stopped || generation !== this.generation)
      throw new DOMException('OpenAI Codex authentication operation interrupted', 'AbortError')
  }

  captureOperation(): () => void {
    const generation = this.generation
    this.assertGeneration(generation)
    return () => this.assertGeneration(generation)
  }

  private invalidate(): void {
    this.generation++
    this.refreshPromise = null
    for (const request of this.requests) request.abort()
  }

  stop(): void {
    this.stopped = true
    this.invalidate()
    this.cancelPendingFlow()
    this.store.stop()
  }

  private cancelPendingFlow(): void {
    this.loginPending = false
    if (this.pendingBrowserFlow) {
      this.pendingBrowserFlow.cancelled = true
      this.pendingBrowserFlow.callbackSession.close()
      this.pendingBrowserFlow = null
    }
  }

  async getStatus(): Promise<OpenAICodexAuthStatus> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const generation = this.generation
      const check = this.captureOperation()
      try {
        const storage = await this.store.getStorageState()
        check()
        let status: Omit<OpenAICodexAuthStatus, 'storage'>
        if (isOpenAICodexDisabled()) status = { state: 'disabled', authenticated: false }
        else if (this.pendingBrowserFlow && !this.pendingBrowserFlow.cancelled)
          status = {
            state: 'pending-browser',
            authenticated: false,
            ...(this.lastError ? { error: this.lastError } : {})
          }
        else {
          const tokens = await this.store.load()
          check()
          if (tokens)
            status = {
              state: 'authenticated',
              authenticated: true,
              accountId: maskAccountId(tokens.accountId),
              accountLabel: tokens.accountLabel,
              planType: tokens.planType,
              expiresAt: tokens.expiresAt
            }
          else {
            const error = this.store.getLoadError() ?? this.lastError
            status = {
              state: error ? 'error' : 'signed-out',
              authenticated: false,
              ...(error ? { error } : {})
            }
          }
        }
        check()
        return { ...status, storage }
      } catch (error) {
        if (attempt === 0 && !this.stopped && generation !== this.generation) continue
        throw error
      }
    }
    throw new DOMException('Provider auth status changed during read', 'AbortError')
  }

  async cancelLogin(): Promise<OpenAICodexAuthStatus> {
    if (this.loginPending) {
      this.invalidate()
      this.cancelPendingFlow()
    }
    const check = this.captureOperation()
    try {
      await this.publishStatusChanged(check)
      return await this.getStatus()
    } finally {
      check()
    }
  }

  async startBrowserLogin(): Promise<OpenAICodexAuthStatus> {
    this.assertEnabled()
    this.invalidate()
    this.cancelPendingFlow()
    this.loginPending = true
    this.lastError = null
    const initialGeneration = this.generation
    let flow: PendingBrowserFlow | null = null
    const check = () => this.assertGeneration(flow?.generation ?? initialGeneration)
    let callbackSession: OAuthLoopbackCallbackSession | null = null
    try {
      const state = createOpenAICodexState()
      const pkce = createOpenAICodexPkcePair()
      const redirect = new URL(OPENAI_CODEX_REDIRECT_URI)
      callbackSession = await startOAuthLoopbackCallbackSession({
        expectedState: state,
        path: redirect.pathname || OPENAI_CODEX_REDIRECT_PATH,
        preferredPort: Number(redirect.port) || OPENAI_CODEX_REDIRECT_PORT,
        redirectHost: redirect.hostname || 'localhost',
        timeoutMs: OPENAI_CODEX_BROWSER_TIMEOUT_MS,
        invalidCallbackMessage: 'Invalid OpenAI Codex OAuth callback'
      })
      check()
      const authUrl = new URL(OPENAI_CODEX_AUTHORIZE_URL)
      authUrl.searchParams.set('client_id', OPENAI_CODEX_CLIENT_ID)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('redirect_uri', callbackSession.redirectUri)
      authUrl.searchParams.set('scope', OPENAI_CODEX_SCOPE)
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('code_challenge', pkce.codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
      authUrl.searchParams.set('id_token_add_organizations', 'true')
      flow = {
        generation: this.generation,
        state,
        codeVerifier: pkce.codeVerifier,
        redirectUri: callbackSession.redirectUri,
        callbackSession,
        cancelled: false
      }
      this.pendingBrowserFlow = flow
      flow.flowPromise = this.completeBrowserLogin(flow, callbackSession.waitForCallback())
      await this.openExternal(authUrl.toString())
      check()
      await this.publishStatusChanged(check)
      return await this.getStatus()
    } catch (error) {
      callbackSession?.close()
      check()
      if (this.pendingBrowserFlow === flow) this.cancelPendingFlow()
      this.loginPending = false
      this.lastError = sanitizeError(error)
      await this.publishStatusChanged(check)
      return await this.getStatus()
    } finally {
      check()
    }
  }

  async completeBrowserLoginFromCallbackUrl(callbackUrl: string): Promise<OpenAICodexAuthStatus> {
    this.assertEnabled()
    const flow = this.pendingBrowserFlow
    const initialGeneration = this.generation
    const check = () => this.assertGeneration(flow?.generation ?? initialGeneration)
    try {
      check()
      if (!flow || flow.cancelled) {
        this.lastError = 'OpenAI Codex browser login is not pending'
        await this.publishStatusChanged(check)
        return await this.getStatus()
      }
      const resolution = flow.callbackSession.resolveCallbackUrl(callbackUrl)
      if (resolution.kind === 'not-found') {
        this.lastError = 'OpenAI Codex callback URL is invalid'
        await this.publishStatusChanged(check)
        return await this.getStatus()
      }
      await flow.flowPromise
      check()
      return await this.getStatus()
    } finally {
      check()
    }
  }

  async logout(): Promise<OpenAICodexAuthStatus> {
    this.invalidate()
    this.cancelPendingFlow()
    const check = this.captureOperation()
    try {
      const tokens = await this.store.load()
      check()
      await this.store.clear()
      check()
      this.lastError = null
      const token = tokens?.refreshToken || tokens?.accessToken
      if (token) {
        try {
          await this.postForm(
            OPENAI_CODEX_REVOKE_URL,
            { token, client_id: OPENAI_CODEX_CLIENT_ID },
            check
          )
        } catch (error) {
          check()
          logger.warn('[OpenAI Codex] Token revoke failed:', sanitizeError(error))
        }
      }
      check()
      await this.publishStatusChanged(check)
      return await this.getStatus()
    } finally {
      check()
    }
  }

  async getAccessToken(): Promise<string> {
    const check = this.captureOperation()
    try {
      return (await this.getBackendAuth()).accessToken
    } finally {
      check()
    }
  }

  async forceRefreshAccessToken(): Promise<string> {
    const check = this.captureOperation()
    try {
      return (await this.forceRefreshBackendAuth()).accessToken
    } finally {
      check()
    }
  }

  async getBackendAuth(): Promise<OpenAICodexBackendAuth> {
    const check = this.captureOperation()
    try {
      this.assertEnabled()
      if (OPENAI_CODEX_ACCESS_TOKEN_ENV) return { accessToken: OPENAI_CODEX_ACCESS_TOKEN_ENV }
      const tokens = await this.store.load()
      check()
      if (!tokens) {
        const error = this.store.getLoadError()
        if (error) throw new Error(error)
        throw new ProviderHttpError('OpenAI Codex sign-in is required', {
          statusCode: 401,
          code: 'openai_codex_sign_in_required',
          retryable: false
        })
      }
      const current =
        tokens.expiresAt > Date.now() + OPENAI_CODEX_TOKEN_REFRESH_SKEW_MS
          ? tokens
          : await this.refreshAccessToken(tokens, check)
      check()
      return { accessToken: current.accessToken, accountId: current.accountId }
    } finally {
      check()
    }
  }

  async forceRefreshBackendAuth(): Promise<OpenAICodexBackendAuth> {
    const check = this.captureOperation()
    try {
      this.assertEnabled()
      const tokens = await this.store.load()
      check()
      if (!tokens?.refreshToken) {
        const error = this.store.getLoadError()
        if (error) throw new Error(error)
        throw new ProviderHttpError('OpenAI Codex refresh token is unavailable', {
          statusCode: 401,
          code: 'openai_codex_sign_in_required',
          retryable: false
        })
      }
      const refreshed = await this.refreshAccessToken(tokens, check, true)
      check()
      return { accessToken: refreshed.accessToken, accountId: refreshed.accountId }
    } finally {
      check()
    }
  }

  private assertEnabled(): void {
    if (isOpenAICodexDisabled()) throw new Error('OpenAI Codex provider is disabled by environment')
  }

  private async completeBrowserLogin(
    flow: PendingBrowserFlow,
    callback: Promise<{ code: string }>
  ): Promise<void> {
    const check = () => this.assertGeneration(flow.generation)
    try {
      const { code } = await callback
      if (flow.cancelled || this.pendingBrowserFlow !== flow) return
      check()
      const tokens = await this.exchangeAuthorizationCode(
        code,
        flow.codeVerifier,
        flow.redirectUri,
        check
      )
      check()
      if (this.pendingBrowserFlow !== flow) return
      this.invalidate()
      flow.generation = this.generation
      await this.store.save(tokens)
      check()
      this.lastError = null
      this.pendingBrowserFlow = null
      this.loginPending = false
      flow.callbackSession.close()
      await this.publishStatusChanged(check)
    } catch (error) {
      if (
        this.stopped ||
        flow.cancelled ||
        this.pendingBrowserFlow !== flow ||
        flow.generation !== this.generation
      )
        return
      this.lastError = sanitizeError(error)
      this.pendingBrowserFlow = null
      this.loginPending = false
      flow.callbackSession.close()
      try {
        await this.publishStatusChanged(check)
      } catch (publishError) {
        if (!this.stopped && flow.generation === this.generation)
          logger.warn('[OpenAI Codex] Failed to publish auth status:', sanitizeError(publishError))
      }
    }
  }

  private async exchangeAuthorizationCode(
    code: string,
    verifier: string,
    redirectUri: string,
    check: () => void
  ): Promise<OpenAICodexTokenSet> {
    check()
    const payload = await this.postForm(
      OPENAI_CODEX_TOKEN_URL,
      {
        grant_type: 'authorization_code',
        client_id: OPENAI_CODEX_CLIENT_ID,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      },
      check
    )
    check()
    return this.parseTokenResponse(payload)
  }

  private async refreshAccessToken(
    tokens: OpenAICodexTokenSet,
    check: () => void,
    force = false
  ): Promise<OpenAICodexTokenSet> {
    check()
    if (!force && tokens.expiresAt > Date.now() + OPENAI_CODEX_TOKEN_REFRESH_SKEW_MS) return tokens
    if (this.refreshPromise) return this.refreshPromise
    const pending = this.refreshAccessTokenOnce(tokens, check).finally(() => {
      if (this.refreshPromise === pending) this.refreshPromise = null
    })
    this.refreshPromise = pending
    return pending
  }

  private async refreshAccessTokenOnce(
    tokens: OpenAICodexTokenSet,
    check: () => void
  ): Promise<OpenAICodexTokenSet> {
    check()
    if (!tokens.refreshToken)
      throw new ProviderHttpError('OpenAI Codex refresh token is unavailable', {
        statusCode: 401,
        code: 'openai_codex_sign_in_required',
        retryable: false
      })
    const payload = await this.postForm(
      OPENAI_CODEX_TOKEN_URL,
      {
        grant_type: 'refresh_token',
        client_id: OPENAI_CODEX_CLIENT_ID,
        refresh_token: tokens.refreshToken
      },
      check
    )
    check()
    const refreshed = this.parseTokenResponse(payload, tokens)
    await this.store.save(refreshed)
    check()
    this.lastError = null
    await this.publishStatusChanged(check)
    check()
    return refreshed
  }

  private parseTokenResponse(
    payload: TokenResponse,
    previous?: OpenAICodexTokenSet
  ): OpenAICodexTokenSet {
    const accessToken = extractTokenText(payload, 'access_token') || previous?.accessToken
    if (!accessToken) {
      throw new Error('OpenAI Codex token response did not include an access token')
    }

    const refreshToken = extractTokenText(payload, 'refresh_token') || previous?.refreshToken
    const idToken = extractTokenText(payload, 'id_token') || previous?.idToken
    const tokenType = extractTokenText(payload, 'token_type') || previous?.tokenType || 'Bearer'
    const expiresIn = toNumberValue(payload.expires_in) || toNumberValue(payload.expiresIn) || 3600
    const jwtPayload = decodeJwtPayload(idToken || accessToken)
    const accountId =
      toStringValue(jwtPayload.chatgpt_account_id) ||
      toStringValue(jwtPayload.account_id) ||
      previous?.accountId
    const email = toStringValue(jwtPayload.email)
    const name = toStringValue(jwtPayload.name)
    const planType = toStringValue(jwtPayload.chatgpt_plan_type) || previous?.planType

    return {
      accessToken,
      refreshToken,
      idToken,
      tokenType,
      expiresAt: Date.now() + expiresIn * 1000,
      accountId,
      accountLabel: email || name || maskAccountId(accountId) || previous?.accountLabel,
      planType,
      updatedAt: Date.now()
    }
  }

  private async postForm(
    url: string,
    params: Record<string, string | undefined>,
    check: () => void
  ): Promise<TokenResponse> {
    check()
    const body = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value) body.set(key, value)
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    check()
    if (!response.ok) {
      const errorBody = await readErrorBody(response)
      check()
      let requiresSignIn = false
      if (params.grant_type === 'refresh_token') {
        try {
          requiresSignIn = JSON.parse(errorBody)?.error?.code === 'invalid_refresh_token'
        } catch {}
      }
      throw new ProviderHttpError(
        requiresSignIn
          ? 'OpenAI Codex sign-in has expired. Sign in again.'
          : errorBody.slice(0, 1000),
        {
          statusCode: response.status,
          ...(requiresSignIn ? { code: 'openai_codex_sign_in_required', retryable: false } : {})
        }
      )
    }
    const payload = (await response.json()) as TokenResponse
    check()
    return payload
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const check = this.captureOperation()
    if (this.requests.size >= 32) throw new Error('OpenAI Codex auth request limit exceeded')
    const controller = new AbortController()
    this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(), OPENAI_CODEX_AUTH_REQUEST_TIMEOUT_MS)
    const abort = () => controller.abort(externalSignal?.reason)
    if (externalSignal?.aborted) abort()
    else externalSignal?.addEventListener('abort', abort, { once: true })
    try {
      controller.signal.throwIfAborted()
      const response = await fetch(url, { ...init, signal: controller.signal })
      check()
      const result = await readAuthResponse(response, controller.signal)
      check()
      return result
    } catch (error) {
      check()
      if (controller.signal.aborted) {
        if (externalSignal?.aborted)
          throw new DOMException('OpenAI Codex OAuth login cancelled', 'AbortError')
        throw new Error(
          `OpenAI Codex auth request timed out after ${OPENAI_CODEX_AUTH_REQUEST_TIMEOUT_MS}ms`
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
      this.requests.delete(controller)
    }
  }

  private async publishStatusChanged(check: () => void): Promise<void> {
    check()
    const publication = ++this.publication
    const status = await this.getStatus()
    check()
    if (publication !== this.publication) return
    this.publishEvent('oauth.openaiCodex.statusChanged', { status, version: Date.now() })
  }
}
export function initializeGlobalOpenAICodexAuth(
  publishEvent: DeepchatEventPublisher,
  store: OpenAICodexCredentialStore,
  openExternal: (url: string) => Promise<void>
): OpenAICodexAuth {
  if (!globalOpenAICodexAuth) {
    globalOpenAICodexAuth = new OpenAICodexAuth(store, publishEvent, openExternal)
  }
  return globalOpenAICodexAuth
}

export function getGlobalOpenAICodexAuth(): OpenAICodexAuth {
  if (!globalOpenAICodexAuth) {
    throw new Error('OpenAI Codex auth is not initialized')
  }
  return globalOpenAICodexAuth
}
