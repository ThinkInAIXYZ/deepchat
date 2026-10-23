import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage, shell } from 'electron'
import {
  auth,
  type OAuthClientMetadata,
  type OAuthDiscoveryState
} from '@modelcontextprotocol/client'
import type { MCPServerConfig } from '@shared/types/mcp'
import { McpOAuthManager } from '@/mcp/mcpOAuthManager'
import { McpOAuthCredentialStore } from '@/mcp/oauthCredentialStore'
import { MCP_OAUTH_REDIRECT_PATH } from '@/mcp/oauthConstants'

const endpoint = 'https://mcp.example/mcp'
const identity = {
  serverId: '11111111-1111-4111-8111-111111111111',
  configGeneration: 1,
  bindingHash: 'a'.repeat(64)
}

describe('MCP interactive OAuth', () => {
  let manager: McpOAuthManager
  let store: McpOAuthCredentialStore
  let config: Partial<MCPServerConfig>
  let discovery: OAuthDiscoveryState
  let registrations: OAuthClientMetadata[]
  let tokenRequests: URLSearchParams[]

  beforeEach(() => {
    registrations = []
    tokenRequests = []
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
  })

  afterEach(() => {
    manager?.logout('example', config)
    vi.unstubAllGlobals()
  })

  function setup(issuer: string, clientMetadataUrl?: string): void {
    config = {
      ...identity,
      type: 'http',
      baseUrl: endpoint,
      authorization: { mode: 'interactive', clientMetadataUrl }
    }
    discovery = {
      authorizationServerUrl: new URL(issuer).toString(),
      resourceMetadata: { resource: endpoint, authorization_servers: [issuer] },
      authorizationServerMetadata: {
        issuer,
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        registration_endpoint: 'https://auth.example/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true
      }
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname.includes('oauth-protected-resource')) {
          return Response.json(discovery.resourceMetadata)
        }
        if (url.pathname.includes('oauth-authorization-server')) {
          return Response.json(discovery.authorizationServerMetadata)
        }
        if (url.pathname === '/register') {
          const metadata = JSON.parse(String(init?.body)) as OAuthClientMetadata
          registrations.push(metadata)
          return Response.json(
            { ...metadata, client_id: `client-${registrations.length}` },
            { status: 201 }
          )
        }
        if (url.pathname === '/token') {
          tokenRequests.push(new URLSearchParams(String(init?.body)))
          return Response.json({
            access_token: `access-${tokenRequests.length}`,
            refresh_token: `refresh-${tokenRequests.length}`,
            token_type: 'Bearer'
          })
        }
        throw new Error(`Unexpected OAuth request: ${url}`)
      })
    )
    store = new McpOAuthCredentialStore('/tmp/deepchat-oauth-flow/credentials.json')
    manager = new McpOAuthManager(store, vi.fn())
  }

  function latestAuthorization(): URL {
    const calls = vi.mocked(shell.openExternal).mock.calls
    return new URL(calls[calls.length - 1][0])
  }

  function completeAuthorization(
    parameters: Record<string, string> = { code: 'authorization-code' }
  ) {
    const authorization = latestAuthorization()
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorization.searchParams.get('state')!)
    callback.searchParams.set('iss', discovery.authorizationServerMetadata!.issuer)
    for (const [key, value] of Object.entries(parameters)) {
      callback.searchParams.set(key, value)
    }
    return manager.completeAuthFromCallbackUrl('example', config, callback.toString())
  }

  function seedClient(redirectUris?: string[], clientId = 'legacy-client'): void {
    store.saveEntry('legacy-credential', {
      binding: {
        ...identity,
        endpoint,
        authorizationServerIssuer: discovery.authorizationServerMetadata!.issuer,
        protectedResourceUrl: endpoint,
        clientId
      },
      discoveryState: discovery,
      clientInformation: {
        client_id: clientId,
        issuer: discovery.authorizationServerMetadata!.issuer,
        ...(redirectUris === undefined ? {} : { redirect_uris: redirectUris })
      },
      tokens: {
        access_token: 'legacy-access',
        refresh_token: 'legacy-refresh',
        token_type: 'Bearer',
        issuer: discovery.authorizationServerMetadata!.issuer
      }
    })
  }

  it.each(['https://auth.example', 'https://auth.example/'])(
    'exchanges and refreshes tokens for issuer %s',
    async (issuer) => {
      setup(issuer)
      expect((await manager.startAuth('example', config)).state).toBe('authenticating')
      const authorization = latestAuthorization()
      expect((await completeAuthorization()).state).toBe('authenticated')

      const verifier = tokenRequests[0].get('code_verifier')!
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
        authorization.searchParams.get('code_challenge')
      )
      expect(tokenRequests[0].get('redirect_uri')).toBe(
        authorization.searchParams.get('redirect_uri')
      )
      const provider = await manager.createRuntimeProvider('example', config)
      expect(provider).toBeDefined()
      expect(await auth(provider!, { serverUrl: endpoint })).toBe('AUTHORIZED')
      expect(tokenRequests[1].get('grant_type')).toBe('refresh_token')
      expect(tokenRequests[1].get('refresh_token')).toBe('refresh-1')
      expect(registrations).toHaveLength(1)
      expect(await provider!.tokens({ issuer })).toMatchObject({
        access_token: 'access-2',
        issuer
      })
      expect(await provider!.clientInformation({ issuer: 'https://other.example' })).toBeUndefined()
      expect(await provider!.tokens({ issuer: 'https://other.example' })).toBeUndefined()
      expect(
        await provider!.tokens({ issuer: `${issuer.replace(/\/$/, '')}/other` })
      ).toBeUndefined()
    }
  )

  it('reuses the registered callback after denial with fresh state and PKCE', async () => {
    setup('https://auth.example')
    await manager.startAuth('example', config)
    const first = latestAuthorization()
    expect((await completeAuthorization({ error: 'access_denied' })).state).toBe('error')

    expect((await manager.startAuth('example', config)).state).toBe('authenticating')
    const second = latestAuthorization()
    expect(new URL(second.searchParams.get('redirect_uri')!).pathname).toBe(
      new URL(registrations[0].redirect_uris[0]).pathname
    )
    expect(second.searchParams.get('client_id')).toBe(first.searchParams.get('client_id'))
    expect(second.searchParams.get('state')).not.toBe(first.searchParams.get('state'))
    expect(second.searchParams.get('code_challenge')).not.toBe(
      first.searchParams.get('code_challenge')
    )
    expect((await completeAuthorization()).state).toBe('authenticated')
    expect(registrations).toHaveLength(1)
  })

  it('preserves a legacy registration with a random callback path and raw issuer', async () => {
    setup('https://auth.example')
    const registeredUri = 'http://localhost:1456/mcp/oauth/callback/legacy-random-path'
    seedClient([registeredUri])
    store.clearEntryScope('legacy-credential', 'tokens')

    expect((await manager.startAuth('example', config)).state).toBe('authenticating')
    const authorization = latestAuthorization()
    expect(new URL(authorization.searchParams.get('redirect_uri')!).pathname).toBe(
      new URL(registeredUri).pathname
    )
    expect(authorization.searchParams.get('client_id')).toBe('legacy-client')
    expect((await completeAuthorization()).state).toBe('authenticated')
    expect(registrations).toHaveLength(0)
  })

  it.each([
    { redirectUris: undefined },
    { redirectUris: [] },
    { redirectUris: ['not-a-url'] },
    { redirectUris: ['https://remote.example/mcp/oauth/callback/old'] },
    { redirectUris: ['http://localhost:1456/unrelated'] },
    { redirectUris: ['http://user:password@localhost:1456/mcp/oauth/callback/old'] },
    { redirectUris: ['http://localhost:1456/mcp/oauth/callback/old?extra=1'] },
    { redirectUris: ['http://localhost:1456/mcp/oauth/callback/old#fragment'] }
  ])(
    're-registers a client without a usable local callback: $redirectUris',
    async ({ redirectUris }) => {
      setup('https://auth.example')
      seedClient(redirectUris)

      expect((await manager.startAuth('example', config)).state).toBe('authenticating')
      expect(registrations).toHaveLength(1)
      expect(tokenRequests).toHaveLength(0)
      const authorization = latestAuthorization()
      expect(authorization.searchParams.get('client_id')).toBe('client-1')
      expect(new URL(authorization.searchParams.get('redirect_uri')!).pathname).toBe(
        `${MCP_OAUTH_REDIRECT_PATH}/${identity.serverId}`
      )
      expect((await completeAuthorization()).state).toBe('authenticated')
    }
  )

  it('preserves a URL-based client without dynamic registration metadata', async () => {
    const clientMetadataUrl = 'https://client.example/deepchat.json'
    setup('https://auth.example', clientMetadataUrl)
    seedClient(undefined, clientMetadataUrl)
    store.clearEntryScope('legacy-credential', 'tokens')

    expect((await manager.startAuth('example', config)).state).toBe('authenticating')
    expect(latestAuthorization().searchParams.get('client_id')).toBe(clientMetadataUrl)
    expect((await completeAuthorization()).state).toBe('authenticated')
    expect(registrations).toHaveLength(0)
  })
})
