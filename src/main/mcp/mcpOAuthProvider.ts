import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client'
import { validateClientMetadataUrl } from '@modelcontextprotocol/client'
import type { McpCredentialBinding } from '@shared/types/mcp'
import { normalizeMcpOAuthIssuer, type McpOAuthCredentialStore } from './oauthCredentialStore'

export type DeepChatMcpOAuthProviderOptions = {
  store: McpOAuthCredentialStore
  openExternal(url: string): Promise<void>
  assertActive(): void
  binding: McpCredentialBinding
  credentialKey(binding: McpCredentialBinding): string
  initialCredentialKey?: string
  redirectUrl: string
  state?: string
  interactive?: boolean
  clientMetadataUrl?: string
  scopes?: string[]
}

const discoveryIssuer = (state: OAuthDiscoveryState): string =>
  normalizeMcpOAuthIssuer(state.authorizationServerMetadata?.issuer || state.authorizationServerUrl)

const discoveryResource = (state: OAuthDiscoveryState, fallback?: string): string | undefined =>
  state.resourceMetadata?.resource || fallback

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

export class DeepChatMcpOAuthProvider implements OAuthClientProvider {
  readonly clientMetadataUrl?: string

  private readonly store: McpOAuthCredentialStore
  private readonly expectedState?: string
  private readonly interactive: boolean
  private activeBinding: McpCredentialBinding
  private activeCredentialKey: string
  private operations: Promise<void> = Promise.resolve()
  private pending = 0
  private pendingNormal = 0
  private callbackValidation: { issuer?: string; issParameterSupported: boolean } = {
    issParameterSupported: false
  }

  constructor(private readonly options: DeepChatMcpOAuthProviderOptions) {
    this.store = options.store
    this.activeBinding = options.binding
    this.activeCredentialKey =
      options.initialCredentialKey || options.credentialKey(options.binding)
    this.expectedState = options.state
    this.interactive = Boolean(options.interactive)
    validateClientMetadataUrl(options.clientMetadataUrl)
    this.clientMetadataUrl = options.clientMetadataUrl
  }

  get redirectUrl(): string {
    return this.options.redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'DeepChat',
      redirect_uris: [this.options.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      scope: this.options.scopes?.join(' ') || undefined
    }
  }

  state(): string {
    return this.expectedState || ''
  }

  clientInformation(
    context?: OAuthClientInformationContext
  ): Promise<StoredOAuthClientInformation | undefined> {
    return this.perform(async () => (await this.loadForContext(context))?.clientInformation)
  }

  saveClientInformation(
    clientInformation: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext
  ): Promise<void> {
    return this.perform(async () => {
      await this.activateContext(context)
      await this.moveActiveEntry({ ...this.activeBinding, clientId: clientInformation.client_id })
      this.options.assertActive()
      await this.store.saveEntry(this.activeCredentialKey, {
        clientInformation,
        binding: this.activeBinding
      })
    })
  }

  tokens(context?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    return this.perform(async () => (await this.loadForContext(context))?.tokens)
  }

  saveTokens(tokens: StoredOAuthTokens, context?: OAuthClientInformationContext): Promise<void> {
    return this.perform(async () => {
      await this.activateContext(context)
      this.options.assertActive()
      await this.store.saveEntry(this.activeCredentialKey, { tokens, binding: this.activeBinding })
    })
  }

  redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    return this.perform(async () => {
      if (!this.interactive) throw new Error('MCP OAuth authentication is required')
      if (
        authorizationUrl.protocol !== 'https:' &&
        !(authorizationUrl.protocol === 'http:' && isLoopbackHost(authorizationUrl.hostname))
      )
        throw new Error('MCP OAuth authorization URL must use HTTPS or loopback HTTP')
      await this.options.openExternal(authorizationUrl.toString())
    })
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    return this.perform(async () => {
      this.options.assertActive()
      await this.store.saveEntry(this.activeCredentialKey, {
        codeVerifier,
        binding: this.activeBinding
      })
    })
  }

  codeVerifier(): Promise<string> {
    return this.perform(async () => {
      const verifier = (await this.store.load(this.activeCredentialKey))?.codeVerifier
      if (!verifier) throw new Error('MCP OAuth code verifier is unavailable')
      return verifier
    })
  }

  invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): Promise<void> {
    return this.perform(async () => {
      await this.store.clearEntryScope(this.activeCredentialKey, scope)
    }, true)
  }

  saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    return this.perform(async () => {
      await this.moveActiveEntry({
        ...this.activeBinding,
        authorizationServerIssuer: discoveryIssuer(state),
        protectedResourceUrl: discoveryResource(state, this.activeBinding.protectedResourceUrl)
      })
      this.options.assertActive()
      await this.store.saveEntry(this.activeCredentialKey, {
        discoveryState: state,
        binding: this.activeBinding
      })
      this.options.assertActive()
      this.rememberCallbackValidation(state)
    })
  }

  discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.perform(async () => {
      const state = (await this.store.load(this.activeCredentialKey))?.discoveryState
      this.options.assertActive()
      this.rememberCallbackValidation(state)
      return state
    })
  }

  getCallbackValidation(): { issuer?: string; issParameterSupported: boolean } {
    this.options.assertActive()
    return { ...this.callbackValidation }
  }

  private rememberCallbackValidation(state?: OAuthDiscoveryState): void {
    this.callbackValidation = {
      issuer: state?.authorizationServerMetadata?.issuer || state?.authorizationServerUrl,
      issParameterSupported:
        state?.authorizationServerMetadata?.authorization_response_iss_parameter_supported === true
    }
  }

  getBinding(): McpCredentialBinding {
    this.options.assertActive()
    return { ...this.activeBinding }
  }

  rebind(binding: McpCredentialBinding): Promise<void> {
    return this.perform(() => this.moveActiveEntry(binding))
  }

  private async perform<T>(operation: () => Promise<T>, control = false): Promise<T> {
    this.options.assertActive()
    if (this.pending >= 32 || (!control && this.pendingNormal >= 24))
      return Promise.reject(new Error('MCP OAuth provider operation queue is full'))
    this.pending++
    if (!control) this.pendingNormal++
    const result = this.operations.then(async () => {
      this.options.assertActive()
      const value = await operation()
      this.options.assertActive()
      return value
    })
    this.operations = result.then(
      () => undefined,
      () => undefined
    )
    return result.finally(() => {
      this.pending--
      if (!control) this.pendingNormal--
      this.options.assertActive()
    })
  }

  private async loadForContext(context?: OAuthClientInformationContext) {
    if (!context)
      return this.store.load(this.activeCredentialKey).then((value) => value || undefined)
    const contextIssuer = normalizeMcpOAuthIssuer(context.issuer)
    const binding = { ...this.activeBinding, authorizationServerIssuer: contextIssuer }
    const key = this.options.credentialKey(binding)
    const contextual = await this.store.load(key)
    this.options.assertActive()
    if (contextual) {
      this.activeBinding = binding
      this.activeCredentialKey = key
      return contextual
    }
    const active = await this.store.load(this.activeCredentialKey)
    this.options.assertActive()
    const issuer =
      active?.binding?.authorizationServerIssuer ||
      active?.discoveryState?.authorizationServerMetadata?.issuer ||
      active?.discoveryState?.authorizationServerUrl ||
      active?.tokens?.issuer ||
      active?.clientInformation?.issuer
    if (active && issuer && normalizeMcpOAuthIssuer(issuer) === contextIssuer) {
      await this.moveActiveEntry(binding)
      return (await this.store.load(this.activeCredentialKey)) || undefined
    }
    return undefined
  }

  private async activateContext(context?: OAuthClientInformationContext): Promise<void> {
    this.options.assertActive()
    if (!context) return
    const issuer = normalizeMcpOAuthIssuer(context.issuer)
    if (this.activeBinding.authorizationServerIssuer !== issuer)
      await this.moveActiveEntry({ ...this.activeBinding, authorizationServerIssuer: issuer })
  }

  private async moveActiveEntry(binding: McpCredentialBinding): Promise<void> {
    this.options.assertActive()
    const key = this.options.credentialKey(binding)
    if (key !== this.activeCredentialKey)
      await this.store.moveInteractiveEntry(this.activeCredentialKey, key, binding)
    this.options.assertActive()
    this.activeBinding = binding
    this.activeCredentialKey = key
  }
}
