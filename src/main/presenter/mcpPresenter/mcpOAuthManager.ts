import crypto from 'crypto'
import logger from '@shared/logger'
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { MCPServerConfig, McpServerAuthStatus } from '@shared/presenter'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import {
  resolveOAuthLoopbackCallbackUrl,
  startOAuthLoopbackCallbackSession,
  type OAuthLoopbackCallbackSession
} from '../oauthLoopbackCallback'
import {
  MCP_OAUTH_CALLBACK_TIMEOUT_MS,
  MCP_OAUTH_REDIRECT_PATH,
  MCP_OAUTH_REDIRECT_PORT
} from './oauthConstants'
import { McpOAuthCredentialStore } from './oauthCredentialStore'
import { DeepChatMcpOAuthProvider } from './mcpOAuthProvider'

type PendingMcpOAuthFlow = {
  serverName: string
  serverUrl: string
  credentialKey: string
  state: string
  provider: DeepChatMcpOAuthProvider
  callbackSession: OAuthLoopbackCallbackSession
  flowPromise?: Promise<void>
}

const OAUTH_AUTH_ERROR_PATTERNS = [
  '401',
  'unauthorized',
  'auth required',
  'authentication required',
  'authorization required',
  'invalid_token',
  'no auth provider'
]

function createState(): string {
  return crypto.randomBytes(16).toString('base64url')
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/access_token["\s:=]+[^"'\s,}]+/gi, 'access_token:[redacted]')
    .replace(/refresh_token["\s:=]+[^"'\s,}]+/gi, 'refresh_token:[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/g, 'Bearer [redacted]')
}

function hasBearerHeader(config?: Partial<MCPServerConfig> | null): boolean {
  const authorization = config?.customHeaders?.Authorization || config?.customHeaders?.authorization
  return (
    typeof authorization === 'string' && authorization.trim().toLowerCase().startsWith('bearer ')
  )
}

function isRemoteOAuthCapable(config?: Partial<MCPServerConfig> | null): boolean {
  return Boolean(
    config?.baseUrl && (config.type === 'http' || config.type === 'sse') && !hasBearerHeader(config)
  )
}

function isOAuthError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) {
    return true
  }

  const errorLike = error as
    | {
        code?: unknown
        status?: unknown
        httpStatus?: unknown
        response?: { status?: unknown }
      }
    | undefined
  const statuses = [
    errorLike?.code,
    errorLike?.status,
    errorLike?.httpStatus,
    errorLike?.response?.status
  ]
  if (statuses.some((status) => status === 401 || status === '401')) {
    return true
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return OAUTH_AUTH_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

export class McpOAuthManager {
  private readonly store: McpOAuthCredentialStore
  private readonly statuses = new Map<string, McpServerAuthStatus>()
  private readonly pendingFlows = new Map<string, PendingMcpOAuthFlow>()

  constructor(
    store = new McpOAuthCredentialStore(),
    private readonly onAuthenticated?: (serverName: string) => void | Promise<void>
  ) {
    this.store = store
  }

  getStatus(serverName: string, config?: Partial<MCPServerConfig> | null): McpServerAuthStatus {
    if (!isRemoteOAuthCapable(config)) {
      return {
        serverName,
        state: hasBearerHeader(config) ? 'authenticated' : 'unsupported',
        authenticated: hasBearerHeader(config),
        storage: this.store.getStorageState()
      }
    }

    const pending = this.pendingFlows.get(serverName)
    if (pending) {
      return {
        serverName,
        state: 'authenticating',
        authenticated: false,
        storage: this.store.getStorageState()
      }
    }

    const entry = this.store.load(
      this.getCredentialKey(serverName, config as Partial<MCPServerConfig>)
    )
    if (entry?.tokens?.access_token) {
      return {
        serverName,
        state: 'authenticated',
        authenticated: true,
        updatedAt: entry.updatedAt,
        storage: this.store.getStorageState()
      }
    }

    const existing = this.statuses.get(serverName)
    if (existing?.state === 'required' || existing?.state === 'error') {
      return existing
    }

    return {
      serverName,
      state: 'none',
      authenticated: false,
      storage: this.store.getStorageState()
    }
  }

  createRuntimeProvider(
    serverName: string,
    config: Partial<MCPServerConfig>
  ): DeepChatMcpOAuthProvider | undefined {
    if (!isRemoteOAuthCapable(config)) {
      return undefined
    }

    const credentialKey = this.getCredentialKey(serverName, config)
    if (!this.store.load(credentialKey)?.tokens?.access_token) {
      return undefined
    }

    return new DeepChatMcpOAuthProvider({
      store: this.store,
      credentialKey,
      redirectUrl: this.getDefaultRedirectUri(),
      interactive: false
    })
  }

  handleConnectionError(
    serverName: string,
    config: Partial<MCPServerConfig>,
    error: unknown
  ): boolean {
    if (!isRemoteOAuthCapable(config) || !isOAuthError(error)) {
      return false
    }

    this.setStatus({
      serverName,
      state: 'required',
      authenticated: false,
      error: sanitizeError(error),
      storage: this.store.getStorageState()
    })
    return true
  }

  async startAuth(
    serverName: string,
    config: Partial<MCPServerConfig>
  ): Promise<McpServerAuthStatus> {
    if (!isRemoteOAuthCapable(config) || !config.baseUrl) {
      throw new Error('MCP server does not support OAuth authentication')
    }

    this.cancelPendingFlow(serverName)

    const state = createState()
    const callbackSession = await startOAuthLoopbackCallbackSession({
      expectedState: state,
      path: MCP_OAUTH_REDIRECT_PATH,
      preferredPort: MCP_OAUTH_REDIRECT_PORT,
      redirectHost: 'localhost',
      timeoutMs: MCP_OAUTH_CALLBACK_TIMEOUT_MS,
      invalidCallbackMessage: 'Invalid MCP OAuth callback'
    })
    const credentialKey = this.getCredentialKey(serverName, config)
    const provider = new DeepChatMcpOAuthProvider({
      store: this.store,
      credentialKey,
      redirectUrl: callbackSession.redirectUri,
      state,
      interactive: true
    })
    const flow: PendingMcpOAuthFlow = {
      serverName,
      serverUrl: config.baseUrl,
      credentialKey,
      state,
      provider,
      callbackSession
    }

    this.pendingFlows.set(serverName, flow)
    this.setStatus({
      serverName,
      state: 'authenticating',
      authenticated: false,
      storage: this.store.getStorageState()
    })

    try {
      const result = await auth(provider, { serverUrl: config.baseUrl })
      if (result === 'AUTHORIZED') {
        this.finishAuthenticatedFlow(flow)
        return this.getStatus(serverName, config)
      }

      flow.flowPromise = callbackSession
        .waitForCallback()
        .then((callback) => this.finishAuthFlow(flow, callback.code))
        .catch((error) => this.failAuthFlow(flow, error))

      return this.getStatus(serverName, config)
    } catch (error) {
      this.failAuthFlow(flow, error)
      return this.getStatus(serverName, config)
    }
  }

  async completeAuthFromCallbackUrl(
    serverName: string,
    config: Partial<MCPServerConfig>,
    callbackUrl: string
  ): Promise<McpServerAuthStatus> {
    const flow = this.pendingFlows.get(serverName)
    if (!flow) {
      const status = this.getStatus(serverName, config)
      if (status.authenticated) {
        return status
      }

      this.setStatus({
        serverName,
        state: 'error',
        authenticated: false,
        error: 'MCP OAuth authentication is not pending',
        storage: this.store.getStorageState()
      })
      return this.getStatus(serverName, config)
    }

    const resolution = flow.callbackSession.resolveCallbackUrl(callbackUrl)
    if (resolution.kind === 'not-found') {
      const status: McpServerAuthStatus = {
        serverName,
        state: 'error',
        authenticated: false,
        error: 'MCP OAuth callback URL is invalid',
        storage: this.store.getStorageState()
      }
      this.setStatus(status)
      return status
    }

    await flow.flowPromise
    return this.getStatus(serverName, config)
  }

  logout(serverName: string, config?: Partial<MCPServerConfig> | null): McpServerAuthStatus {
    this.cancelPendingFlow(serverName)
    if (config) {
      this.store.clearEntry(this.getCredentialKey(serverName, config))
    }
    this.setStatus({
      serverName,
      state: 'none',
      authenticated: false,
      storage: this.store.getStorageState()
    })
    return this.getStatus(serverName, config)
  }

  private async finishAuthFlow(flow: PendingMcpOAuthFlow, code: string): Promise<void> {
    try {
      await auth(flow.provider, {
        serverUrl: flow.serverUrl,
        authorizationCode: code
      })
      this.finishAuthenticatedFlow(flow)
    } catch (error) {
      this.failAuthFlow(flow, error)
    }
  }

  private finishAuthenticatedFlow(flow: PendingMcpOAuthFlow): void {
    if (this.pendingFlows.get(flow.serverName) !== flow) {
      return
    }

    this.pendingFlows.delete(flow.serverName)
    flow.callbackSession.close()
    const entry = this.store.load(flow.credentialKey)
    this.setStatus({
      serverName: flow.serverName,
      state: 'authenticated',
      authenticated: true,
      updatedAt: entry?.updatedAt || Date.now(),
      storage: this.store.getStorageState()
    })

    void Promise.resolve(this.onAuthenticated?.(flow.serverName)).catch((error) => {
      logger.warn(
        '[MCP OAuth] Failed to restart server after authentication:',
        sanitizeError(error)
      )
    })
  }

  private failAuthFlow(flow: PendingMcpOAuthFlow, error: unknown): void {
    if (this.pendingFlows.get(flow.serverName) !== flow) {
      return
    }

    this.pendingFlows.delete(flow.serverName)
    flow.callbackSession.close()
    this.setStatus({
      serverName: flow.serverName,
      state: 'error',
      authenticated: false,
      error: sanitizeError(error),
      storage: this.store.getStorageState()
    })
  }

  private cancelPendingFlow(serverName: string): void {
    const pending = this.pendingFlows.get(serverName)
    if (!pending) {
      return
    }

    pending.callbackSession.close()
    this.pendingFlows.delete(serverName)
  }

  private setStatus(status: McpServerAuthStatus): void {
    this.statuses.set(status.serverName, status)
    publishDeepchatEvent('mcp.server.auth.changed', {
      serverName: status.serverName,
      status,
      version: Date.now()
    })
  }

  private getCredentialKey(serverName: string, config: Partial<MCPServerConfig>): string {
    const baseUrl = config.baseUrl || ''
    return crypto
      .createHash('sha256')
      .update(`${serverName}\n${config.type || ''}\n${baseUrl}`)
      .digest('hex')
  }

  private getDefaultRedirectUri(): string {
    return `http://localhost:${MCP_OAUTH_REDIRECT_PORT}${MCP_OAUTH_REDIRECT_PATH}`
  }
}

export { isRemoteOAuthCapable, resolveOAuthLoopbackCallbackUrl }
