import logger from '@shared/logger'
import { BrowserWindow } from 'electron'
import { URL } from 'url'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import {
  OPENAI_CODEX_ACCESS_TOKEN_ENV,
  OPENAI_CODEX_AUTH_REQUEST_TIMEOUT_MS,
  OPENAI_CODEX_AUTHORIZE_URL,
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

export type OpenAICodexBackendAuth = {
  accessToken: string
  accountId?: string
}

type PendingBrowserFlow = {
  state: string
  codeVerifier: string
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
    return text.slice(0, 1000)
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
  expectedState: string
): OpenAICodexCallbackResolution {
  const url = new URL(rawUrl || '/', `http://localhost:${OPENAI_CODEX_REDIRECT_PORT}`)
  if (url.pathname !== OPENAI_CODEX_REDIRECT_PATH) {
    return { kind: 'not-found' }
  }

  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (error) {
    return {
      kind: 'failure',
      error: new Error(error),
      message: 'Authorization failed. You can close this window.'
    }
  }

  if (!code || state !== expectedState) {
    return {
      kind: 'failure',
      error: new Error('Invalid OpenAI Codex OAuth callback'),
      message: 'Authorization state is invalid. You can close this window.'
    }
  }

  return {
    kind: 'success',
    code,
    message: 'Authorization complete. You can close this window.'
  }
}

export class OpenAICodexAuth {
  private readonly store: OpenAICodexCredentialStore
  private pendingBrowserFlow: PendingBrowserFlow | null = null
  private authWindow: BrowserWindow | null = null
  private refreshPromise: Promise<OpenAICodexTokenSet> | null = null
  private lastError: string | null = null

  constructor(store = new OpenAICodexCredentialStore()) {
    this.store = store
  }

  getStatus(): OpenAICodexAuthStatus {
    if (isOpenAICodexDisabled()) {
      return this.withStorage({
        state: 'disabled',
        authenticated: false
      })
    }

    if (this.pendingBrowserFlow && !this.pendingBrowserFlow.cancelled) {
      return this.withStorage({
        state: 'pending-browser',
        authenticated: false,
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

  async startBrowserLogin(): Promise<OpenAICodexAuthStatus> {
    this.assertEnabled()
    this.cancelLogin()
    this.lastError = null

    const state = createOpenAICodexState()
    const pkce = createOpenAICodexPkcePair()

    const authUrl = new URL(OPENAI_CODEX_AUTHORIZE_URL)
    authUrl.searchParams.set('client_id', OPENAI_CODEX_CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', OPENAI_CODEX_REDIRECT_URI)
    authUrl.searchParams.set('scope', OPENAI_CODEX_SCOPE)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', pkce.codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
    authUrl.searchParams.set('id_token_add_organizations', 'true')

    try {
      const flow: PendingBrowserFlow = {
        state,
        codeVerifier: pkce.codeVerifier,
        cancelled: false
      }
      this.pendingBrowserFlow = flow
      const authWindowPromise = this.openAuthWindow(authUrl.toString(), state)
      flow.flowPromise = this.completeBrowserLogin(flow, authWindowPromise)
      this.publishStatusChanged()
      return this.getStatus()
    } catch (error) {
      this.lastError = sanitizeError(error)
      this.pendingBrowserFlow = null
      this.stopAuthWindow()
      this.publishStatusChanged()
      return this.getStatus()
    }
  }

  cancelLogin(): OpenAICodexAuthStatus {
    if (this.pendingBrowserFlow) {
      this.pendingBrowserFlow.cancelled = true
      this.pendingBrowserFlow = null
    }
    this.stopAuthWindow()
    this.publishStatusChanged()
    return this.getStatus()
  }

  async logout(): Promise<OpenAICodexAuthStatus> {
    const tokens = this.store.load()
    this.cancelLogin()
    this.store.clear()
    this.lastError = null

    const tokenToRevoke = tokens?.refreshToken || tokens?.accessToken
    if (tokenToRevoke) {
      try {
        await this.postForm(OPENAI_CODEX_REVOKE_URL, {
          token: tokenToRevoke,
          client_id: OPENAI_CODEX_CLIENT_ID
        })
      } catch (error) {
        logger.warn('[OpenAI Codex] Token revoke failed:', sanitizeError(error))
      }
    }

    this.publishStatusChanged()
    return this.getStatus()
  }

  async getAccessToken(): Promise<string> {
    const auth = await this.getBackendAuth()
    return auth.accessToken
  }

  async forceRefreshAccessToken(): Promise<string> {
    const auth = await this.forceRefreshBackendAuth()
    return auth.accessToken
  }

  async getBackendAuth(): Promise<OpenAICodexBackendAuth> {
    this.assertEnabled()

    if (OPENAI_CODEX_ACCESS_TOKEN_ENV) {
      return { accessToken: OPENAI_CODEX_ACCESS_TOKEN_ENV }
    }

    const tokens = this.store.load()
    if (!tokens) {
      throw new Error('OpenAI Codex sign-in is required')
    }

    const current =
      tokens.expiresAt > Date.now() + OPENAI_CODEX_TOKEN_REFRESH_SKEW_MS
        ? tokens
        : await this.refreshAccessToken(tokens)
    return {
      accessToken: current.accessToken,
      accountId: current.accountId
    }
  }

  async forceRefreshBackendAuth(): Promise<OpenAICodexBackendAuth> {
    this.assertEnabled()
    const tokens = this.store.load()
    if (!tokens?.refreshToken) {
      throw new Error('OpenAI Codex refresh token is unavailable')
    }

    const refreshed = await this.refreshAccessToken(tokens, true)
    return {
      accessToken: refreshed.accessToken,
      accountId: refreshed.accountId
    }
  }

  private withStorage(status: Omit<OpenAICodexAuthStatus, 'storage'>): OpenAICodexAuthStatus {
    return {
      ...status,
      storage: this.store.getStorageState()
    }
  }

  private statusFromTokens(tokens: OpenAICodexTokenSet): OpenAICodexAuthStatus {
    return this.withStorage({
      state: 'authenticated',
      authenticated: true,
      accountId: maskAccountId(tokens.accountId),
      accountLabel: tokens.accountLabel,
      planType: tokens.planType,
      expiresAt: tokens.expiresAt
    })
  }

  private assertEnabled(): void {
    if (isOpenAICodexDisabled()) {
      throw new Error('OpenAI Codex provider is disabled by environment')
    }
  }

  private openAuthWindow(authUrl: string, expectedState: string): Promise<string> {
    this.stopAuthWindow()

    return new Promise<string>((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 520,
        height: 720,
        show: false,
        autoHideMenuBar: true,
        title: 'OpenAI Codex Authorization',
        minimizable: true,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true
        }
      })
      this.authWindow = authWindow
      let settled = false

      const rejectWindow = (error: Error) => {
        if (settled) {
          return
        }
        settled = true
        if (this.authWindow === authWindow) {
          this.authWindow = null
        }
        reject(error)
      }

      const resolveWindow = (code: string) => {
        if (settled) {
          return
        }
        settled = true
        resolve(code)
      }

      const handleNavigation = (url: string): boolean => {
        const callback = resolveOpenAICodexCallbackUrl(url, expectedState)
        if (callback.kind === 'not-found') {
          return false
        }

        if (callback.kind === 'failure') {
          rejectWindow(callback.error)
          return true
        }

        resolveWindow(callback.code)
        return true
      }

      authWindow.on('closed', () => {
        rejectWindow(new Error('OpenAI Codex browser login window was closed'))
      })

      authWindow.webContents.on('will-redirect', (event, url) => {
        if (handleNavigation(url)) {
          event.preventDefault()
        }
      })

      authWindow.webContents.on('will-navigate', (event, url) => {
        if (handleNavigation(url)) {
          event.preventDefault()
        }
      })

      authWindow.webContents.on('did-navigate', (_event, url) => {
        handleNavigation(url)
      })

      authWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (handleNavigation(url)) {
          return { action: 'deny' }
        }
        void Promise.resolve(authWindow.loadURL(url)).catch((error) => {
          rejectWindow(error instanceof Error ? error : new Error(String(error)))
        })
        return { action: 'deny' }
      })

      void Promise.resolve(authWindow.loadURL(authUrl)).catch((error) => {
        rejectWindow(error instanceof Error ? error : new Error(String(error)))
      })
      authWindow.show()
      authWindow.focus()
    })
  }

  private async completeBrowserLogin(
    flow: PendingBrowserFlow,
    codePromise: Promise<string>
  ): Promise<void> {
    try {
      const code = await codePromise
      if (flow.cancelled || this.pendingBrowserFlow !== flow) {
        return
      }

      const tokens = await this.exchangeAuthorizationCode(code, flow.codeVerifier)
      if (flow.cancelled || this.pendingBrowserFlow !== flow) {
        return
      }

      this.store.save(tokens)
      this.lastError = null
      this.pendingBrowserFlow = null
      this.stopAuthWindow()
      this.publishStatusChanged()
    } catch (error) {
      if (flow.cancelled || this.pendingBrowserFlow !== flow) {
        return
      }

      this.lastError = sanitizeError(error)
      this.pendingBrowserFlow = null
      this.stopAuthWindow()
      this.publishStatusChanged()
    }
  }

  private stopAuthWindow(): void {
    const authWindow = this.authWindow
    this.authWindow = null
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.close()
    }
  }

  private async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string
  ): Promise<OpenAICodexTokenSet> {
    const payload = await this.postForm(OPENAI_CODEX_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: OPENAI_CODEX_CLIENT_ID,
      code,
      redirect_uri: OPENAI_CODEX_REDIRECT_URI,
      code_verifier: codeVerifier
    })

    return this.parseTokenResponse(payload)
  }

  private async refreshAccessToken(
    currentTokens: OpenAICodexTokenSet,
    force = false
  ): Promise<OpenAICodexTokenSet> {
    if (!force && currentTokens.expiresAt > Date.now() + OPENAI_CODEX_TOKEN_REFRESH_SKEW_MS) {
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

  private async refreshAccessTokenOnce(
    currentTokens: OpenAICodexTokenSet
  ): Promise<OpenAICodexTokenSet> {
    if (!currentTokens.refreshToken) {
      throw new Error('OpenAI Codex refresh token is unavailable')
    }

    const payload = await this.postForm(OPENAI_CODEX_TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: OPENAI_CODEX_CLIENT_ID,
      refresh_token: currentTokens.refreshToken
    })
    const refreshed = this.parseTokenResponse(payload, currentTokens)
    this.store.save(refreshed)
    this.lastError = null
    this.publishStatusChanged()
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
    params: Record<string, string | undefined>
  ): Promise<TokenResponse> {
    const body = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        body.set(key, value)
      }
    })

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })

    if (!response.ok) {
      throw new Error(await readErrorBody(response))
    }

    return (await response.json()) as TokenResponse
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), OPENAI_CODEX_AUTH_REQUEST_TIMEOUT_MS)
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `OpenAI Codex auth request timed out after ${OPENAI_CODEX_AUTH_REQUEST_TIMEOUT_MS}ms`
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private publishStatusChanged(): void {
    publishDeepchatEvent('oauth.openaiCodex.statusChanged', {
      status: this.getStatus(),
      version: Date.now()
    })
  }
}

export function getGlobalOpenAICodexAuth(): OpenAICodexAuth {
  if (!globalOpenAICodexAuth) {
    globalOpenAICodexAuth = new OpenAICodexAuth()
  }

  return globalOpenAICodexAuth
}
