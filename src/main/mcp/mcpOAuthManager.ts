import { createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'
import logger from '@shared/logger'
import {
  auth,
  ClientCredentialsProvider,
  discoverOAuthServerInfo,
  PrivateKeyJwtProvider,
  UnauthorizedError,
  validateAuthorizationResponseIssuer,
  type AuthorizationServerMetadata,
  type OAuthClientProvider,
  type OAuthServerInfo
} from '@modelcontextprotocol/client'
import type {
  MCPServerConfig,
  McpAuthorizationMode,
  McpCredentialBinding,
  McpCredentialInput,
  McpCredentialKind,
  McpCredentialStatus,
  McpEnterpriseIdentityProfile,
  McpEnterpriseIdentityStatus,
  McpServerAuthStatus
} from '@shared/types/mcp'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import {
  resolveOAuthLoopbackCallbackUrl,
  startOAuthLoopbackCallbackSession,
  type OAuthLoopbackCallbackSession
} from '../provider/auth/oauthLoopbackCallback'
import {
  MCP_OAUTH_CALLBACK_TIMEOUT_MS,
  MCP_OAUTH_REDIRECT_PATH,
  MCP_OAUTH_REDIRECT_PORT
} from './oauthConstants'
import {
  type McpOAuthCredentialStore,
  normalizeMcpOAuthIssuer,
  type McpOAuthCredentialEntry
} from './oauthCredentialStore'
import { DeepChatMcpOAuthProvider } from './mcpOAuthProvider'
import type { McpSettings } from './settings'
import { McpEnterpriseIdentityManager } from './enterpriseIdentityManager'

type PendingMcpOAuthFlow = {
  serverId: string
  serverName: string
  serverUrl: string
  initialBinding: McpCredentialBinding
  binding: McpCredentialBinding
  provider: DeepChatMcpOAuthProvider
  callbackSession: OAuthLoopbackCallbackSession
  flowPromise?: Promise<void>
  assertActive(): void
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

export const AUTH_EXTENSION_CLIENT_CREDENTIALS = 'io.modelcontextprotocol/oauth-client-credentials'
const AUTH_EXTENSION_ENTERPRISE = 'io.modelcontextprotocol/enterprise-managed-authorization'
export const MCP_CLIENT_CREDENTIALS_DRAFT_REVISION = 'fb374c7db2b34f18ca9183882e0beecdf661892b'

function createState(): string {
  return randomBytes(16).toString('base64url')
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/access_token["\s:=]+[^"'\s,}]+/gi, 'access_token:[redacted]')
    .replace(/refresh_token["\s:=]+[^"'\s,}]+/gi, 'refresh_token:[redacted]')
    .replace(/client_secret["\s:=]+[^"'\s,}]+/gi, 'client_secret:[redacted]')
    .replace(/(authorization_code|code|id_token)["\s:=]+[^"'\s,&}]+/gi, '$1:[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/g, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9._~-]+/g, '[redacted-jwt]')
    .slice(0, 2048)
}

function getAuthorizationHeader(config?: Partial<MCPServerConfig> | null): string | undefined {
  const authorization = Object.entries(config?.customHeaders ?? {}).find(
    ([key]) => key.toLowerCase() === 'authorization'
  )?.[1]
  return typeof authorization === 'string' ? authorization : undefined
}

function hasAuthorizationHeader(config?: Partial<MCPServerConfig> | null): boolean {
  return getAuthorizationHeader(config) !== undefined
}

function getAuthorizationMode(config?: Partial<MCPServerConfig> | null): McpAuthorizationMode {
  return config?.authorization?.mode || 'interactive'
}

function isRemoteOAuthCapable(config?: Partial<MCPServerConfig> | null): boolean {
  if (!config?.baseUrl || hasAuthorizationHeader(config)) {
    return false
  }
  if (config.type !== 'http' && config.type !== 'sse') {
    return false
  }
  const mode = getAuthorizationMode(config)
  if (mode === 'none') {
    return false
  }
  return config.type === 'http' || mode === 'interactive'
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

const requireServerBinding = (config: Partial<MCPServerConfig>): McpCredentialBinding => {
  if (!config.serverId || !config.configGeneration || !config.bindingHash || !config.baseUrl) {
    throw new Error('MCP server identity is incomplete')
  }
  return {
    serverId: config.serverId,
    configGeneration: config.configGeneration,
    bindingHash: config.bindingHash,
    endpoint: config.baseUrl,
    protectedResourceUrl: config.authorization?.protectedResourceUrl,
    authorizationServerIssuer: config.authorization?.authorizationServerIssuer,
    clientId: config.authorization?.clientId
  }
}

const createMcpCredentialKey = (
  credentialClass:
    | 'interactive_oauth'
    | 'client_secret'
    | 'private_key'
    | 'enterprise_resource_secret',
  binding: McpCredentialBinding
): string =>
  createHash('sha256')
    .update(
      [
        credentialClass,
        binding.serverId,
        String(binding.configGeneration),
        binding.bindingHash,
        binding.endpoint,
        binding.protectedResourceUrl || '',
        binding.authorizationServerIssuer || '',
        binding.clientId || ''
      ].join('\n')
    )
    .digest('hex')

const discoveryIssuer = (info: OAuthServerInfo): string =>
  info.authorizationServerMetadata?.issuer || info.authorizationServerUrl

const normalizeUrlIdentifier = (value: string): string => new URL(value).toString()

const assertConfiguredDiscovery = (config: MCPServerConfig, info: OAuthServerInfo): string => {
  const issuer = discoveryIssuer(info)
  const configuredIssuer = config.authorization?.authorizationServerIssuer
  if (
    configuredIssuer &&
    normalizeUrlIdentifier(configuredIssuer) !== normalizeUrlIdentifier(issuer)
  ) {
    throw new Error('MCP authorization server issuer does not match configuration')
  }
  const configuredResource = config.authorization?.protectedResourceUrl
  const discoveredResource = info.resourceMetadata?.resource
  if (
    configuredResource &&
    discoveredResource &&
    normalizeUrlIdentifier(configuredResource) !== normalizeUrlIdentifier(discoveredResource)
  ) {
    throw new Error('MCP protected resource does not match configuration')
  }
  return normalizeUrlIdentifier(issuer)
}

const supportedTokenAuthMethods = (metadata?: AuthorizationServerMetadata): string[] =>
  metadata?.token_endpoint_auth_methods_supported || ['client_secret_basic']

const bindProviderToProtectedResource = (
  provider: OAuthClientProvider,
  binding: McpCredentialBinding
): OAuthClientProvider => {
  if (!binding.protectedResourceUrl) {
    throw new Error('MCP protected resource is required')
  }
  const expectedServer = new URL(binding.endpoint).toString()
  const expectedResource = new URL(binding.protectedResourceUrl).toString()
  provider.validateResourceURL = async (serverUrl, discoveredResource) => {
    if (new URL(serverUrl).toString() !== expectedServer) {
      throw new Error('MCP authorization request does not match the configured server')
    }
    if (discoveredResource && new URL(discoveredResource).toString() !== expectedResource) {
      throw new Error('MCP protected resource does not match configuration')
    }
    return new URL(expectedResource)
  }
  return provider
}

const createFingerprint = (privateKey: string, algorithm: 'RS256' | 'ES256'): string => {
  if (
    !privateKey.startsWith('-----BEGIN PRIVATE KEY-----') ||
    !privateKey.includes('-----END PRIVATE KEY-----')
  ) {
    throw new Error('MCP private key must be PEM PKCS#8')
  }
  const key = createPrivateKey({ key: privateKey, format: 'pem' })
  const expectedKeyType = algorithm === 'RS256' ? 'rsa' : 'ec'
  if (key.asymmetricKeyType !== expectedKeyType) {
    throw new Error(`MCP private key does not match ${algorithm}`)
  }
  const fingerprint = createHash('sha256')
    .update(createPublicKey(key).export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .toUpperCase()
    .match(/.{1,2}/g)
    ?.join(':')
  if (!fingerprint) {
    throw new Error('MCP private key fingerprint could not be derived')
  }
  return fingerprint
}

export class McpOAuthManager {
  private readonly store: McpOAuthCredentialStore
  private readonly settings?: McpSettings
  private readonly statuses = new Map<string, McpServerAuthStatus>()
  private readonly pendingFlows = new Map<string, PendingMcpOAuthFlow>()
  private readonly enterpriseIdentity: McpEnterpriseIdentityManager | null
  private stopped = false
  private readonly generations = new Map<string, number>()

  private invalidate(id?: string): void {
    if (id) {
      this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
      this.cancelPendingFlow(id)
      this.statuses.delete(id)
    }
  }

  private captureOperation(id?: string): () => void {
    const generation = id ? (this.generations.get(id) ?? 0) : 0
    const check = () => {
      if (this.stopped || (id && generation !== (this.generations.get(id) ?? 0)))
        throw new Error('MCP OAuth operation interrupted')
    }
    check()
    return check
  }

  stop(): void {
    this.stopped = true
    for (const id of this.pendingFlows.keys()) this.cancelPendingFlow(id)
    this.statuses.clear()
    this.generations.clear()
    this.enterpriseIdentity?.stop()
    this.store.stop()
  }

  constructor(
    store: McpOAuthCredentialStore,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly onRuntimeChange?: (
      serverId: string,
      action: 'restart' | 'stop',
      assertCurrent: () => void
    ) => void | Promise<void>,
    settings?: McpSettings,
    private readonly onServerBindingChanged?: (serverId: string) => void
  ) {
    this.store = store
    this.settings = settings
    this.enterpriseIdentity = settings
      ? new McpEnterpriseIdentityManager(
          settings,
          store,
          publishEvent,
          openExternal,
          async (profileId, assertCurrent) => {
            const servers = await settings.getMcpServers()
            assertCurrent()
            for (const config of Object.values(servers)) {
              if (config.serverId && config.authorization?.identityProfileId === profileId) {
                const assertServerCurrent = this.captureOperation(config.serverId)
                await this.applyRuntimeChange(config.serverId, 'stop', () => {
                  assertCurrent()
                  assertServerCurrent()
                })
              }
            }
          }
        )
      : null
  }
  async getStatus(
    serverName: string,
    config?: Partial<MCPServerConfig> | null
  ): Promise<McpServerAuthStatus> {
    const assertCurrent = this.captureOperation(config?.serverId)
    try {
      if (!config || !isRemoteOAuthCapable(config)) {
        const authenticated = hasAuthorizationHeader(config)
        const mode = config ? getAuthorizationMode(config) : undefined
        return {
          serverName,
          serverId: config?.serverId,
          state: authenticated ? 'authenticated' : mode === 'none' ? 'none' : 'unsupported',
          authenticated,
          ...(await this.getStorageSnapshot()),
          mode
        }
      }
      const binding = requireServerBinding(config as Partial<MCPServerConfig>)
      const mode = getAuthorizationMode(config)
      const pending = this.pendingFlows.get(binding.serverId)
      if (pending) {
        return await this.buildStatus(serverName, binding, mode, {
          state: 'authenticating',
          authenticated: false
        })
      }
      if (mode === 'interactive') {
        const found = await this.findInteractiveCredential(serverName, config, binding)
        assertCurrent()
        if (found?.entry.tokens?.access_token) {
          return await this.buildStatus(serverName, binding, mode, {
            state: 'authenticated',
            authenticated: true,
            updatedAt: found.entry.updatedAt
          })
        }
      } else {
        const credential = await this.getSelectedCredentialStatus(binding, mode)
        assertCurrent()
        if (!credential.configured) {
          return await this.buildStatus(serverName, binding, mode, {
            state: 'required',
            authenticated: false,
            credential
          })
        }
        const existing = this.statuses.get(binding.serverId)
        if (existing?.state === 'authenticated') {
          return { ...existing, serverName, credential }
        }
        if (!existing || existing.state !== 'error') {
          return await this.buildStatus(serverName, binding, mode, {
            state: 'none',
            authenticated: false,
            credential
          })
        }
      }
      const existing = this.statuses.get(binding.serverId)
      if (existing?.state === 'required' || existing?.state === 'error') {
        return { ...existing, serverName }
      }
      return await this.buildStatus(serverName, binding, mode, {
        state: 'none',
        authenticated: false
      })
    } finally {
      assertCurrent()
    }
  }
  async createRuntimeProvider(
    serverName: string,
    config: Partial<MCPServerConfig>
  ): Promise<OAuthClientProvider | undefined> {
    const assertCurrent = this.captureOperation(config.serverId)
    try {
      if (!isRemoteOAuthCapable(config)) {
        return undefined
      }
      const completeConfig = config as MCPServerConfig
      const binding = requireServerBinding(completeConfig)
      const mode = getAuthorizationMode(completeConfig)
      if (mode === 'interactive') {
        const found = await this.findInteractiveCredential(serverName, completeConfig, binding)
        assertCurrent()
        if (!found?.entry.tokens?.access_token) {
          return undefined
        }
        assertCurrent()
        const info = await discoverOAuthServerInfo(binding.endpoint)
        assertCurrent()
        assertConfiguredDiscovery(completeConfig, info)
        if (!this.isInteractiveCredentialCurrent(found.entry, info)) {
          assertCurrent()
          await this.store.clearEntry(found.key)
          assertCurrent()
          return undefined
        }
        const provider = this.createInteractiveProvider(completeConfig, binding, {
          interactive: false,
          assertActive: assertCurrent,
          initialCredentialKey: found.key
        })
        await this.finalizeInteractiveBinding(
          completeConfig,
          provider,
          info,
          found.entry.clientInformation?.client_id
        )
        assertCurrent()
        return provider
      }
      if (
        !completeConfig.authorization?.authorizationServerIssuer ||
        !completeConfig.authorization.protectedResourceUrl
      ) {
        throw new Error('MCP machine authorization requires an issuer and protected resource')
      }
      assertCurrent()
      const info = await discoverOAuthServerInfo(binding.endpoint)
      assertCurrent()
      const issuer = assertConfiguredDiscovery(completeConfig, info)
      const discoveredBinding: McpCredentialBinding = {
        ...binding,
        authorizationServerIssuer: issuer,
        protectedResourceUrl: normalizeUrlIdentifier(
          info.resourceMetadata?.resource || binding.protectedResourceUrl!
        )
      }
      const provider = await this.createMachineProvider(completeConfig, discoveredBinding, info)
      assertCurrent()
      const result = await auth(provider, {
        serverUrl: binding.endpoint,
        scope: completeConfig.authorization?.scopes?.join(' ')
      })
      assertCurrent()
      if (result !== 'AUTHORIZED') {
        throw new Error('MCP machine authorization did not produce an access token')
      }
      this.setStatus(
        await this.buildStatus(serverName, discoveredBinding, mode, {
          state: 'authenticated',
          authenticated: true,
          credential: await this.getSelectedCredentialStatus(discoveredBinding, mode)
        }),
        assertCurrent
      )
      assertCurrent()
      return provider
    } finally {
      assertCurrent()
    }
  }
  async handleConnectionError(
    serverName: string,
    config: Partial<MCPServerConfig>,
    error: unknown
  ): Promise<boolean> {
    const assertCurrent = this.captureOperation(config?.serverId)
    try {
      if (!isRemoteOAuthCapable(config) || !isOAuthError(error)) {
        return false
      }
      const binding = requireServerBinding(config)
      const mode = getAuthorizationMode(config)
      this.setStatus(
        await this.buildStatus(serverName, binding, mode, {
          state: mode === 'interactive' ? 'required' : 'error',
          authenticated: false,
          error: sanitizeError(error),
          ...(mode === 'interactive'
            ? {}
            : { credential: await this.getSelectedCredentialStatus(binding, mode) })
        }),
        assertCurrent
      )
      assertCurrent()
      return true
    } finally {
      assertCurrent()
    }
  }
  async startAuth(
    serverName: string,
    config: Partial<MCPServerConfig>
  ): Promise<McpServerAuthStatus> {
    this.invalidate(config.serverId)
    const assertCurrent = this.captureOperation(config.serverId)
    try {
      if (!isRemoteOAuthCapable(config) || !config.baseUrl) {
        throw new Error('MCP server does not support OAuth authentication')
      }
      const completeConfig = config as MCPServerConfig
      const binding = requireServerBinding(completeConfig)
      const mode = getAuthorizationMode(completeConfig)
      if (mode !== 'interactive') {
        try {
          await this.createRuntimeProvider(serverName, completeConfig)
          assertCurrent()
        } catch (error) {
          this.setStatus(
            await this.buildStatus(serverName, binding, mode, {
              state: 'error',
              authenticated: false,
              error: sanitizeError(error),
              credential: await this.getSelectedCredentialStatus(binding, mode)
            }),
            assertCurrent
          )
          assertCurrent()
          return await this.getStatus(serverName, config)
        }
        assertCurrent()
        await this.applyRuntimeChange(binding.serverId, 'restart', assertCurrent).catch((error) => {
          logger.warn(
            '[MCP OAuth] Failed to restart server after machine authentication:',
            sanitizeError(error)
          )
        })
        assertCurrent()
        return await this.getStatus(serverName, config)
      }
      this.cancelPendingFlow(binding.serverId)
      const state = createState()
      let existing = await this.findInteractiveCredential(serverName, completeConfig, binding)
      assertCurrent()
      if (existing?.entry.discoveryState) {
        try {
          assertCurrent()
          const info = await discoverOAuthServerInfo(binding.endpoint)
          assertCurrent()
          assertConfiguredDiscovery(completeConfig, info)
          if (!this.isInteractiveCredentialCurrent(existing.entry, info)) {
            assertCurrent()
            await this.store.clearEntry(existing.key)
            assertCurrent()
            existing = null
          }
        } catch (error) {
          this.setStatus(
            await this.buildStatus(serverName, binding, mode, {
              state: 'error',
              authenticated: false,
              error: sanitizeError(error)
            }),
            assertCurrent
          )
          assertCurrent()
          return await this.getStatus(serverName, config)
        }
      }
      const client = existing?.entry.clientInformation
      const dynamicClient =
        client && client.client_id !== completeConfig.authorization?.clientMetadataUrl
      let callbackPath =
        completeConfig.authorization?.clientMetadataUrl && !dynamicClient
          ? MCP_OAUTH_REDIRECT_PATH
          : `${MCP_OAUTH_REDIRECT_PATH}/${encodeURIComponent(binding.serverId)}`
      let registeredRedirect: URL | null | undefined
      if (dynamicClient) {
        registeredRedirect =
          'redirect_uris' in client && Array.isArray(client.redirect_uris)
            ? client.redirect_uris
                .map((uri) => URL.parse(uri))
                .find(
                  (url) =>
                    url?.protocol === 'http:' &&
                    url.hostname === 'localhost' &&
                    !url.username &&
                    !url.password &&
                    !url.search &&
                    !url.hash &&
                    (url.pathname === MCP_OAUTH_REDIRECT_PATH ||
                      url.pathname.startsWith(`${MCP_OAUTH_REDIRECT_PATH}/`))
                )
            : undefined
        if (registeredRedirect) {
          callbackPath = registeredRedirect.pathname
        }
      }
      let provider!: DeepChatMcpOAuthProvider
      const callbackSession = await startOAuthLoopbackCallbackSession({
        expectedState: state,
        path: callbackPath,
        preferredPort: Number(registeredRedirect?.port) || MCP_OAUTH_REDIRECT_PORT,
        redirectHost: 'localhost',
        timeoutMs: MCP_OAUTH_CALLBACK_TIMEOUT_MS,
        invalidCallbackMessage: 'Invalid MCP OAuth callback',
        validateParameters: (parameters) => {
          const validation = provider.getCallbackValidation()
          validateAuthorizationResponseIssuer({
            iss: parameters.get('iss') || undefined,
            expectedIssuer: validation.issuer,
            issParameterSupported: validation.issParameterSupported
          })
        }
      })
      try {
        assertCurrent()
        if (
          existing &&
          dynamicClient &&
          registeredRedirect?.href !== new URL(callbackSession.redirectUri).href
        ) {
          assertCurrent()
          await this.store.clearEntryScope(existing.key, 'client')
          assertCurrent()
          await this.store.clearEntryScope(existing.key, 'tokens')
          assertCurrent()
        }
        provider = this.createInteractiveProvider(completeConfig, binding, {
          redirectUrl: callbackSession.redirectUri,
          state,
          interactive: true,
          assertActive: assertCurrent,
          initialCredentialKey: existing?.key
        })
      } catch (error) {
        callbackSession.close()
        assertCurrent()
        this.setStatus(
          await this.buildStatus(serverName, binding, mode, {
            state: 'error',
            authenticated: false,
            error: sanitizeError(error)
          }),
          assertCurrent
        )
        assertCurrent()
        return await this.getStatus(serverName, config)
      }
      const flow: PendingMcpOAuthFlow = {
        serverId: binding.serverId,
        serverName,
        serverUrl: config.baseUrl,
        initialBinding: binding,
        binding,
        provider,
        callbackSession,
        assertActive: assertCurrent
      }
      assertCurrent()
      this.pendingFlows.set(binding.serverId, flow)
      this.setStatus(
        await this.buildStatus(serverName, binding, mode, {
          state: 'authenticating',
          authenticated: false
        }),
        assertCurrent
      )
      assertCurrent()
      try {
        assertCurrent()
        const result = await auth(provider, {
          serverUrl: config.baseUrl,
          scope: completeConfig.authorization?.scopes?.join(' ')
        })
        assertCurrent()
        const discovery = await provider.discoveryState()
        assertCurrent()
        if (!discovery) {
          throw new Error('MCP OAuth discovery state is unavailable')
        }
        flow.binding = await this.finalizeInteractiveBinding(completeConfig, provider, discovery)
        assertCurrent()
        if (result === 'AUTHORIZED') {
          await this.finishAuthenticatedFlow(flow)
          assertCurrent()
          return await this.getStatus(
            serverName,
            await this.getCurrentConfig(serverName, completeConfig)
          )
        }
        flow.flowPromise = callbackSession
          .waitForCallback()
          .then(async (callback) => await this.finishAuthFlow(flow, callback.code, callback.iss))
          .catch(async (error) => await this.failAuthFlow(flow, error))
        return await this.getStatus(
          serverName,
          await this.getCurrentConfig(serverName, completeConfig)
        )
      } catch (error) {
        await this.failAuthFlow(flow, error)
        assertCurrent()
        return await this.getStatus(
          serverName,
          await this.getCurrentConfig(serverName, completeConfig)
        )
      }
    } finally {
      assertCurrent()
    }
  }
  async completeAuthFromCallbackUrl(
    serverName: string,
    config: Partial<MCPServerConfig>,
    callbackUrl: string
  ): Promise<McpServerAuthStatus> {
    const assertCurrent = this.captureOperation(config.serverId)
    try {
      const binding = requireServerBinding(config)
      const flow = this.pendingFlows.get(binding.serverId)
      if (!flow) {
        const status = await this.getStatus(serverName, config)
        assertCurrent()
        if (status.authenticated) {
          return status
        }
        this.setStatus(
          await this.buildStatus(serverName, binding, getAuthorizationMode(config), {
            state: 'error',
            authenticated: false,
            error: 'MCP OAuth authentication is not pending'
          }),
          assertCurrent
        )
        assertCurrent()
        return await this.getStatus(serverName, config)
      }
      const callbackCredentialKey = createMcpCredentialKey('interactive_oauth', binding)
      if (
        callbackCredentialKey !==
          createMcpCredentialKey('interactive_oauth', flow.initialBinding) &&
        callbackCredentialKey !== createMcpCredentialKey('interactive_oauth', flow.binding)
      ) {
        await this.failAuthFlow(
          flow,
          new Error('MCP OAuth server binding changed during authentication')
        )
        assertCurrent()
        return await this.getStatus(serverName, config)
      }
      const resolution = flow.callbackSession.resolveCallbackUrl(callbackUrl)
      if (resolution.kind === 'not-found') {
        await this.failAuthFlow(flow, new Error('MCP OAuth callback URL is invalid'))
        assertCurrent()
        return await this.getStatus(serverName, config)
      }
      await flow.flowPromise
      assertCurrent()
      return await this.getStatus(serverName, config)
    } finally {
      assertCurrent()
    }
  }
  async logout(
    serverName: string,
    config?: Partial<MCPServerConfig> | null
  ): Promise<McpServerAuthStatus> {
    this.invalidate(config?.serverId)
    const assertCurrent = this.captureOperation(config?.serverId)
    try {
      if (!config) {
        return {
          serverName,
          state: 'unsupported',
          authenticated: false,
          ...(await this.getStorageSnapshot())
        }
      }
      const binding = requireServerBinding(config)
      this.cancelPendingFlow(binding.serverId)
      const interactive = await this.findInteractiveCredential(serverName, config, binding)
      assertCurrent()
      if (interactive) {
        assertCurrent()
        await this.store.clearEntry(interactive.key)
        assertCurrent()
      }
      this.setStatus(
        await this.buildStatus(serverName, binding, getAuthorizationMode(config), {
          state: 'none',
          authenticated: false
        }),
        assertCurrent
      )
      assertCurrent()
      const status = await this.getStatus(serverName, config)
      await this.applyRuntimeChange(binding.serverId, 'stop', assertCurrent)
      return status
    } finally {
      assertCurrent()
    }
  }
  async getCredentialStatuses(config: MCPServerConfig): Promise<McpCredentialStatus[]> {
    const assertCurrent = this.captureOperation(config.serverId)
    try {
      const binding = requireServerBinding(config)
      return await Promise.all(
        (['client_secret', 'private_key', 'enterprise_resource_secret'] as const).map((kind) =>
          this.getCredentialStatus(binding, kind)
        )
      )
    } finally {
      assertCurrent()
    }
  }
  async setCredential(
    binding: McpCredentialBinding,
    credential: McpCredentialInput
  ): Promise<McpCredentialStatus> {
    this.invalidate(binding.serverId)
    const assertCurrent = this.captureOperation(binding.serverId)
    try {
      if (credential.kind === 'client_secret') {
        if (!credential.secret || credential.secret.length > 8192) {
          throw new Error('MCP client secret is invalid')
        }
        assertCurrent()
        await this.store.saveClientSecret(
          createMcpCredentialKey('client_secret', binding),
          credential.secret,
          binding
        )
        assertCurrent()
      } else if (credential.kind === 'enterprise_resource_secret') {
        if (!credential.secret || credential.secret.length > 8192) {
          throw new Error('MCP enterprise resource secret is invalid')
        }
        assertCurrent()
        await this.store.saveEnterpriseResourceSecret(
          createMcpCredentialKey('enterprise_resource_secret', binding),
          credential.secret,
          binding
        )
        assertCurrent()
      } else {
        if (!credential.privateKey || credential.privateKey.length > 64 * 1024) {
          throw new Error('MCP private key is invalid')
        }
        const fingerprint = createFingerprint(credential.privateKey, credential.algorithm)
        assertCurrent()
        await this.store.savePrivateKey(createMcpCredentialKey('private_key', binding), {
          privateKey: credential.privateKey,
          algorithm: credential.algorithm,
          fingerprint,
          binding
        })
        assertCurrent()
      }
      const status = await this.getCredentialStatus(binding, credential.kind)
      await this.applyRuntimeChange(binding.serverId, 'restart', assertCurrent)
      return status
    } finally {
      assertCurrent()
    }
  }
  async removeCredential(
    binding: McpCredentialBinding,
    kind: McpCredentialKind
  ): Promise<McpCredentialStatus> {
    this.invalidate(binding.serverId)
    const assertCurrent = this.captureOperation(binding.serverId)
    try {
      assertCurrent()
      await this.store.clearEntry(createMcpCredentialKey(kind, binding))
      assertCurrent()
      const status = await this.getCredentialStatus(binding, kind)
      await this.applyRuntimeChange(binding.serverId, 'stop', assertCurrent)
      return status
    } finally {
      assertCurrent()
    }
  }
  async clearServerCredentials(serverId: string): Promise<void> {
    this.invalidate(serverId)
    const assertCurrent = this.captureOperation(serverId)
    try {
      this.cancelPendingFlow(serverId)
      assertCurrent()
      await this.store.clearServerCredentials(serverId)
      assertCurrent()
      this.statuses.delete(serverId)
    } finally {
      assertCurrent()
    }
  }
  listEnterpriseProfiles(): McpEnterpriseIdentityProfile[] {
    return this.requireEnterpriseIdentity().listProfiles()
  }
  async saveEnterpriseProfile(
    profile: McpEnterpriseIdentityProfile
  ): Promise<McpEnterpriseIdentityProfile> {
    return await this.requireEnterpriseIdentity().saveProfile(profile)
  }
  async removeEnterpriseProfile(profileId: string): Promise<void> {
    await this.requireEnterpriseIdentity().removeProfile(profileId)
  }
  async setEnterpriseProfileClientSecret(
    profileId: string,
    secret: string
  ): Promise<McpEnterpriseIdentityStatus> {
    return await this.requireEnterpriseIdentity().setClientSecret(profileId, secret)
  }
  async getEnterpriseProfileStatus(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    return await this.requireEnterpriseIdentity().getStatus(profileId)
  }
  async startEnterpriseProfileAuth(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    return await this.requireEnterpriseIdentity().startAuth(profileId)
  }
  async completeEnterpriseProfileAuthFromCallbackUrl(
    profileId: string,
    callbackUrl: string
  ): Promise<McpEnterpriseIdentityStatus> {
    return await this.requireEnterpriseIdentity().completeAuthFromCallbackUrl(
      profileId,
      callbackUrl
    )
  }
  async logoutEnterpriseProfile(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    return await this.requireEnterpriseIdentity().logout(profileId)
  }
  async getUsableAuthorizationExtensions(config: Partial<MCPServerConfig>): Promise<string[]> {
    const assertCurrent = this.captureOperation(config.serverId)
    try {
      const mode = getAuthorizationMode(config)
      if (
        !isRemoteOAuthCapable(config) ||
        (mode !== 'client_credentials' && mode !== 'private_key_jwt' && mode !== 'cross_app_access')
      ) {
        return []
      }
      const binding = requireServerBinding(config)
      if (
        (mode === 'client_credentials' || mode === 'private_key_jwt') &&
        (await this.getSelectedCredentialStatus(binding, mode)).configured
      ) {
        return [AUTH_EXTENSION_CLIENT_CREDENTIALS]
      }
      if (
        mode === 'cross_app_access' &&
        (await this.getSelectedCredentialStatus(binding, mode)).configured
      ) {
        const profileId = config.authorization?.identityProfileId
        if (profileId) {
          try {
            if ((await this.enterpriseIdentity?.getStatus(profileId))?.authenticated) {
              return [AUTH_EXTENSION_ENTERPRISE]
            }
          } catch {
            return []
          }
        }
      }
      return []
    } finally {
      assertCurrent()
    }
  }
  private async getCurrentConfig(
    serverName: string,
    fallback: MCPServerConfig
  ): Promise<MCPServerConfig> {
    if (!this.settings) {
      return fallback
    }
    const servers = await this.settings.getMcpServers()
    return (
      Object.values(servers).find((config) => config.serverId === fallback.serverId) ||
      servers[serverName] ||
      fallback
    )
  }
  private isInteractiveCredentialCurrent(
    entry: McpOAuthCredentialEntry,
    info: OAuthServerInfo
  ): boolean {
    try {
      const liveIssuer = normalizeUrlIdentifier(discoveryIssuer(info))
      const storedIssuer =
        entry.binding?.authorizationServerIssuer ||
        entry.discoveryState?.authorizationServerMetadata?.issuer ||
        entry.discoveryState?.authorizationServerUrl ||
        entry.tokens?.issuer ||
        entry.clientInformation?.issuer
      if (!storedIssuer || normalizeUrlIdentifier(storedIssuer) !== liveIssuer) {
        return false
      }
      const liveResource = info.resourceMetadata?.resource
      const storedResource =
        entry.binding?.protectedResourceUrl || entry.discoveryState?.resourceMetadata?.resource
      return Boolean(
        !liveResource ||
        (storedResource &&
          normalizeUrlIdentifier(storedResource) === normalizeUrlIdentifier(liveResource))
      )
    } catch {
      return false
    }
  }
  private async finalizeInteractiveBinding(
    config: MCPServerConfig,
    provider: DeepChatMcpOAuthProvider,
    info: OAuthServerInfo,
    clientIdHint?: string
  ): Promise<McpCredentialBinding> {
    const assertCurrent = this.captureOperation(config.serverId)
    try {
      const startingBinding = requireServerBinding(config)
      const issuer = assertConfiguredDiscovery(config, info)
      const providerBinding = provider.getBinding()
      const resourceValue =
        info.resourceMetadata?.resource ||
        providerBinding.protectedResourceUrl ||
        config.authorization?.protectedResourceUrl
      const protectedResourceUrl = resourceValue ? normalizeUrlIdentifier(resourceValue) : undefined
      const clientId =
        clientIdHint || providerBinding.clientId || config.authorization?.clientId || undefined
      let finalBinding: McpCredentialBinding = {
        ...startingBinding,
        authorizationServerIssuer: issuer,
        protectedResourceUrl,
        clientId
      }
      if (this.settings) {
        assertCurrent()
        finalBinding = requireServerBinding(
          this.settings.finalizeOAuthBinding(startingBinding, {
            ...(config.authorization || { mode: 'interactive' as const }),
            authorizationServerIssuer: issuer,
            protectedResourceUrl,
            clientId
          })
        )
        if (
          finalBinding.configGeneration !== startingBinding.configGeneration ||
          finalBinding.bindingHash !== startingBinding.bindingHash
        )
          this.onServerBindingChanged?.(startingBinding.serverId)
      }
      await provider.rebind({
        ...finalBinding,
        authorizationServerIssuer: issuer,
        protectedResourceUrl,
        clientId
      })
      assertCurrent()
      return provider.getBinding()
    } finally {
      assertCurrent()
    }
  }
  private createInteractiveProvider(
    config: MCPServerConfig,
    binding: McpCredentialBinding,
    options: {
      redirectUrl?: string
      state?: string
      interactive: boolean
      initialCredentialKey?: string
      assertActive(): void
    }
  ): DeepChatMcpOAuthProvider {
    return new DeepChatMcpOAuthProvider({
      store: this.store,
      openExternal: this.openExternal,
      assertActive: options.assertActive,
      binding,
      credentialKey: (nextBinding) => createMcpCredentialKey('interactive_oauth', nextBinding),
      initialCredentialKey: options.initialCredentialKey,
      redirectUrl: options.redirectUrl || this.getDefaultRedirectUri(),
      state: options.state,
      interactive: options.interactive,
      clientMetadataUrl: config.authorization?.clientMetadataUrl,
      scopes: config.authorization?.scopes
    })
  }
  private async findInteractiveCredential(
    serverName: string,
    config: Partial<MCPServerConfig>,
    binding: McpCredentialBinding
  ) {
    const assertCurrent = this.captureOperation(binding.serverId)
    try {
      const current = await this.store.findInteractiveCredential(binding)
      assertCurrent()
      if (current) {
        return current
      }
      const legacyKey = createHash('sha256')
        .update(`${serverName}\n${config.type || ''}\n${config.baseUrl || ''}`)
        .digest('hex')
      const legacy = await this.store.load(legacyKey)
      assertCurrent()
      if (!legacy) {
        return null
      }
      const issuer =
        legacy.discoveryState?.authorizationServerMetadata?.issuer ||
        legacy.discoveryState?.authorizationServerUrl
      if (
        !issuer ||
        (binding.authorizationServerIssuer &&
          normalizeMcpOAuthIssuer(binding.authorizationServerIssuer) !==
            normalizeMcpOAuthIssuer(issuer))
      ) {
        assertCurrent()
        await this.store.clearEntry(legacyKey)
        assertCurrent()
        return null
      }
      const migratedBinding: McpCredentialBinding = {
        ...binding,
        authorizationServerIssuer: normalizeMcpOAuthIssuer(issuer),
        protectedResourceUrl:
          legacy.discoveryState?.resourceMetadata?.resource || binding.protectedResourceUrl
      }
      const nextKey = createMcpCredentialKey('interactive_oauth', migratedBinding)
      assertCurrent()
      return await this.store.moveInteractiveEntry(legacyKey, nextKey, migratedBinding)
    } finally {
      assertCurrent()
    }
  }
  private async createMachineProvider(
    config: MCPServerConfig,
    binding: McpCredentialBinding,
    info: OAuthServerInfo
  ): Promise<OAuthClientProvider> {
    const assertCurrent = this.captureOperation(binding.serverId)
    try {
      const mode = getAuthorizationMode(config)
      const clientId = config.authorization?.clientId
      if (!clientId) {
        throw new Error('MCP machine authorization client ID is required')
      }
      const methods = supportedTokenAuthMethods(info.authorizationServerMetadata)
      const issuer = discoveryIssuer(info)
      const scope = config.authorization?.scopes?.join(' ')
      if (mode === 'client_credentials') {
        if (!methods.includes('client_secret_basic')) {
          throw new Error('MCP authorization server does not support client_secret_basic')
        }
        const credential = await this.store.loadClientSecret(
          createMcpCredentialKey('client_secret', binding)
        )
        assertCurrent()
        if (!credential) {
          throw new Error('MCP client secret is not configured')
        }
        return bindProviderToProtectedResource(
          new ClientCredentialsProvider({
            clientId,
            clientSecret: credential.secret,
            clientName: 'DeepChat',
            scope,
            expectedIssuer: issuer
          }),
          binding
        )
      }
      if (mode === 'private_key_jwt') {
        if (!methods.includes('private_key_jwt')) {
          throw new Error('MCP authorization server does not support private_key_jwt')
        }
        const credential = await this.store.loadPrivateKey(
          createMcpCredentialKey('private_key', binding)
        )
        assertCurrent()
        if (!credential) {
          throw new Error('MCP private key is not configured')
        }
        return bindProviderToProtectedResource(
          new PrivateKeyJwtProvider({
            clientId,
            privateKey: credential.privateKey,
            algorithm: credential.algorithm,
            clientName: 'DeepChat',
            scope,
            expectedIssuer: issuer
          }),
          binding
        )
      }
      if (mode === 'cross_app_access') {
        if (!methods.includes('client_secret_basic')) {
          throw new Error('MCP authorization server does not support client_secret_basic')
        }
        const profiles = (
          info.authorizationServerMetadata as AuthorizationServerMetadata & {
            authorization_grant_profiles_supported?: string[]
          }
        ).authorization_grant_profiles_supported
        if (!profiles?.includes('urn:ietf:params:oauth:grant-profile:id-jag')) {
          throw new Error('MCP authorization server does not support the ID-JAG grant profile')
        }
        const credential = await this.store.loadEnterpriseResourceSecret(
          createMcpCredentialKey('enterprise_resource_secret', binding)
        )
        assertCurrent()
        if (!credential) {
          throw new Error('MCP enterprise resource client secret is not configured')
        }
        return bindProviderToProtectedResource(
          await this.requireEnterpriseIdentity().createCrossAppProvider(
            config,
            credential.secret,
            issuer
          ),
          binding
        )
      }
      throw new Error(`Unsupported MCP authorization mode: ${mode}`)
    } finally {
      assertCurrent()
    }
  }
  private async getCredentialStatus(
    binding: McpCredentialBinding,
    kind: McpCredentialKind
  ): Promise<McpCredentialStatus> {
    const assertCurrent = this.captureOperation(binding.serverId)
    try {
      const status = await this.store.getCredentialRecordStatus(
        createMcpCredentialKey(kind, binding),
        kind
      )
      assertCurrent()
      return {
        serverId: binding.serverId,
        kind,
        configured: status.configured,
        persistent: await this.store.isPersistent(),
        updatedAt: status.updatedAt,
        fingerprint: status.fingerprint
      }
    } finally {
      assertCurrent()
    }
  }
  private async getSelectedCredentialStatus(
    binding: McpCredentialBinding,
    mode: McpAuthorizationMode
  ): Promise<McpCredentialStatus> {
    const assertCurrent = this.captureOperation(binding.serverId)
    try {
      const kind: McpCredentialKind =
        mode === 'private_key_jwt'
          ? 'private_key'
          : mode === 'cross_app_access'
            ? 'enterprise_resource_secret'
            : 'client_secret'
      return await this.getCredentialStatus(binding, kind)
    } finally {
      assertCurrent()
    }
  }
  private async finishAuthFlow(
    flow: PendingMcpOAuthFlow,
    code: string,
    iss?: string
  ): Promise<void> {
    try {
      await auth(flow.provider, {
        serverUrl: flow.serverUrl,
        authorizationCode: code,
        iss
      })
      await this.finishAuthenticatedFlow(flow)
    } catch (error) {
      await this.failAuthFlow(flow, error)
    }
  }
  private async finishAuthenticatedFlow(flow: PendingMcpOAuthFlow): Promise<void> {
    if (this.stopped || this.pendingFlows.get(flow.serverId) !== flow) return
    const assertCurrent = flow.assertActive
    const entry = await this.store.findInteractiveCredential(flow.binding)
    assertCurrent()
    const storage = await this.getStorageSnapshot()
    assertCurrent()
    if (this.pendingFlows.get(flow.serverId) !== flow) return
    this.pendingFlows.delete(flow.serverId)
    flow.callbackSession.close()
    const current = this.statuses.get(flow.serverId)
    this.setStatus(
      {
        serverName: flow.serverName,
        serverId: flow.serverId,
        state: 'authenticated',
        authenticated: true,
        updatedAt: entry?.entry.updatedAt || Date.now(),
        ...storage,
        mode: 'interactive',
        ...(current?.credential ? { credential: current.credential } : {})
      },
      assertCurrent
    )
    void Promise.resolve()
      .then(() => {
        assertCurrent()
        return this.applyRuntimeChange(flow.serverId, 'restart', assertCurrent)
      })
      .catch((error) => {
        if (!this.stopped)
          logger.warn(
            '[MCP OAuth] Failed to restart server after authentication:',
            sanitizeError(error)
          )
      })
  }

  private async failAuthFlow(flow: PendingMcpOAuthFlow, error: unknown): Promise<void> {
    if (this.stopped || this.pendingFlows.get(flow.serverId) !== flow) return
    const assertCurrent = flow.assertActive
    try {
      const storage = await this.getStorageSnapshot()
      assertCurrent()
      if (this.pendingFlows.get(flow.serverId) !== flow) return
      this.pendingFlows.delete(flow.serverId)
      flow.callbackSession.close()
      this.setStatus(
        {
          serverName: flow.serverName,
          serverId: flow.serverId,
          state: 'error',
          authenticated: false,
          error: sanitizeError(error),
          ...storage,
          mode: 'interactive'
        },
        assertCurrent
      )
    } catch (failure) {
      if (this.stopped || this.pendingFlows.get(flow.serverId) !== flow) return
      throw failure
    }
  }

  private cancelPendingFlow(serverId: string): void {
    const pending = this.pendingFlows.get(serverId)
    if (!pending) {
      return
    }
    pending.callbackSession.close()
    this.pendingFlows.delete(serverId)
  }
  private async buildStatus(
    serverName: string,
    binding: McpCredentialBinding,
    mode: McpAuthorizationMode,
    state: Pick<McpServerAuthStatus, 'state' | 'authenticated'> &
      Partial<Pick<McpServerAuthStatus, 'error' | 'updatedAt' | 'credential'>>
  ): Promise<McpServerAuthStatus> {
    return {
      serverName,
      serverId: binding.serverId,
      ...state,
      ...(await this.getStorageSnapshot()),
      mode
    }
  }
  private async applyRuntimeChange(
    serverId: string,
    action: 'restart' | 'stop',
    assertCurrent: () => void
  ): Promise<void> {
    assertCurrent()
    await this.onRuntimeChange?.(serverId, action, assertCurrent)
    assertCurrent()
  }

  private async getStorageSnapshot() {
    const storage = await this.store.getStorageState()
    return { storage, persistent: storage === 'safeStorage' }
  }

  private setStatus(status: McpServerAuthStatus, assertCurrent: () => void): void {
    assertCurrent()
    if (status.serverId) {
      this.statuses.set(status.serverId, status)
    }
    this.publishEvent('mcp.server.auth.changed', {
      serverName: status.serverName,
      status,
      version: Date.now()
    })
  }
  private requireEnterpriseIdentity(): McpEnterpriseIdentityManager {
    if (!this.enterpriseIdentity) {
      throw new Error('MCP enterprise identity support is not configured')
    }
    return this.enterpriseIdentity
  }
  private getDefaultRedirectUri(): string {
    return `http://localhost:${MCP_OAUTH_REDIRECT_PORT}${MCP_OAUTH_REDIRECT_PATH}`
  }
}
export { isRemoteOAuthCapable, resolveOAuthLoopbackCallbackUrl }
