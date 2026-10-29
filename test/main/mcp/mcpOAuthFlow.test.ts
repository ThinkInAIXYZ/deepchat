import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage, shell } from 'electron'
import {
  auth,
  type OAuthClientMetadata,
  type OAuthDiscoveryState
} from '@modelcontextprotocol/client'
import type { MCPServerConfig } from '@shared/types/mcp'
import { McpOAuthManager } from '@/mcp/mcpOAuthManager'
import { DeepChatMcpOAuthProvider } from '@/mcp/mcpOAuthProvider'
import { McpOAuthCredentialStore } from '@/mcp/oauthCredentialStore'
import { MCP_OAUTH_REDIRECT_PATH, MCP_OAUTH_REDIRECT_PORT } from '@/mcp/oauthConstants'
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
  let reservedServers: Server[]
  beforeEach(() => {
    registrations = []
    tokenRequests = []
    reservedServers = []
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
  })
  afterEach(async () => {
    await manager?.logout('example', config)
    await Promise.all(
      reservedServers
        .filter((server) => server.listening)
        .map((server) => promisify(server.close.bind(server))())
    )
    vi.unstubAllGlobals()
  })
  async function registeredCallbackUri(occupied = false): Promise<string> {
    const server = createServer().listen(0, '127.0.0.1')
    reservedServers.push(server)
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo
    if (!occupied) {
      await promisify(server.close.bind(server))()
    }
    return `http://localhost:${port}/mcp/oauth/callback/legacy-random-path`
  }
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
    store = new McpOAuthCredentialStore({
      filePath: '/tmp/deepchat-oauth-flow/credentials.json',
      crypto: {
        isAvailable: async () => false,
        encrypt: async () => {
          throw new Error('Unexpected native encryption')
        },
        decrypt: async () => {
          throw new Error('Unexpected native decryption')
        }
      }
    })
    manager = new McpOAuthManager(store, shell.openExternal, vi.fn())
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
  async function seedClient(redirectUris?: string[], clientId = 'legacy-client'): Promise<void> {
    await store.saveEntry('legacy-credential', {
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
  it.each(['bound', 'legacy'])(
    'preserves a %s registration with a raw stored issuer and normalized config',
    async (storage) => {
      setup('https://auth.example')
      const registeredUri = await registeredCallbackUri()
      await seedClient([registeredUri])
      await store.clearEntryScope('legacy-credential', 'tokens')
      config.authorization!.authorizationServerIssuer = 'https://auth.example/'
      if (storage === 'legacy') {
        const key = createHash('sha256').update(`example\nhttp\n${endpoint}`).digest('hex')
        await store.saveEntry(key, {
          ...(await store.load('legacy-credential')),
          binding: undefined
        })
        await store.clearEntry('legacy-credential')
      }
      expect((await manager.startAuth('example', config)).state).toBe('authenticating')
      const authorization = latestAuthorization()
      expect(new URL(authorization.searchParams.get('redirect_uri')!).pathname).toBe(
        new URL(registeredUri).pathname
      )
      expect(authorization.searchParams.get('client_id')).toBe('legacy-client')
      expect((await completeAuthorization()).state).toBe('authenticated')
      expect(registrations).toHaveLength(0)
      const stored = (
        await store.findInteractiveCredential({
          ...identity,
          endpoint,
          authorizationServerIssuer: 'https://auth.example/'
        })
      )?.entry
      expect(stored?.binding?.authorizationServerIssuer).toBe('https://auth.example/')
      expect(stored?.discoveryState?.authorizationServerMetadata?.issuer).toBe(
        'https://auth.example'
      )
      expect(stored?.clientInformation?.issuer).toBe('https://auth.example')
    }
  )
  it.each([false, true])(
    'handles a registered callback port with occupied=%s',
    async (occupied) => {
      setup('https://auth.example')
      const registeredUri = await registeredCallbackUri(occupied)
      await seedClient([registeredUri])
      await store.clearEntryScope('legacy-credential', 'tokens')
      expect((await manager.startAuth('example', config)).state).toBe('authenticating')
      const authorization = latestAuthorization()
      const redirect = new URL(authorization.searchParams.get('redirect_uri')!)
      expect(registrations).toHaveLength(occupied ? 1 : 0)
      expect(authorization.searchParams.get('client_id')).toBe(
        occupied ? 'client-1' : 'legacy-client'
      )
      if (occupied) {
        expect(redirect.port).not.toBe(new URL(registeredUri).port)
        expect(registrations[0].redirect_uris[0]).toBe(redirect.href)
      } else {
        expect(redirect.href).toBe(registeredUri)
      }
      expect((await completeAuthorization()).state).toBe('authenticated')
    }
  )
  it.each(['tokens', 'clientInformation'])(
    'ignores a malformed stored issuer in %s',
    async (scope) => {
      setup('https://auth.example')
      await store.saveEntry(
        'malformed-credential',
        scope === 'tokens'
          ? { tokens: { access_token: 'stale-token', token_type: 'Bearer', issuer: 'not-a-url' } }
          : { clientInformation: { client_id: 'stale-client', issuer: 'not-a-url' } }
      )
      const provider = new DeepChatMcpOAuthProvider({
        openExternal: shell.openExternal,
        assertActive: () => undefined,
        store,
        binding: { ...identity, endpoint },
        initialCredentialKey: 'malformed-credential',
        credentialKey: (binding) => JSON.stringify(binding),
        redirectUrl: 'http://localhost:1456/mcp/oauth/callback'
      })
      expect(await provider.clientInformation({ issuer: 'https://auth.example' })).toBeUndefined()
      expect(await provider.tokens({ issuer: 'https://auth.example' })).toBeUndefined()
    }
  )
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
      await seedClient(redirectUris)
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
  it('keeps an existing dynamic registration when a client metadata URL is configured', async () => {
    setup('https://auth.example', 'https://client.example/deepchat.json')
    const registeredUri = await registeredCallbackUri()
    await seedClient([registeredUri])
    await store.clearEntryScope('legacy-credential', 'tokens')
    expect((await manager.startAuth('example', config)).state).toBe('authenticating')
    expect(latestAuthorization().searchParams.get('client_id')).toBe('legacy-client')
    expect(latestAuthorization().searchParams.get('redirect_uri')).toBe(registeredUri)
    expect((await completeAuthorization()).state).toBe('authenticated')
    expect(registrations).toHaveLength(0)
  })
  it.each([false, true])(
    'uses a published callback for a URL-based client with existing=%s',
    async (existing) => {
      const clientMetadataUrl = 'https://client.example/deepchat.json'
      const publishedMetadata = {
        client_id: clientMetadataUrl,
        redirect_uris: [`http://localhost:${MCP_OAUTH_REDIRECT_PORT}${MCP_OAUTH_REDIRECT_PATH}`]
      }
      setup('https://auth.example', clientMetadataUrl)
      if (existing) {
        await seedClient(undefined, clientMetadataUrl)
        await store.clearEntryScope('legacy-credential', 'tokens')
      }
      vi.mocked(shell.openExternal).mockImplementation(async (url) => {
        const authorization = new URL(url)
        expect(authorization.searchParams.get('client_id')).toBe(publishedMetadata.client_id)
        const redirect = new URL(authorization.searchParams.get('redirect_uri')!)
        // Native loopback redirects allow the listening port to vary.
        redirect.port = new URL(publishedMetadata.redirect_uris[0]).port
        expect(publishedMetadata.redirect_uris).toContain(redirect.href)
      })
      expect((await manager.startAuth('example', config)).state).toBe('authenticating')
      expect((await completeAuthorization()).state).toBe('authenticated')
      expect(tokenRequests[0].get('redirect_uri')).toBe(
        latestAuthorization().searchParams.get('redirect_uri')
      )
      expect(registrations).toHaveLength(0)
    }
  )

  it('rejects a delayed browser acknowledgement after logout without restoring credentials', async () => {
    setup('https://auth.example')
    let acknowledge!: () => void
    let opened!: () => void
    const opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    vi.mocked(shell.openExternal).mockImplementationOnce(() => {
      opened()
      return new Promise<void>((resolve) => {
        acknowledge = resolve
      })
    })
    const pending = manager.startAuth('example', config)
    const rejected = expect(pending).rejects.toThrow('interrupted')
    await opening
    expect((await manager.logout('example', config)).authenticated).toBe(false)
    acknowledge()
    await rejected
    expect((await manager.getStatus('example', config)).authenticated).toBe(false)
    expect(tokenRequests).toHaveLength(0)
  })
})
