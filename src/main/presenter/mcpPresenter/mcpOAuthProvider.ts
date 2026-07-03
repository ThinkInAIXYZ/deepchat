import { shell } from 'electron'
import type {
  OAuthClientProvider,
  OAuthDiscoveryState
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { McpOAuthCredentialStore } from './oauthCredentialStore'

export type DeepChatMcpOAuthProviderOptions = {
  store: McpOAuthCredentialStore
  credentialKey: string
  redirectUrl: string
  state?: string
  interactive?: boolean
}

export class DeepChatMcpOAuthProvider implements OAuthClientProvider {
  private readonly store: McpOAuthCredentialStore
  private readonly credentialKey: string
  private readonly expectedState?: string
  private readonly interactive: boolean

  constructor(private readonly options: DeepChatMcpOAuthProviderOptions) {
    this.store = options.store
    this.credentialKey = options.credentialKey
    this.expectedState = options.state
    this.interactive = Boolean(options.interactive)
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
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    return this.expectedState || ''
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.store.load(this.credentialKey)?.clientInformation
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.store.saveEntry(this.credentialKey, { clientInformation })
  }

  tokens(): OAuthTokens | undefined {
    return this.store.load(this.credentialKey)?.tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this.store.saveEntry(this.credentialKey, { tokens })
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactive) {
      throw new Error('MCP OAuth authentication is required')
    }
    if (authorizationUrl.protocol !== 'http:' && authorizationUrl.protocol !== 'https:') {
      throw new Error('MCP OAuth authorization URL must use http or https')
    }

    await shell.openExternal(authorizationUrl.toString())
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.store.saveEntry(this.credentialKey, { codeVerifier })
  }

  codeVerifier(): string {
    const codeVerifier = this.store.load(this.credentialKey)?.codeVerifier
    if (!codeVerifier) {
      throw new Error('MCP OAuth code verifier is unavailable')
    }
    return codeVerifier
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    this.store.clearEntryScope(this.credentialKey, scope)
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.store.saveEntry(this.credentialKey, { discoveryState: state })
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.store.load(this.credentialKey)?.discoveryState
  }
}
