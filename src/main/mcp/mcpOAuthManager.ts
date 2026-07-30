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
import { MCP_OAUTH_CALLBACK_TIMEOUT_MS, MCP_OAUTH_REDIRECT_PORT } from './oauthConstants'
import { McpOAuthCredentialStore, type McpOAuthCredentialEntry } from './oauthCredentialStore'
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

  constructor(
    store = new McpOAuthCredentialStore(),
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly onAuthenticated?: (serverName: string) => void | Promise<void>,
    settings?: McpSettings,
    private readonly onServerBindingChanged?: (serverId: string) => void
  ) {
    this.store = store
    this.settings = settings
    this.enterpriseIdentity = settings
      ? new McpEnterpriseIdentityManager(settings, store, publishEvent)
      : null
  }

  getStatus(serverName: string, config?: Partial<MCPServerConfig> | null): McpServerAuthStatus {
    if (!config || !isRemoteOAuthCapable(config)) {
      const authenticated = hasAuthorizationHeader(config)
      const mode = config ? getAuthorizationMode(config) : undefined
      return {
        serverName,
        serverId: config?.serverId,
        state: authenticated ? 'authenticated' : mode === 'none' ? 'none' : 'unsupported',
        authenticated,
        storage: this.store.getStorageState(),
        persistent: this.store.isPersistent(),
        mode
      }
    }

    const binding = requireServerBinding(config as Partial<MCPServerConfig>)
    const mode = getAuthorizationMode(config)
    const pending = this.pendingFlows.get(binding.serverId)
    if (pending) {
      return this.buildStatus(serverName, binding, mode, {
        state: 'authenticating',
        authenticated: false
      })
    }

    if (mode === 'interactive') {
      const found = this.findInteractiveCredential(serverName, config, binding)
      if (found?.entry.tokens?.access_token) {
        return this.buildStatus(serverName, binding, mode, {
          state: 'authenticated',
          authenticated: true,
          updatedAt: found.entry.updatedAt
        })
      }
    } else {
      const credential = this.getSelectedCredentialStatus(binding, mode)
      if (!credential.configured) {
        return this.buildStatus(serverName, binding, mode, {
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
        return this.buildStatus(serverName, binding, mode, {
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

    return this.buildStatus(serverName, binding, mode, {
      state: 'none',
      authenticated: false
    })
  }

  async createRuntimeProvider(
    serverName: string,
    config: Partial<MCPServerConfig>
  ): Promise<OAuthClientProvider | undefined> {
    if (!isRemoteOAuthCapable(config)) {
      return undefined
    }
    const completeConfig = config as MCPServerConfig
    const binding = requireServerBinding(completeConfig)
    const mode = getAuthorizationMode(completeConfig)

    if (mode === 'interactive') {
      const found = this.findInteractiveCredential(serverName, completeConfig, binding)
      if (!found?.entry.tokens?.access_token) {
        return undefined
      }
      const info = await discoverOAuthServerInfo(binding.endpoint)
      assertConfiguredDiscovery(completeConfig, info)
      if (!this.isInteractiveCredentialCurrent(found.entry, info)) {
        this.store.clearEntry(found.key)
        return undefined
      }
      const provider = this.createInteractiveProvider(completeConfig, binding, {
        interactive: false,
        initialCredentialKey: found.key
      })
      await this.finalizeInteractiveBinding(
        completeConfig,
        provider,
        info,
        found.entry.clientInformation?.client_id
      )
      return provider
    }

    if (
      !completeConfig.authorization?.authorizationServerIssuer ||
      !completeConfig.authorization.protectedResourceUrl
    ) {
      throw new Error('MCP machine authorization requires an issuer and protected resource')
    }
    const info = await discoverOAuthServerInfo(binding.endpoint)
    const issuer = assertConfiguredDiscovery(completeConfig, info)
    const discoveredBinding: McpCredentialBinding = {
      ...binding,
      authorizationServerIssuer: issuer,
      protectedResourceUrl: normalizeUrlIdentifier(
        info.resourceMetadata?.resource || binding.protectedResourceUrl!
      )
    }
    const provider = await this.createMachineProvider(completeConfig, discoveredBinding, info)
    const result = await auth(provider, {
      serverUrl: binding.endpoint,
      scope: completeConfig.authorization?.scopes?.join(' ')
    })
    if (result !== 'AUTHORIZED') {
      throw new Error('MCP machine authorization did not produce an access token')
    }
    this.setStatus(
      this.buildStatus(serverName, discoveredBinding, mode, {
        state: 'authenticated',
        authenticated: true,
        credential: this.getSelectedCredentialStatus(discoveredBinding, mode)
      })
    )
    return provider
  }

  handleConnectionError(
    serverName: string,
    config: Partial<MCPServerConfig>,
    error: unknown
  ): boolean {
    if (!isRemoteOAuthCapable(config) || !isOAuthError(error)) {
      return false
    }
    const binding = requireServerBinding(config)
    const mode = getAuthorizationMode(config)
    this.setStatus(
      this.buildStatus(serverName, binding, mode, {
        state: mode === 'interactive' ? 'required' : 'error',
        authenticated: false,
        error: sanitizeError(error),
        ...(mode === 'interactive'
          ? {}
          : { credential: this.getSelectedCredentialStatus(binding, mode) })
      })
    )
    return true
  }

  async startAuth(
    serverName: string,
    config: Partial<MCPServerConfig>
  ): Promise<McpServerAuthStatus> {
    if (!isRemoteOAuthCapable(config) || !config.baseUrl) {
      throw new Error('MCP server does not support OAuth authentication')
    }
    const completeConfig = config as MCPServerConfig
    const binding = requireServerBinding(completeConfig)
    const mode = getAuthorizationMode(completeConfig)
    if (mode !== 'interactive') {
      try {
        await this.createRuntimeProvider(serverName, completeConfig)
      } catch (error) {
        this.setStatus(
          this.buildStatus(serverName, binding, mode, {
            state: 'error',
            authenticated: false,
            error: sanitizeError(error),
            credential: this.getSelectedCredentialStatus(binding, mode)
          })
        )
        return this.getStatus(serverName, config)
      }
      await Promise.resolve(this.onAuthenticated?.(serverName)).catch((error) => {
        logger.warn(
          '[MCP OAuth] Failed to restart server after machine authentication:',
          sanitizeError(error)
        )
      })
      return this.getStatus(serverName, config)
    }

    this.cancelPendingFlow(binding.serverId)
    const state = createState()
    const callbackPath = `/mcp/oauth/callback/${randomBytes(12).toString('base64url')}`
    let existing = this.findInteractiveCredential(serverName, completeConfig, binding)
    if (existing?.entry.discoveryState) {
      try {
        const info = await discoverOAuthServerInfo(binding.endpoint)
        assertConfiguredDiscovery(completeConfig, info)
        if (!this.isInteractiveCredentialCurrent(existing.entry, info)) {
          this.store.clearEntry(existing.key)
          existing = null
        }
      } catch (error) {
        this.setStatus(
          this.buildStatus(serverName, binding, mode, {
            state: 'error',
            authenticated: false,
            error: sanitizeError(error)
          })
        )
        return this.getStatus(serverName, config)
      }
    }
    let provider!: DeepChatMcpOAuthProvider
    const callbackSession = await startOAuthLoopbackCallbackSession({
      expectedState: state,
      path: callbackPath,
      preferredPort: MCP_OAUTH_REDIRECT_PORT,
      redirectHost: 'localhost',
      timeoutMs: MCP_OAUTH_CALLBACK_TIMEOUT_MS,
      invalidCallbackMessage: 'Invalid MCP OAuth callback',
      validateParameters: (parameters) => {
        const discovery = provider.discoveryState()
        validateAuthorizationResponseIssuer({
          iss: parameters.get('iss') || undefined,
          expectedIssuer:
            discovery?.authorizationServerMetadata?.issuer || discovery?.authorizationServerUrl,
          issParameterSupported:
            discovery?.authorizationServerMetadata
              ?.authorization_response_iss_parameter_supported === true
        })
      }
    })
    try {
      provider = this.createInteractiveProvider(completeConfig, binding, {
        redirectUrl: callbackSession.redirectUri,
        state,
        interactive: true,
        initialCredentialKey: existing?.key
      })
    } catch (error) {
      callbackSession.close()
      this.setStatus(
        this.buildStatus(serverName, binding, mode, {
          state: 'error',
          authenticated: false,
          error: sanitizeError(error)
        })
      )
      return this.getStatus(serverName, config)
    }
    const flow: PendingMcpOAuthFlow = {
      serverId: binding.serverId,
      serverName,
      serverUrl: config.baseUrl,
      initialBinding: binding,
      binding,
      provider,
      callbackSession
    }
    this.pendingFlows.set(binding.serverId, flow)
    this.setStatus(
      this.buildStatus(serverName, binding, mode, {
        state: 'authenticating',
        authenticated: false
      })
    )

    try {
      const result = await auth(provider, {
        serverUrl: config.baseUrl,
        scope: completeConfig.authorization?.scopes?.join(' ')
      })
      const discovery = provider.discoveryState()
      if (!discovery) {
        throw new Error('MCP OAuth discovery state is unavailable')
      }
      flow.binding = await this.finalizeInteractiveBinding(completeConfig, provider, discovery)
      if (result === 'AUTHORIZED') {
        this.finishAuthenticatedFlow(flow)
        return this.getStatus(serverName, await this.getCurrentConfig(serverName, completeConfig))
      }

      flow.flowPromise = callbackSession
        .waitForCallback()
        .then((callback) => this.finishAuthFlow(flow, callback.code, callback.iss))
        .catch((error) => this.failAuthFlow(flow, error))
      return this.getStatus(serverName, await this.getCurrentConfig(serverName, completeConfig))
    } catch (error) {
      this.failAuthFlow(flow, error)
      return this.getStatus(serverName, await this.getCurrentConfig(serverName, completeConfig))
    }
  }

  async completeAuthFromCallbackUrl(
    serverName: string,
    config: Partial<MCPServerConfig>,
    callbackUrl: string
  ): Promise<McpServerAuthStatus> {
    const binding = requireServerBinding(config)
    const flow = this.pendingFlows.get(binding.serverId)
    if (!flow) {
      const status = this.getStatus(serverName, config)
      if (status.authenticated) {
        return status
      }
      this.setStatus(
        this.buildStatus(serverName, binding, getAuthorizationMode(config), {
          state: 'error',
          authenticated: false,
          error: 'MCP OAuth authentication is not pending'
        })
      )
      return this.getStatus(serverName, config)
    }
    const callbackCredentialKey = createMcpCredentialKey('interactive_oauth', binding)
    if (
      callbackCredentialKey !== createMcpCredentialKey('interactive_oauth', flow.initialBinding) &&
      callbackCredentialKey !== createMcpCredentialKey('interactive_oauth', flow.binding)
    ) {
      this.failAuthFlow(flow, new Error('MCP OAuth server binding changed during authentication'))
      return this.getStatus(serverName, config)
    }

    const resolution = flow.callbackSession.resolveCallbackUrl(callbackUrl)
    if (resolution.kind === 'not-found') {
      this.failAuthFlow(flow, new Error('MCP OAuth callback URL is invalid'))
      return this.getStatus(serverName, config)
    }

    await flow.flowPromise
    return this.getStatus(serverName, config)
  }

  logout(serverName: string, config?: Partial<MCPServerConfig> | null): McpServerAuthStatus {
    if (!config) {
      return {
        serverName,
        state: 'unsupported',
        authenticated: false,
        storage: this.store.getStorageState(),
        persistent: this.store.isPersistent()
      }
    }
    const binding = requireServerBinding(config)
    this.cancelPendingFlow(binding.serverId)
    const interactive = this.findInteractiveCredential(serverName, config, binding)
    if (interactive) {
      this.store.clearEntry(interactive.key)
    }
    this.setStatus(
      this.buildStatus(serverName, binding, getAuthorizationMode(config), {
        state: 'none',
        authenticated: false
      })
    )
    return this.getStatus(serverName, config)
  }

  getCredentialStatuses(config: MCPServerConfig): McpCredentialStatus[] {
    const binding = requireServerBinding(config)
    return (['client_secret', 'private_key', 'enterprise_resource_secret'] as const).map((kind) =>
      this.getCredentialStatus(binding, kind)
    )
  }

  setCredential(
    binding: McpCredentialBinding,
    credential: McpCredentialInput
  ): McpCredentialStatus {
    if (credential.kind === 'client_secret') {
      if (!credential.secret || credential.secret.length > 8192) {
        throw new Error('MCP client secret is invalid')
      }
      this.store.saveClientSecret(
        createMcpCredentialKey('client_secret', binding),
        credential.secret,
        binding
      )
    } else if (credential.kind === 'enterprise_resource_secret') {
      if (!credential.secret || credential.secret.length > 8192) {
        throw new Error('MCP enterprise resource secret is invalid')
      }
      this.store.saveEnterpriseResourceSecret(
        createMcpCredentialKey('enterprise_resource_secret', binding),
        credential.secret,
        binding
      )
    } else {
      if (!credential.privateKey || credential.privateKey.length > 64 * 1024) {
        throw new Error('MCP private key is invalid')
      }
      const fingerprint = createFingerprint(credential.privateKey, credential.algorithm)
      this.store.savePrivateKey(createMcpCredentialKey('private_key', binding), {
        privateKey: credential.privateKey,
        algorithm: credential.algorithm,
        fingerprint,
        binding
      })
    }
    return this.getCredentialStatus(binding, credential.kind)
  }

  removeCredential(binding: McpCredentialBinding, kind: McpCredentialKind): McpCredentialStatus {
    this.store.clearEntry(createMcpCredentialKey(kind, binding))
    return this.getCredentialStatus(binding, kind)
  }

  clearServerCredentials(serverId: string): void {
    this.cancelPendingFlow(serverId)
    this.store.clearServerCredentials(serverId)
    this.statuses.delete(serverId)
  }

  listEnterpriseProfiles(): McpEnterpriseIdentityProfile[] {
    return this.requireEnterpriseIdentity().listProfiles()
  }

  saveEnterpriseProfile(profile: McpEnterpriseIdentityProfile): McpEnterpriseIdentityProfile {
    return this.requireEnterpriseIdentity().saveProfile(profile)
  }

  removeEnterpriseProfile(profileId: string): void {
    this.requireEnterpriseIdentity().removeProfile(profileId)
  }

  setEnterpriseProfileClientSecret(profileId: string, secret: string): McpEnterpriseIdentityStatus {
    return this.requireEnterpriseIdentity().setClientSecret(profileId, secret)
  }

  getEnterpriseProfileStatus(profileId: string): McpEnterpriseIdentityStatus {
    return this.requireEnterpriseIdentity().getStatus(profileId)
  }

  startEnterpriseProfileAuth(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    return this.requireEnterpriseIdentity().startAuth(profileId)
  }

  completeEnterpriseProfileAuthFromCallbackUrl(
    profileId: string,
    callbackUrl: string
  ): Promise<McpEnterpriseIdentityStatus> {
    return this.requireEnterpriseIdentity().completeAuthFromCallbackUrl(profileId, callbackUrl)
  }

  logoutEnterpriseProfile(profileId: string): McpEnterpriseIdentityStatus {
    return this.requireEnterpriseIdentity().logout(profileId)
  }

  getUsableAuthorizationExtensions(config: Partial<MCPServerConfig>): string[] {
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
      this.getSelectedCredentialStatus(binding, mode).configured
    ) {
      return [AUTH_EXTENSION_CLIENT_CREDENTIALS]
    }
    if (mode === 'cross_app_access' && this.getSelectedCredentialStatus(binding, mode).configured) {
      const profileId = config.authorization?.identityProfileId
      if (profileId) {
        try {
          if (this.enterpriseIdentity?.getStatus(profileId).authenticated) {
            return [AUTH_EXTENSION_ENTERPRISE]
          }
        } catch {
          return []
        }
      }
    }
    return []
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
      const servers = await this.settings.getMcpServers()
      const currentMatch = Object.entries(servers).find(
        ([, current]) => current.serverId === startingBinding.serverId
      )
      if (!currentMatch) {
        throw new Error('MCP server was removed during OAuth discovery')
      }
      const [currentServerName, currentConfig] = currentMatch
      const currentBinding = requireServerBinding(currentConfig)
      if (
        currentBinding.configGeneration !== startingBinding.configGeneration ||
        currentBinding.bindingHash !== startingBinding.bindingHash ||
        normalizeUrlIdentifier(currentBinding.endpoint) !==
          normalizeUrlIdentifier(startingBinding.endpoint)
      ) {
        throw new Error('MCP server binding changed during OAuth discovery')
      }

      const nextAuthorization = {
        ...(currentConfig.authorization || { mode: 'interactive' as const }),
        authorizationServerIssuer: issuer,
        protectedResourceUrl,
        clientId
      }
      const needsUpdate =
        currentConfig.authorization?.authorizationServerIssuer !== issuer ||
        currentConfig.authorization?.protectedResourceUrl !== protectedResourceUrl ||
        currentConfig.authorization?.clientId !== clientId
      if (needsUpdate) {
        await this.settings.updateMcpServer(currentServerName, {
          authorization: nextAuthorization
        })
        const updatedConfig = (await this.settings.getMcpServers())[currentServerName]
        if (!updatedConfig || updatedConfig.serverId !== startingBinding.serverId) {
          throw new Error('MCP server binding could not be finalized after OAuth discovery')
        }
        finalBinding = requireServerBinding(updatedConfig)
        this.onServerBindingChanged?.(startingBinding.serverId)
      } else {
        finalBinding = currentBinding
      }
    }

    provider.rebind({
      ...finalBinding,
      authorizationServerIssuer: issuer,
      protectedResourceUrl,
      clientId
    })
    return provider.getBinding()
  }

  private createInteractiveProvider(
    config: MCPServerConfig,
    binding: McpCredentialBinding,
    options: {
      redirectUrl?: string
      state?: string
      interactive: boolean
      initialCredentialKey?: string
    }
  ): DeepChatMcpOAuthProvider {
    return new DeepChatMcpOAuthProvider({
      store: this.store,
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

  private findInteractiveCredential(
    serverName: string,
    config: Partial<MCPServerConfig>,
    binding: McpCredentialBinding
  ) {
    const current = this.store.findInteractiveCredential(binding)
    if (current) {
      return current
    }

    const legacyKey = createHash('sha256')
      .update(`${serverName}\n${config.type || ''}\n${config.baseUrl || ''}`)
      .digest('hex')
    const legacy = this.store.load(legacyKey)
    if (!legacy) {
      return null
    }
    const issuer =
      legacy.discoveryState?.authorizationServerMetadata?.issuer ||
      legacy.discoveryState?.authorizationServerUrl
    if (
      !issuer ||
      (binding.authorizationServerIssuer && binding.authorizationServerIssuer !== issuer)
    ) {
      this.store.clearEntry(legacyKey)
      return null
    }
    const migratedBinding: McpCredentialBinding = {
      ...binding,
      authorizationServerIssuer: issuer,
      protectedResourceUrl:
        legacy.discoveryState?.resourceMetadata?.resource || binding.protectedResourceUrl
    }
    const nextKey = createMcpCredentialKey('interactive_oauth', migratedBinding)
    this.store.saveEntry(nextKey, {
      ...legacy,
      binding: migratedBinding
    })
    this.store.clearEntry(legacyKey)
    return { key: nextKey, entry: this.store.load(nextKey)! }
  }

  private async createMachineProvider(
    config: MCPServerConfig,
    binding: McpCredentialBinding,
    info: OAuthServerInfo
  ): Promise<OAuthClientProvider> {
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
      const credential = this.store.loadClientSecret(
        createMcpCredentialKey('client_secret', binding)
      )
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
      const credential = this.store.loadPrivateKey(createMcpCredentialKey('private_key', binding))
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
      const credential = this.store.loadEnterpriseResourceSecret(
        createMcpCredentialKey('enterprise_resource_secret', binding)
      )
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
  }

  private getCredentialStatus(
    binding: McpCredentialBinding,
    kind: McpCredentialKind
  ): McpCredentialStatus {
    const status = this.store.getCredentialRecordStatus(createMcpCredentialKey(kind, binding), kind)
    return {
      serverId: binding.serverId,
      kind,
      configured: status.configured,
      persistent: this.store.isPersistent(),
      updatedAt: status.updatedAt,
      fingerprint: status.fingerprint
    }
  }

  private getSelectedCredentialStatus(
    binding: McpCredentialBinding,
    mode: McpAuthorizationMode
  ): McpCredentialStatus {
    const kind: McpCredentialKind =
      mode === 'private_key_jwt'
        ? 'private_key'
        : mode === 'cross_app_access'
          ? 'enterprise_resource_secret'
          : 'client_secret'
    return this.getCredentialStatus(binding, kind)
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
      this.finishAuthenticatedFlow(flow)
    } catch (error) {
      this.failAuthFlow(flow, error)
    }
  }

  private finishAuthenticatedFlow(flow: PendingMcpOAuthFlow): void {
    if (this.pendingFlows.get(flow.serverId) !== flow) {
      return
    }
    this.pendingFlows.delete(flow.serverId)
    flow.callbackSession.close()
    const entry = this.store.findInteractiveCredential(flow.binding)
    const current = this.statuses.get(flow.serverId)
    this.setStatus({
      serverName: flow.serverName,
      serverId: flow.serverId,
      state: 'authenticated',
      authenticated: true,
      updatedAt: entry?.entry.updatedAt || Date.now(),
      storage: this.store.getStorageState(),
      persistent: this.store.isPersistent(),
      mode: 'interactive',
      ...(current?.credential ? { credential: current.credential } : {})
    })

    void Promise.resolve(this.onAuthenticated?.(flow.serverName)).catch((error) => {
      logger.warn(
        '[MCP OAuth] Failed to restart server after authentication:',
        sanitizeError(error)
      )
    })
  }

  private failAuthFlow(flow: PendingMcpOAuthFlow, error: unknown): void {
    if (this.pendingFlows.get(flow.serverId) !== flow) {
      return
    }
    this.pendingFlows.delete(flow.serverId)
    flow.callbackSession.close()
    this.setStatus({
      serverName: flow.serverName,
      serverId: flow.serverId,
      state: 'error',
      authenticated: false,
      error: sanitizeError(error),
      storage: this.store.getStorageState(),
      persistent: this.store.isPersistent(),
      mode: 'interactive'
    })
  }

  private cancelPendingFlow(serverId: string): void {
    const pending = this.pendingFlows.get(serverId)
    if (!pending) {
      return
    }
    pending.callbackSession.close()
    this.pendingFlows.delete(serverId)
  }

  private buildStatus(
    serverName: string,
    binding: McpCredentialBinding,
    mode: McpAuthorizationMode,
    state: Pick<McpServerAuthStatus, 'state' | 'authenticated'> &
      Partial<Pick<McpServerAuthStatus, 'error' | 'updatedAt' | 'credential'>>
  ): McpServerAuthStatus {
    return {
      serverName,
      serverId: binding.serverId,
      ...state,
      storage: this.store.getStorageState(),
      persistent: this.store.isPersistent(),
      mode
    }
  }

  private setStatus(status: McpServerAuthStatus): void {
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
    return `http://localhost:${MCP_OAUTH_REDIRECT_PORT}/mcp/oauth/callback`
  }
}

export { isRemoteOAuthCapable, resolveOAuthLoopbackCallbackUrl }
