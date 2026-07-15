import logger from '@shared/logger'
import { shell } from 'electron'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
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
  private cachedDiscovery: DiscoveryEndpoints | null = null

  constructor(store = new XaiGrokCredentialStore()) {
    this.store = store
  }

  getStatus(): XaiGrokAuthStatus {
    if (isXaiGrokOAuthDisabled()) {
      return this.withStorage({
        state: 'disabled',
        authenticated: false
      })
    }

    if (this.pendingDeviceFlow && !this.pendingDeviceFlow.cancelled) {
      return this.withStorage({
        state: 'pending-device',
        authenticated: false,
        userCode: this.pendingDeviceFlow.userCode,
        verificationUri: this.pendingDeviceFlow.verificationUri,
        verificationUriComplete: this.pendingDeviceFlow.verificationUriComplete,
        ...(this.lastError ? { error: this.lastError } : {})
      })
    }

    const tokens = this.store.load()
    if (tokens) {
      return this.statusFromTokens(tokens)
    }

    return this.withStorage({
      state: this.lastError ? 'error' : 'signed-out',
      authenticated: false,
      ...(this.lastError ? { error: this.lastError } : {})
    })
  }

  isAuthenticated(): boolean {
    return this.getStatus().authenticated
  }

  /**
   * Returns a non-expired cached access token without network I/O.
   * Prefer ensureAccessToken() when a network refresh is acceptable.
   */
  peekAccessToken(): string | null {
    if (XAI_GROK_ACCESS_TOKEN_ENV) {
      return XAI_GROK_ACCESS_TOKEN_ENV
    }

    const tokens = this.store.load()
    if (!tokens) {
      return null
    }

    if (tokens.expiresAt > Date.now() + XAI_GROK_TOKEN_REFRESH_SKEW_MS) {
      return tokens.accessToken
    }

    // Still return near-expiry tokens for sync header paths; ensureAccessToken
    // will refresh on the next async entry point. Never return an expired token,
    // so API-key fallback remains available if refresh fails.
    return tokens.expiresAt > Date.now() ? tokens.accessToken : null
  }

  async startDeviceLogin(): Promise<XaiGrokAuthStatus> {
    this.assertEnabled()
    this.cancelLogin()
    this.lastError = null

    const abortController = new AbortController()

    try {
      const discovery = await this.fetchDiscovery(abortController.signal)
      const deviceCode = await this.requestDeviceCode(
        discovery.deviceAuthorizationEndpoint,
        abortController.signal
      )

      const flow: PendingDeviceFlow = {
        cancelled: false,
        abortController,
        userCode: deviceCode.userCode,
        verificationUri: deviceCode.verificationUri,
        verificationUriComplete: deviceCode.verificationUriComplete
      }
      this.pendingDeviceFlow = flow

      const browserUrl = deviceCode.verificationUriComplete || deviceCode.verificationUri
      try {
        await shell.openExternal(browserUrl)
      } catch (error) {
        logger.warn('[xAI Grok OAuth] Failed to open browser:', sanitizeError(error))
      }

      flow.flowPromise = this.completeDeviceLogin(flow, discovery, deviceCode)
      this.publishStatusChanged()
      return this.getStatus()
    } catch (error) {
      this.lastError = sanitizeError(error)
      this.pendingDeviceFlow = null
      this.publishStatusChanged()
      return this.getStatus()
    }
  }

  cancelLogin(): XaiGrokAuthStatus {
    if (this.pendingDeviceFlow) {
      this.pendingDeviceFlow.cancelled = true
      this.pendingDeviceFlow.abortController.abort()
      this.pendingDeviceFlow = null
    }
    this.publishStatusChanged()
    return this.getStatus()
  }

  async logout(): Promise<XaiGrokAuthStatus> {
    const tokens = this.store.load()
    this.cancelLogin()
    this.store.clear()
    this.lastError = null

    if (tokens?.refreshToken || tokens?.accessToken) {
      try {
        const discovery = await this.fetchDiscovery()
        if (discovery.revocationEndpoint) {
          await this.postForm(
            discovery.revocationEndpoint,
            {
              token: tokens.refreshToken || tokens.accessToken,
              client_id: XAI_GROK_OAUTH_CLIENT_ID
            },
            false
          )
        }
      } catch (error) {
        logger.warn('[xAI Grok OAuth] Token revoke failed:', sanitizeError(error))
      }
    }

    this.publishStatusChanged()
    return this.getStatus()
  }

  async ensureAccessToken(): Promise<string | null> {
    if (isXaiGrokOAuthDisabled()) {
      return null
    }

    if (XAI_GROK_ACCESS_TOKEN_ENV) {
      return XAI_GROK_ACCESS_TOKEN_ENV
    }

    const tokens = this.store.load()
    if (!tokens) {
      return null
    }

    try {
      const current =
        tokens.expiresAt > Date.now() + XAI_GROK_TOKEN_REFRESH_SKEW_MS
          ? tokens
          : await this.refreshAccessToken(tokens)
      return current.accessToken
    } catch (error) {
      this.lastError = sanitizeError(error)
      this.publishStatusChanged()
      throw error
    }
  }

  async getAccessToken(): Promise<string> {
    const token = await this.ensureAccessToken()
    if (!token) {
      throw new Error('xAI Grok OAuth sign-in is required')
    }
    return token
  }

  async forceRefreshAccessToken(): Promise<string> {
    this.assertEnabled()
    const tokens = this.store.load()
    if (!tokens?.refreshToken) {
      throw new Error('xAI Grok OAuth refresh token is unavailable')
    }
    const refreshed = await this.refreshAccessToken(tokens, true)
    return refreshed.accessToken
  }

  private withStorage(status: Omit<XaiGrokAuthStatus, 'storage'>): XaiGrokAuthStatus {
    return {
      ...status,
      storage: this.store.getStorageState()
    }
  }

  private statusFromTokens(tokens: XaiGrokTokenSet): XaiGrokAuthStatus {
    return this.withStorage({
      state: 'authenticated',
      authenticated: true,
      accountId: maskAccountId(tokens.accountId),
      accountLabel: tokens.accountLabel,
      expiresAt: tokens.expiresAt
    })
  }

  private assertEnabled(): void {
    if (isXaiGrokOAuthDisabled()) {
      throw new Error('xAI Grok OAuth is disabled by environment')
    }
  }

  private async completeDeviceLogin(
    flow: PendingDeviceFlow,
    discovery: DiscoveryEndpoints,
    deviceCode: DeviceCodeResponse
  ): Promise<void> {
    try {
      const tokens = await this.pollDeviceCodeToken(
        discovery.tokenEndpoint,
        deviceCode,
        flow.abortController.signal
      )
      if (flow.cancelled || this.pendingDeviceFlow !== flow) {
        return
      }

      const tokenSet = this.parseTokenResponse(tokens, undefined, {
        tokenEndpoint: discovery.tokenEndpoint,
        deviceAuthorizationEndpoint: discovery.deviceAuthorizationEndpoint
      })
      this.store.save(tokenSet)
      this.lastError = null
      this.pendingDeviceFlow = null
      this.publishStatusChanged()
    } catch (error) {
      if (flow.cancelled || this.pendingDeviceFlow !== flow) {
        return
      }

      this.lastError = sanitizeError(error)
      this.pendingDeviceFlow = null
      this.publishStatusChanged()
    }
  }

  private async fetchDiscovery(signal?: AbortSignal): Promise<DiscoveryEndpoints> {
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

    if (!response.ok) {
      throw new Error(`xAI OAuth discovery failed: ${await readErrorBody(response)}`)
    }

    const payload = (await response.json()) as TokenResponse
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
    signal?: AbortSignal
  ): Promise<DeviceCodeResponse> {
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

    if (!response.ok) {
      throw new Error(`xAI device code request failed: ${await readErrorBody(response)}`)
    }

    const payload = (await response.json()) as TokenResponse
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
    signal?: AbortSignal
  ): Promise<TokenResponse> {
    const deadlineMs = Date.now() + deviceCode.expiresInMs
    let intervalMs = deviceCode.intervalMs

    while (Date.now() < deadlineMs) {
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

  private async refreshAccessToken(
    currentTokens: XaiGrokTokenSet,
    force = false
  ): Promise<XaiGrokTokenSet> {
    if (!force && currentTokens.expiresAt > Date.now() + XAI_GROK_TOKEN_REFRESH_SKEW_MS) {
      return currentTokens
    }

    if (this.refreshPromise) {
      return this.refreshPromise
    }

    this.refreshPromise = this.refreshAccessTokenOnce(currentTokens).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async refreshAccessTokenOnce(currentTokens: XaiGrokTokenSet): Promise<XaiGrokTokenSet> {
    if (!currentTokens.refreshToken) {
      throw new Error('xAI Grok OAuth refresh token is unavailable')
    }

    let tokenEndpoint = currentTokens.tokenEndpoint
    if (!tokenEndpoint || !isTrustedXaiOAuthEndpoint(tokenEndpoint)) {
      tokenEndpoint = (await this.fetchDiscovery()).tokenEndpoint
    }

    const payload = await this.postForm(tokenEndpoint, {
      grant_type: 'refresh_token',
      client_id: XAI_GROK_OAUTH_CLIENT_ID,
      refresh_token: currentTokens.refreshToken
    })

    const refreshed = this.parseTokenResponse(payload, currentTokens, {
      tokenEndpoint,
      deviceAuthorizationEndpoint: currentTokens.deviceAuthorizationEndpoint
    })
    this.store.save(refreshed)
    this.lastError = null
    this.publishStatusChanged()
    return refreshed
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
    requireOk = true
  ): Promise<TokenResponse> {
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': XAI_GROK_OAUTH_USER_AGENT
      },
      body: toFormBody(params)
    })

    if (!response.ok) {
      if (!requireOk) {
        return {}
      }
      throw new Error(await readErrorBody(response))
    }

    return (await response.json()) as TokenResponse
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), XAI_GROK_AUTH_REQUEST_TIMEOUT_MS)
    const onExternalAbort = () => controller.abort(externalSignal?.reason)

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason)
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        if (externalSignal?.aborted) {
          throw new Error('xAI Grok OAuth login cancelled')
        }
        throw new Error(
          `xAI Grok OAuth request timed out after ${XAI_GROK_AUTH_REQUEST_TIMEOUT_MS}ms`
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
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

  private publishStatusChanged(): void {
    publishDeepchatEvent('oauth.xaiGrok.statusChanged', {
      status: this.getStatus(),
      version: Date.now()
    })
  }
}

export function getGlobalXaiGrokAuth(): XaiGrokAuth {
  if (!globalXaiGrokAuth) {
    globalXaiGrokAuth = new XaiGrokAuth()
  }
  return globalXaiGrokAuth
}

export function resetGlobalXaiGrokAuthForTests(): void {
  globalXaiGrokAuth = null
}

export { XAI_GROK_PROVIDER_ID, XAI_GROK_OAUTH_ISSUER, isTrustedXaiOAuthEndpoint } from './constants'
