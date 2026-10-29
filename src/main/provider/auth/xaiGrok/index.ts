import logger from '@shared/logger'
import { readAuthResponse } from '../responseBody'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { XaiGrokAuthStatus } from '@shared/types/xai-grok'
import {
  XAI_GROK_ACCESS_TOKEN_ENV,
  XAI_GROK_AUTH_REQUEST_TIMEOUT_MS,
  XAI_GROK_DEVICE_CODE_DEFAULT_INTERVAL_MS,
  XAI_GROK_DEVICE_CODE_GRANT_TYPE,
  XAI_GROK_DEVICE_CODE_MIN_INTERVAL_MS,
  XAI_GROK_DEVICE_CODE_SLOW_DOWN_INCREMENT_MS,
  XAI_GROK_OAUTH_CLIENT_ID,
  XAI_GROK_OAUTH_DISCOVERY_URL,
  XAI_GROK_OAUTH_SCOPE,
  XAI_GROK_OAUTH_USER_AGENT,
  XAI_GROK_TOKEN_REFRESH_SKEW_MS,
  isTrustedXaiOAuthEndpoint,
  isXaiGrokOAuthDisabled
} from './constants'
import { XaiGrokCredentialStore, type XaiGrokTokenSet } from './credentialStore'

type TokenResponse = Record<string, unknown>

type DiscoveryEndpoints = {
  deviceAuthorizationEndpoint: string
  tokenEndpoint: string
  revocationEndpoint?: string
}

type DeviceCodeResponse = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresInMs: number
  intervalMs: number
}

type PendingDeviceFlow = {
  generation: number
  cancelled: boolean
  abortController: AbortController
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  flowPromise?: Promise<void>
}

let globalXaiGrokAuth: XaiGrokAuth | null = null

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

function requireTrustedEndpoint(endpoint: string, label: string): string {
  if (!isTrustedXaiOAuthEndpoint(endpoint)) {
    throw new Error(`xAI OAuth discovery returned untrusted ${label}`)
  }
  return endpoint
}

function secondsToMs(value: unknown, fallbackMs: number): number {
  const seconds = toNumberValue(value)
  if (!seconds || seconds <= 0) {
    return fallbackMs
  }
  return Math.min(seconds * 1000, Number.MAX_SAFE_INTEGER)
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text.trim()) {
      return `${response.status} ${response.statusText}`
    }
    return text.slice(0, 1000)
  } catch {
    return `${response.status} ${response.statusText}`
  }
}

function toFormBody(params: Record<string, string | undefined>): URLSearchParams {
  const body = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      body.set(key, value)
    }
  })
  return body
}

export class XaiGrokAuth {
  private readonly store: XaiGrokCredentialStore
  private pendingDeviceFlow: PendingDeviceFlow | null = null
  private refreshPromise: Promise<XaiGrokTokenSet> | null = null
  private lastError: string | null = null
  private generation = 0
  private stopped = false
  private loginPending = false
  private publication = 0
  private readonly requests = new Set<AbortController>()
  private cachedDiscovery: DiscoveryEndpoints | null = null
  private pendingLoginController: AbortController | null = null

  constructor(
    store: XaiGrokCredentialStore,
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly openExternal: (url: string) => Promise<void>
  ) {
    this.store = store
  }

  private assertGeneration(generation: number): void {
    if (this.stopped || generation !== this.generation)
      throw new DOMException('xAI Grok authentication operation interrupted', 'AbortError')
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
    this.pendingLoginController?.abort()
    this.pendingLoginController = null
    if (this.pendingDeviceFlow) {
      this.pendingDeviceFlow.cancelled = true
      this.pendingDeviceFlow.abortController.abort()
      this.pendingDeviceFlow = null
    }
  }

  async getStatus(): Promise<XaiGrokAuthStatus> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const generation = this.generation
      const check = this.captureOperation()
      try {
        const storage = await this.store.getStorageState()
        check()
        let status: Omit<XaiGrokAuthStatus, 'storage'>
        if (isXaiGrokOAuthDisabled()) status = { state: 'disabled', authenticated: false }
        else if (this.pendingDeviceFlow && !this.pendingDeviceFlow.cancelled)
          status = {
            state: 'pending-device',
            authenticated: false,
            userCode: this.pendingDeviceFlow.userCode,
            verificationUri: this.pendingDeviceFlow.verificationUri,
            verificationUriComplete: this.pendingDeviceFlow.verificationUriComplete,
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

  async cancelLogin(): Promise<XaiGrokAuthStatus> {
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

  async isAuthenticated(): Promise<boolean> {
    const check = this.captureOperation()
    try {
      return (await this.getStatus()).authenticated
    } finally {
      check()
    }
  }

  async startDeviceLogin(): Promise<XaiGrokAuthStatus> {
    this.assertEnabled()
    this.invalidate()
    this.cancelPendingFlow()
    this.loginPending = true
    this.lastError = null
    const initialGeneration = this.generation
    const controller = new AbortController()
    this.pendingLoginController = controller
    let flow: PendingDeviceFlow | null = null
    const check = () => this.assertGeneration(flow?.generation ?? initialGeneration)
    try {
      const discovery = await this.fetchDiscovery(check, controller.signal)
      check()
      const deviceCode = await this.requestDeviceCode(
        discovery.deviceAuthorizationEndpoint,
        check,
        controller.signal
      )
      check()
      flow = {
        generation: this.generation,
        cancelled: false,
        abortController: controller,
        userCode: deviceCode.userCode,
        verificationUri: deviceCode.verificationUri,
        verificationUriComplete: deviceCode.verificationUriComplete
      }
      this.pendingDeviceFlow = flow
      try {
        await this.openExternal(deviceCode.verificationUriComplete || deviceCode.verificationUri)
      } catch (error) {
        check()
        logger.warn('[xAI Grok OAuth] Failed to open browser:', sanitizeError(error))
      }
      check()
      flow.flowPromise = this.completeDeviceLogin(flow, discovery, deviceCode)
      await this.publishStatusChanged(check)
      return await this.getStatus()
    } catch (error) {
      controller.abort()
      check()
      if (this.pendingLoginController === controller) this.cancelPendingFlow()
      this.lastError = sanitizeError(error)
      await this.publishStatusChanged(check)
      return await this.getStatus()
    } finally {
      check()
    }
  }

  async logout(): Promise<XaiGrokAuthStatus> {
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
          const discovery = await this.fetchDiscovery(check)
          check()
          if (discovery.revocationEndpoint)
            await this.postForm(
              discovery.revocationEndpoint,
              {
                token,
                client_id: XAI_GROK_OAUTH_CLIENT_ID
              },
              check,
              false
            )
        } catch (error) {
          check()
          logger.warn('[xAI Grok OAuth] Token revoke failed:', sanitizeError(error))
        }
      }
      check()
      await this.publishStatusChanged(check)
      return await this.getStatus()
    } finally {
      check()
    }
  }

  async ensureAccessToken(): Promise<string | null> {
    const check = this.captureOperation()
    try {
      if (isXaiGrokOAuthDisabled()) return null
      if (XAI_GROK_ACCESS_TOKEN_ENV) return XAI_GROK_ACCESS_TOKEN_ENV
      const tokens = await this.store.load()
      check()
      if (!tokens) return null
      try {
        const current =
          tokens.expiresAt > Date.now() + XAI_GROK_TOKEN_REFRESH_SKEW_MS
            ? tokens
            : await this.refreshAccessToken(tokens, check)
        check()
        return current.accessToken
      } catch (error) {
        check()
        this.lastError = sanitizeError(error)
        await this.publishStatusChanged(check)
        throw error
      }
    } finally {
      check()
    }
  }

  async getAccessToken(): Promise<string> {
    const check = this.captureOperation()
    try {
      const token = await this.ensureAccessToken()
      check()
      if (!token) throw new Error(this.store.getLoadError() ?? 'xAI Grok OAuth sign-in is required')
      return token
    } finally {
      check()
    }
  }

  async forceRefreshAccessToken(): Promise<string> {
    const check = this.captureOperation()
    try {
      this.assertEnabled()
      const tokens = await this.store.load()
      check()
      if (!tokens?.refreshToken)
        throw new Error(this.store.getLoadError() ?? 'xAI Grok OAuth refresh token is unavailable')
      const refreshed = await this.refreshAccessToken(tokens, check, true)
      check()
      return refreshed.accessToken
    } finally {
      check()
    }
  }

  private assertEnabled(): void {
    if (isXaiGrokOAuthDisabled()) throw new Error('xAI Grok OAuth is disabled by environment')
  }

  private async completeDeviceLogin(
    flow: PendingDeviceFlow,
    discovery: DiscoveryEndpoints,
    deviceCode: DeviceCodeResponse
  ): Promise<void> {
    const check = () => this.assertGeneration(flow.generation)
    try {
      check()
      const tokens = await this.pollDeviceCodeToken(
        discovery.tokenEndpoint,
        deviceCode,
        check,
        flow.abortController.signal
      )
      if (flow.cancelled || this.pendingDeviceFlow !== flow) return
      check()
      const tokenSet = this.parseTokenResponse(tokens, undefined, {
        tokenEndpoint: discovery.tokenEndpoint,
        deviceAuthorizationEndpoint: discovery.deviceAuthorizationEndpoint
      })
      this.invalidate()
      flow.generation = this.generation
      await this.store.save(tokenSet)
      check()
      this.lastError = null
      this.pendingDeviceFlow = null
      this.pendingLoginController = null
      this.loginPending = false
      await this.publishStatusChanged(check)
    } catch (error) {
      if (
        this.stopped ||
        flow.cancelled ||
        this.pendingDeviceFlow !== flow ||
        flow.generation !== this.generation
      )
        return
      this.lastError = sanitizeError(error)
      this.pendingDeviceFlow = null
      this.pendingLoginController = null
      this.loginPending = false
      try {
        await this.publishStatusChanged(check)
      } catch (publishError) {
        if (!this.stopped && flow.generation === this.generation)
          logger.warn(
            '[xAI Grok OAuth] Failed to publish auth status:',
            sanitizeError(publishError)
          )
      }
    }
  }

  private async refreshAccessToken(
    tokens: XaiGrokTokenSet,
    check: () => void,
    force = false
  ): Promise<XaiGrokTokenSet> {
    check()
    if (!force && tokens.expiresAt > Date.now() + XAI_GROK_TOKEN_REFRESH_SKEW_MS) return tokens
    if (this.refreshPromise) return this.refreshPromise
    const pending = this.refreshAccessTokenOnce(tokens, check).finally(() => {
      if (this.refreshPromise === pending) this.refreshPromise = null
    })
    this.refreshPromise = pending
    return pending
  }

  private async refreshAccessTokenOnce(
    tokens: XaiGrokTokenSet,
    check: () => void
  ): Promise<XaiGrokTokenSet> {
    check()
    if (!tokens.refreshToken) throw new Error('xAI Grok OAuth refresh token is unavailable')
    let tokenEndpoint = tokens.tokenEndpoint
    if (!tokenEndpoint || !isTrustedXaiOAuthEndpoint(tokenEndpoint))
      tokenEndpoint = (await this.fetchDiscovery(check)).tokenEndpoint
    check()
    const payload = await this.postForm(
      tokenEndpoint,
      {
        grant_type: 'refresh_token',
        client_id: XAI_GROK_OAUTH_CLIENT_ID,
        refresh_token: tokens.refreshToken
      },
      check
    )
    check()
    const refreshed = this.parseTokenResponse(payload, tokens, {
      tokenEndpoint,
      deviceAuthorizationEndpoint: tokens.deviceAuthorizationEndpoint
    })
    await this.store.save(refreshed)
    check()
    this.lastError = null
    await this.publishStatusChanged(check)
    check()
    return refreshed
  }

  private async fetchDiscovery(
    check: () => void,
    signal?: AbortSignal
  ): Promise<DiscoveryEndpoints> {
    check()
    if (this.cachedDiscovery) {
      return this.cachedDiscovery
    }

    const response = await this.fetchWithTimeout(
      XAI_GROK_OAUTH_DISCOVERY_URL,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': XAI_GROK_OAUTH_USER_AGENT
        }
      },
      signal
    )

    check()
    if (!response.ok) {
      throw new Error(`xAI OAuth discovery failed: ${await readErrorBody(response)}`)
    }

    const payload = (await response.json()) as TokenResponse
    check()
    const deviceAuthorizationEndpoint = toStringValue(payload.device_authorization_endpoint)
    const tokenEndpoint = toStringValue(payload.token_endpoint)
    if (!deviceAuthorizationEndpoint || !tokenEndpoint) {
      throw new Error('xAI OAuth discovery response is missing device code endpoints')
    }

    const discovery: DiscoveryEndpoints = {
      deviceAuthorizationEndpoint: requireTrustedEndpoint(
        deviceAuthorizationEndpoint,
        'device authorization endpoint'
      ),
      tokenEndpoint: requireTrustedEndpoint(tokenEndpoint, 'token endpoint'),
      ...(toStringValue(payload.revocation_endpoint)
        ? {
            revocationEndpoint: requireTrustedEndpoint(
              toStringValue(payload.revocation_endpoint)!,
              'revocation endpoint'
            )
          }
        : {})
    }
    this.cachedDiscovery = discovery
    return discovery
  }

  private async requestDeviceCode(
    deviceAuthorizationEndpoint: string,
    check: () => void,
    signal?: AbortSignal
  ): Promise<DeviceCodeResponse> {
    check()
    const response = await this.fetchWithTimeout(
      requireTrustedEndpoint(deviceAuthorizationEndpoint, 'device authorization endpoint'),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': XAI_GROK_OAUTH_USER_AGENT
        },
        body: toFormBody({
          client_id: XAI_GROK_OAUTH_CLIENT_ID,
          scope: XAI_GROK_OAUTH_SCOPE
        })
      },
      signal
    )

    check()
    if (!response.ok) {
      throw new Error(`xAI device code request failed: ${await readErrorBody(response)}`)
    }

    const payload = (await response.json()) as TokenResponse
    check()
    const deviceCode = toStringValue(payload.device_code)
    const userCode = toStringValue(payload.user_code)
    const verificationUri = toStringValue(payload.verification_uri)
    if (!deviceCode || !userCode || !verificationUri) {
      throw new Error(
        'xAI device code response is missing device_code, user_code, or verification_uri'
      )
    }

    const verificationUriComplete = toStringValue(payload.verification_uri_complete)

    return {
      deviceCode,
      userCode,
      verificationUri: requireTrustedEndpoint(verificationUri, 'device verification URI'),
      ...(verificationUriComplete
        ? {
            verificationUriComplete: requireTrustedEndpoint(
              verificationUriComplete,
              'complete device verification URI'
            )
          }
        : {}),
      expiresInMs: secondsToMs(payload.expires_in, 10 * 60 * 1000),
      intervalMs: secondsToMs(payload.interval, XAI_GROK_DEVICE_CODE_DEFAULT_INTERVAL_MS)
    }
  }

  private async pollDeviceCodeToken(
    tokenEndpoint: string,
    deviceCode: DeviceCodeResponse,
    check: () => void,
    signal?: AbortSignal
  ): Promise<TokenResponse> {
    check()
    const deadlineMs = Date.now() + deviceCode.expiresInMs
    let intervalMs = deviceCode.intervalMs

    while (Date.now() < deadlineMs) {
      check()
      if (signal?.aborted) {
        throw new Error('xAI Grok OAuth login cancelled')
      }

      const response = await this.fetchWithTimeout(
        requireTrustedEndpoint(tokenEndpoint, 'token endpoint'),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': XAI_GROK_OAUTH_USER_AGENT
          },
          body: toFormBody({
            grant_type: XAI_GROK_DEVICE_CODE_GRANT_TYPE,
            client_id: XAI_GROK_OAUTH_CLIENT_ID,
            device_code: deviceCode.deviceCode
          })
        },
        signal
      )

      let payload: TokenResponse = {}
      try {
        payload = (await response.json()) as TokenResponse
      } catch {
        payload = {}
      }

      check()
      if (response.ok) {
        return payload
      }

      const error = toStringValue(payload.error)
      if (error === 'authorization_pending') {
        await this.sleep(Math.max(intervalMs, XAI_GROK_DEVICE_CODE_MIN_INTERVAL_MS), signal)
        continue
      }
      if (error === 'slow_down') {
        intervalMs += XAI_GROK_DEVICE_CODE_SLOW_DOWN_INCREMENT_MS
        await this.sleep(Math.max(intervalMs, XAI_GROK_DEVICE_CODE_MIN_INTERVAL_MS), signal)
        continue
      }
      if (error === 'access_denied' || error === 'authorization_denied') {
        throw new Error('xAI device authorization was denied')
      }
      if (error === 'expired_token') {
        throw new Error('xAI device code expired. Re-run the login.')
      }

      const description = toStringValue(payload.error_description)
      throw new Error(
        description
          ? `xAI device token exchange failed (${response.status}): ${error || 'error'} (${description})`
          : `xAI device token exchange failed (${response.status}): ${error || (await readErrorBody(response))}`
      )
    }

    throw new Error('xAI device authorization timed out')
  }

  private parseTokenResponse(
    payload: TokenResponse,
    previous?: XaiGrokTokenSet,
    endpoints?: {
      tokenEndpoint?: string
      deviceAuthorizationEndpoint?: string
    }
  ): XaiGrokTokenSet {
    const accessToken = toStringValue(payload.access_token) || previous?.accessToken
    if (!accessToken) {
      throw new Error('xAI OAuth token response did not include an access token')
    }

    const refreshToken = toStringValue(payload.refresh_token) || previous?.refreshToken
    const idToken = toStringValue(payload.id_token) || previous?.idToken
    const tokenType = toStringValue(payload.token_type) || previous?.tokenType || 'Bearer'
    const expiresIn = toNumberValue(payload.expires_in) || 3600
    const jwtPayload = decodeJwtPayload(idToken || accessToken)
    const accountId =
      toStringValue(jwtPayload.sub) || toStringValue(jwtPayload.account_id) || previous?.accountId
    const email = toStringValue(jwtPayload.email)
    const name = toStringValue(jwtPayload.name)

    return {
      accessToken,
      refreshToken,
      idToken,
      tokenType,
      expiresAt: Date.now() + expiresIn * 1000,
      accountId,
      accountLabel: email || name || maskAccountId(accountId) || previous?.accountLabel,
      tokenEndpoint: endpoints?.tokenEndpoint || previous?.tokenEndpoint,
      deviceAuthorizationEndpoint:
        endpoints?.deviceAuthorizationEndpoint || previous?.deviceAuthorizationEndpoint,
      updatedAt: Date.now()
    }
  }

  private async postForm(
    url: string,
    params: Record<string, string | undefined>,
    check: () => void,
    requireOk = true
  ): Promise<TokenResponse> {
    check()
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': XAI_GROK_OAUTH_USER_AGENT
      },
      body: toFormBody(params)
    })
    check()
    if (!response.ok) {
      if (!requireOk) return {}
      const error = await readErrorBody(response)
      check()
      throw new Error(error)
    }
    const payload = (await response.json()) as TokenResponse
    check()
    return payload
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      })
      return
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout)
        reject(new Error('xAI Grok OAuth login cancelled'))
      }
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
      }
    })
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const check = this.captureOperation()
    if (this.requests.size >= 32) throw new Error('xAI Grok auth request limit exceeded')
    const controller = new AbortController()
    this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(), XAI_GROK_AUTH_REQUEST_TIMEOUT_MS)
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
          throw new DOMException('xAI Grok OAuth login cancelled', 'AbortError')
        throw new Error(
          `xAI Grok auth request timed out after ${XAI_GROK_AUTH_REQUEST_TIMEOUT_MS}ms`
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
    this.publishEvent('oauth.xaiGrok.statusChanged', { status, version: Date.now() })
  }
}
export function initializeGlobalXaiGrokAuth(
  publishEvent: DeepchatEventPublisher,
  store: XaiGrokCredentialStore,
  openExternal: (url: string) => Promise<void>
): XaiGrokAuth {
  if (!globalXaiGrokAuth) {
    globalXaiGrokAuth = new XaiGrokAuth(store, publishEvent, openExternal)
  }
  return globalXaiGrokAuth
}

export function getGlobalXaiGrokAuth(): XaiGrokAuth {
  if (!globalXaiGrokAuth) {
    throw new Error('xAI Grok auth is not initialized')
  }
  return globalXaiGrokAuth
}

export function resetGlobalXaiGrokAuthForTests(): void {
  globalXaiGrokAuth?.stop()
  globalXaiGrokAuth = null
}

export { XAI_GROK_PROVIDER_ID, XAI_GROK_OAUTH_ISSUER, isTrustedXaiOAuthEndpoint } from './constants'
