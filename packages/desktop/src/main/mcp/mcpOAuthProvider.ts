import { shell } from 'electron'
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
import type { McpOAuthCredentialStore } from './oauthCredentialStore'

export type DeepChatMcpOAuthProviderOptions = {
  store: McpOAuthCredentialStore
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
  state.authorizationServerMetadata?.issuer || state.authorizationServerUrl

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
  ): StoredOAuthClientInformation | undefined {
    return this.loadForContext(context)?.clientInformation
  }

  saveClientInformation(
    clientInformation: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext
  ): void {
    this.activateContext(context)
    this.moveActiveEntry({
      ...this.activeBinding,
      clientId: clientInformation.client_id
    })
    this.store.saveEntry(this.activeCredentialKey, {
      clientInformation,
      binding: this.activeBinding
    })
  }

  tokens(context?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
    return this.loadForContext(context)?.tokens
  }

  saveTokens(tokens: StoredOAuthTokens, context?: OAuthClientInformationContext): void {
    this.activateContext(context)
    this.store.saveEntry(this.activeCredentialKey, {
      tokens,
      binding: this.activeBinding
    })
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactive) {
      throw new Error('MCP OAuth authentication is required')
    }
    if (
      authorizationUrl.protocol !== 'https:' &&
      !(authorizationUrl.protocol === 'http:' && isLoopbackHost(authorizationUrl.hostname))
    ) {
      throw new Error('MCP OAuth authorization URL must use HTTPS or loopback HTTP')
    }

    await shell.openExternal(authorizationUrl.toString())
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.store.saveEntry(this.activeCredentialKey, {
      codeVerifier,
      binding: this.activeBinding
    })
  }

  codeVerifier(): string {
    const codeVerifier = this.store.load(this.activeCredentialKey)?.codeVerifier
    if (!codeVerifier) {
      throw new Error('MCP OAuth code verifier is unavailable')
    }
    return codeVerifier
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    this.store.clearEntryScope(this.activeCredentialKey, scope)
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    const nextBinding: McpCredentialBinding = {
      ...this.activeBinding,
      authorizationServerIssuer: discoveryIssuer(state),
      protectedResourceUrl: discoveryResource(state, this.activeBinding.protectedResourceUrl)
    }
    this.moveActiveEntry(nextBinding)
    this.store.saveEntry(this.activeCredentialKey, {
      discoveryState: state,
      binding: this.activeBinding
    })
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.store.load(this.activeCredentialKey)?.discoveryState
  }

  getBinding(): McpCredentialBinding {
    return { ...this.activeBinding }
  }

  rebind(binding: McpCredentialBinding): void {
    this.moveActiveEntry(binding)
  }

  private loadForContext(context?: OAuthClientInformationContext) {
    if (!context) {
      return this.store.load(this.activeCredentialKey) || undefined
    }

    const contextualBinding = {
      ...this.activeBinding,
      authorizationServerIssuer: context.issuer
    }
    const contextualKey = this.options.credentialKey(contextualBinding)
    const contextual = this.store.load(contextualKey)
    if (contextual) {
      this.activeBinding = contextualBinding
      this.activeCredentialKey = contextualKey
      return contextual
    }

    const active = this.store.load(this.activeCredentialKey)
    const storedIssuer =
      active?.binding?.authorizationServerIssuer ||
      active?.discoveryState?.authorizationServerMetadata?.issuer ||
      active?.discoveryState?.authorizationServerUrl ||
      active?.tokens?.issuer ||
      active?.clientInformation?.issuer
    if (active && storedIssuer === context.issuer) {
      this.moveActiveEntry(contextualBinding)
      return this.store.load(this.activeCredentialKey) || undefined
    }

    return undefined
  }

  private activateContext(context?: OAuthClientInformationContext): void {
    if (!context || this.activeBinding.authorizationServerIssuer === context.issuer) {
      return
    }
    this.moveActiveEntry({
      ...this.activeBinding,
      authorizationServerIssuer: context.issuer
    })
  }

  private moveActiveEntry(nextBinding: McpCredentialBinding): void {
    const nextKey = this.options.credentialKey(nextBinding)
    if (nextKey === this.activeCredentialKey) {
      this.activeBinding = nextBinding
      return
    }

    const current = this.store.load(this.activeCredentialKey)
    if (current) {
      this.store.saveEntry(nextKey, {
        ...current,
        binding: nextBinding
      })
      this.store.clearEntry(this.activeCredentialKey)
    }
    this.activeBinding = nextBinding
    this.activeCredentialKey = nextKey
  }
}
