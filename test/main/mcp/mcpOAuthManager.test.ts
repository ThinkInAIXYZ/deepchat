import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const discoverOAuthServerInfoMock = vi.hoisted(() => vi.fn())
const authMock = vi.hoisted(() => vi.fn())
const clientCredentialsProviderMock = vi.hoisted(() => vi.fn())
const privateKeyJwtProviderMock = vi.hoisted(() => vi.fn())
vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@modelcontextprotocol/client')>()),
  auth: authMock,
  discoverOAuthServerInfo: discoverOAuthServerInfoMock,
  ClientCredentialsProvider: class {
    constructor(options: unknown) {
      clientCredentialsProviderMock(options, this)
    }
  },
  PrivateKeyJwtProvider: class {
    constructor(options: unknown) {
      privateKeyJwtProviderMock(options, this)
    }
  }
}))
import type { OAuthDiscoveryState } from '@modelcontextprotocol/client'
import { McpOAuthManager } from '@/mcp/mcpOAuthManager'
import { McpEnterpriseIdentityManager } from '@/mcp/enterpriseIdentityManager'
import type { McpOAuthCredentialEntry, McpOAuthCredentialStore } from '@/mcp/oauthCredentialStore'
import type { McpSettings } from '@/mcp/settings'
const createStore = (entry: unknown): McpOAuthCredentialStore =>
  ({
    getStorageState: vi.fn(async () => 'safeStorage'),
    isPersistent: vi.fn(async () => true),
    load: vi.fn(async () => entry),
    findInteractiveCredential: vi.fn(async () => null),
    saveEntry: vi.fn(async () => undefined),
    moveInteractiveEntry: vi.fn(async (_from: string, key: string) =>
      entry ? { key, entry: entry as McpOAuthCredentialEntry } : null
    ),
    stop: vi.fn(),
    clearEntry: vi.fn(async () => undefined),
    clearEntryScope: vi.fn(async () => undefined),
    clearServerCredentials: vi.fn(async () => undefined),
    loadClientSecret: vi.fn(async () => null),
    loadPrivateKey: vi.fn(async () => null),
    loadEnterpriseResourceSecret: vi.fn(async () => null),
    getCredentialRecordStatus: vi.fn(async () => ({ configured: false }))
  }) as unknown as McpOAuthCredentialStore
const serverIdentity = {
  serverId: '11111111-1111-4111-8111-111111111111',
  configGeneration: 1,
  bindingHash: 'a'.repeat(64)
}
describe('McpOAuthManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it('keeps authenticated credentials ahead of stale non-pending errors', async () => {
    const manager = new McpOAuthManager(
      createStore({
        tokens: {
          access_token: 'access-token',
          token_type: 'Bearer'
        },
        discoveryState: {
          authorizationServerUrl: 'https://auth.example'
        },
        updatedAt: 123
      }),
      vi.fn(async () => undefined),
      publishDeepchatEventMock
    )
    const config = {
      type: 'http' as const,
      baseUrl: 'https://mcp.linear.app/mcp',
      ...serverIdentity
    }
    await manager.handleConnectionError('linear', config, new Error('401 unauthorized'))
    const status = await manager.completeAuthFromCallbackUrl(
      'linear',
      config,
      'http://localhost:3333/callback?code=used&state=used'
    )
    expect(status.state).toBe('authenticated')
    expect(status.authenticated).toBe(true)
    expect(status.error).toBeUndefined()
    expect(publishDeepchatEventMock).toHaveBeenCalledTimes(1)
  })
  it('accepts callback input bound to the pre-discovery OAuth configuration', async () => {
    const manager = new McpOAuthManager(
      createStore(null),
      vi.fn(async () => undefined),
      publishDeepchatEventMock
    )
    const initialBinding = {
      ...serverIdentity,
      endpoint: 'https://mcp.example/mcp'
    }
    const resolveCallbackUrl = vi.fn(() => ({
      kind: 'success' as const,
      code: 'code',
      state: 'state',
      url: 'http://localhost/callback?code=code&state=state'
    }))
    const failAuthFlow = vi.spyOn(
      manager as unknown as {
        failAuthFlow: (...args: unknown[]) => void
      },
      'failAuthFlow'
    )
    const internals = manager as unknown as {
      pendingFlows: Map<string, unknown>
    }
    internals.pendingFlows.set(serverIdentity.serverId, {
      serverId: serverIdentity.serverId,
      serverName: 'example',
      serverUrl: initialBinding.endpoint,
      initialBinding,
      binding: {
        ...initialBinding,
        configGeneration: 2,
        bindingHash: 'b'.repeat(64),
        authorizationServerIssuer: 'https://auth.example/',
        protectedResourceUrl: initialBinding.endpoint,
        clientId: 'dynamic-client'
      },
      provider: {},
      callbackSession: {
        resolveCallbackUrl,
        close: vi.fn()
      },
      flowPromise: Promise.resolve()
    })
    await manager.completeAuthFromCallbackUrl(
      'example',
      {
        type: 'http' as const,
        baseUrl: initialBinding.endpoint,
        authorization: { mode: 'interactive' },
        ...serverIdentity
      },
      'http://localhost/callback?code=code&state=state'
    )
    expect(resolveCallbackUrl).toHaveBeenCalledOnce()
    expect(failAuthFlow).not.toHaveBeenCalled()
  })
  it('classifies HTTP status shaped OAuth failures', async () => {
    const config = {
      type: 'http' as const,
      baseUrl: 'https://mcp.linear.app/mcp',
      ...serverIdentity
    } as const
    const errors = [{ status: 401 }, { httpStatus: 401 }, { response: { status: '401' } }]
    for (const error of errors) {
      const manager = new McpOAuthManager(
        createStore(null),
        vi.fn(async () => undefined),
        publishDeepchatEventMock
      )
      expect(await manager.handleConnectionError('linear', config, error)).toBe(true)
      expect((await manager.getStatus('linear', config)).state).toBe('required')
    }
  })
  it('ignores stale authenticated flows after a newer auth attempt starts', async () => {
    const closeStaleSession = vi.fn()
    const closeActiveSession = vi.fn()
    const onAuthenticated = vi.fn()
    const manager = new McpOAuthManager(
      createStore({
        tokens: {
          access_token: 'access-token',
          token_type: 'Bearer'
        },
        updatedAt: 123
      }),
      vi.fn(async () => undefined),
      publishDeepchatEventMock,
      onAuthenticated
    )
    const staleFlow = {
      serverName: 'linear',
      serverUrl: 'https://mcp.linear.app/mcp',
      credentialKey: 'linear-key',
      state: 'old',
      provider: {},
      callbackSession: {
        close: closeStaleSession
      }
    }
    const activeFlow = {
      ...staleFlow,
      state: 'new',
      callbackSession: {
        close: closeActiveSession
      }
    }
    const managerInternals = manager as unknown as {
      pendingFlows: Map<string, unknown>
      finishAuthenticatedFlow: (flow: unknown) => void
    }
    managerInternals.pendingFlows.set('linear', activeFlow)
    await managerInternals.finishAuthenticatedFlow(staleFlow)
    expect(closeStaleSession).not.toHaveBeenCalled()
    expect(closeActiveSession).not.toHaveBeenCalled()
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })
  it('rejects an interactive credential when live discovery changes its issuer', async () => {
    discoverOAuthServerInfoMock.mockResolvedValue({
      authorizationServerUrl: 'https://auth.new.example/',
      authorizationServerMetadata: {
        issuer: 'https://auth.new.example/'
      },
      resourceMetadata: {
        resource: 'https://mcp.example/mcp'
      }
    })
    const staleEntry = {
      tokens: { access_token: 'stale-token', token_type: 'Bearer' },
      binding: {
        ...serverIdentity,
        endpoint: 'https://mcp.example/mcp',
        authorizationServerIssuer: 'https://auth.old.example/',
        protectedResourceUrl: 'https://mcp.example/mcp'
      },
      updatedAt: 123
    }
    const store = createStore(null)
    vi.mocked(store.findInteractiveCredential).mockResolvedValue({
      key: 'stale-key',
      entry: staleEntry
    })
    const manager = new McpOAuthManager(
      store,
      vi.fn(async () => undefined),
      publishDeepchatEventMock
    )
    await expect(
      manager.createRuntimeProvider('example', {
        type: 'http' as const,
        baseUrl: 'https://mcp.example/mcp',
        authorization: { mode: 'interactive' },
        ...serverIdentity
      })
    ).resolves.toBeUndefined()
    expect(store.clearEntry).toHaveBeenCalledWith('stale-key')
  })
  it('finalizes the persisted server binding from interactive discovery', async () => {
    const discovery: OAuthDiscoveryState = {
      authorizationServerUrl: 'https://auth.example/',
      authorizationServerMetadata: {
        issuer: 'https://auth.example/',
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        response_types_supported: ['code']
      },
      resourceMetadata: {
        resource: 'https://mcp.example/mcp'
      }
    }
    discoverOAuthServerInfoMock.mockResolvedValue(discovery)
    const entry = {
      tokens: { access_token: 'access-token', token_type: 'Bearer' },
      clientInformation: { client_id: 'dynamic-client' },
      discoveryState: discovery,
      binding: {
        ...serverIdentity,
        endpoint: 'https://mcp.example/mcp',
        authorizationServerIssuer: 'https://auth.example/',
        protectedResourceUrl: 'https://mcp.example/mcp',
        clientId: 'dynamic-client'
      },
      updatedAt: 123
    }
    const store = createStore(entry)
    vi.mocked(store.findInteractiveCredential).mockResolvedValue({
      key: 'old-key',
      entry
    })
    let currentConfig = {
      type: 'http' as const,
      command: '',
      args: [],
      env: {},
      descriptions: '',
      icons: '',
      enabled: true,
      baseUrl: 'https://mcp.example/mcp',
      authorization: { mode: 'interactive' as const },
      ...serverIdentity
    }
    const settings = {
      getMcpServers: vi.fn(async () => ({ example: currentConfig })),
      finalizeOAuthBinding: vi.fn((_expected: unknown, authorization: unknown) => {
        currentConfig = {
          ...currentConfig,
          authorization,
          configGeneration: 2,
          bindingHash: 'b'.repeat(64)
        } as typeof currentConfig
        return currentConfig
      })
    }
    const bindingChanged = vi.fn()
    const manager = new McpOAuthManager(
      store,
      vi.fn(async () => undefined),
      publishDeepchatEventMock,
      undefined,
      settings as never,
      bindingChanged
    )
    await expect(manager.createRuntimeProvider('example', currentConfig)).resolves.toBeDefined()
    expect(settings.finalizeOAuthBinding).toHaveBeenCalledWith(
      expect.objectContaining(serverIdentity),
      {
        mode: 'interactive',
        authorizationServerIssuer: 'https://auth.example/',
        protectedResourceUrl: 'https://mcp.example/mcp',
        clientId: 'dynamic-client'
      }
    )
    expect(bindingChanged).toHaveBeenCalledOnce()
    expect(store.moveInteractiveEntry).toHaveBeenCalledWith(
      'old-key',
      expect.not.stringMatching(/^old-key$/),
      expect.objectContaining({
        configGeneration: 2,
        bindingHash: 'b'.repeat(64),
        authorizationServerIssuer: 'https://auth.example/',
        protectedResourceUrl: 'https://mcp.example/mcp',
        clientId: 'dynamic-client'
      })
    )
  })
  it('binds client credentials to the configured issuer, resource, and server', async () => {
    const endpoint = 'https://mcp.example/mcp'
    const issuer = 'https://auth.example/'
    const binding = {
      ...serverIdentity,
      endpoint,
      authorizationServerIssuer: issuer,
      protectedResourceUrl: endpoint,
      clientId: 'machine-client'
    }
    const config = {
      type: 'http' as const,
      baseUrl: endpoint,
      authorization: {
        mode: 'client_credentials' as const,
        authorizationServerIssuer: issuer,
        protectedResourceUrl: endpoint,
        clientId: 'machine-client',
        scopes: ['read']
      },
      ...serverIdentity
    }
    const store = createStore(null)
    vi.mocked(store.loadClientSecret).mockResolvedValue({
      secret: 'client-secret',
      binding,
      updatedAt: 1
    })
    vi.mocked(store.getCredentialRecordStatus).mockResolvedValue({
      configured: true,
      updatedAt: 1
    })
    discoverOAuthServerInfoMock.mockResolvedValue({
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        token_endpoint_auth_methods_supported: ['client_secret_basic']
      },
      resourceMetadata: { resource: endpoint }
    })
    authMock.mockResolvedValue('AUTHORIZED')
    const manager = new McpOAuthManager(
      store,
      vi.fn(async () => undefined),
      publishDeepchatEventMock
    )
    const provider = await manager.createRuntimeProvider('example', config)
    expect(clientCredentialsProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'machine-client',
        clientSecret: 'client-secret',
        expectedIssuer: issuer,
        scope: 'read'
      }),
      provider
    )
    expect(authMock).toHaveBeenCalledWith(provider, {
      serverUrl: endpoint,
      scope: 'read'
    })
    const validateResourceURL = (
      provider as unknown as {
        validateResourceURL: (serverUrl: URL, resourceUrl?: URL) => Promise<URL>
      }
    ).validateResourceURL
    await expect(
      validateResourceURL(new URL('https://other.example/mcp'), new URL(endpoint))
    ).rejects.toThrow('configured server')
    await expect(
      validateResourceURL(new URL(endpoint), new URL('https://other.example/resource'))
    ).rejects.toThrow('protected resource')
    await expect(validateResourceURL(new URL(endpoint), new URL(endpoint))).resolves.toEqual(
      new URL(endpoint)
    )
  })
  it('preserves successful machine authentication when the server restart fails', async () => {
    const endpoint = 'https://mcp.example/mcp'
    const issuer = 'https://auth.example/'
    const binding = {
      ...serverIdentity,
      endpoint,
      authorizationServerIssuer: issuer,
      protectedResourceUrl: endpoint,
      clientId: 'machine-client'
    }
    const config = {
      type: 'http' as const,
      baseUrl: endpoint,
      authorization: {
        mode: 'client_credentials' as const,
        authorizationServerIssuer: issuer,
        protectedResourceUrl: endpoint,
        clientId: 'machine-client'
      },
      ...serverIdentity
    }
    const store = createStore(null)
    vi.mocked(store.loadClientSecret).mockResolvedValue({
      secret: 'client-secret',
      binding,
      updatedAt: 1
    })
    vi.mocked(store.getCredentialRecordStatus).mockResolvedValue({
      configured: true,
      updatedAt: 1
    })
    discoverOAuthServerInfoMock.mockResolvedValue({
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        token_endpoint_auth_methods_supported: ['client_secret_basic']
      },
      resourceMetadata: { resource: endpoint }
    })
    authMock.mockResolvedValue('AUTHORIZED')
    const onAuthenticated = vi.fn().mockRejectedValue(new Error('restart failed'))
    const manager = new McpOAuthManager(
      store,
      vi.fn(async () => undefined),
      publishDeepchatEventMock,
      onAuthenticated
    )
    const status = await manager.startAuth('example', config)
    expect(onAuthenticated).toHaveBeenCalledWith(
      serverIdentity.serverId,
      'restart',
      expect.any(Function)
    )
    expect(status).toMatchObject({
      state: 'authenticated',
      authenticated: true
    })
  })
  it('fails closed before selecting a private-key provider with incompatible discovery', async () => {
    const endpoint = 'https://mcp.example/mcp'
    const issuer = 'https://auth.example/'
    const binding = {
      ...serverIdentity,
      endpoint,
      authorizationServerIssuer: issuer,
      protectedResourceUrl: endpoint,
      clientId: 'machine-client'
    }
    const config = {
      type: 'http' as const,
      baseUrl: endpoint,
      authorization: {
        mode: 'private_key_jwt' as const,
        authorizationServerIssuer: issuer,
        protectedResourceUrl: endpoint,
        clientId: 'machine-client'
      },
      ...serverIdentity
    }
    const store = createStore(null)
    vi.mocked(store.loadPrivateKey).mockResolvedValue({
      privateKey: 'private-key',
      algorithm: 'RS256',
      fingerprint: 'fingerprint',
      binding,
      updatedAt: 1
    })
    vi.mocked(store.getCredentialRecordStatus).mockResolvedValue({
      configured: true,
      updatedAt: 1,
      fingerprint: 'fingerprint'
    })
    const discovery = {
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        token_endpoint_auth_methods_supported: ['client_secret_basic']
      },
      resourceMetadata: { resource: endpoint }
    }
    discoverOAuthServerInfoMock.mockResolvedValue(discovery)
    authMock.mockResolvedValue('AUTHORIZED')
    const manager = new McpOAuthManager(
      store,
      vi.fn(async () => undefined),
      publishDeepchatEventMock
    )
    await expect(manager.createRuntimeProvider('example', config)).rejects.toThrow(
      'does not support private_key_jwt'
    )
    expect(privateKeyJwtProviderMock).not.toHaveBeenCalled()
    expect(authMock).not.toHaveBeenCalled()
    discoverOAuthServerInfoMock.mockResolvedValue({
      ...discovery,
      authorizationServerMetadata: {
        issuer,
        token_endpoint_auth_methods_supported: ['private_key_jwt']
      }
    })
    const provider = await manager.createRuntimeProvider('example', config)
    expect(privateKeyJwtProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'machine-client',
        privateKey: 'private-key',
        algorithm: 'RS256',
        expectedIssuer: issuer
      }),
      provider
    )
  })
  it('requires ID-JAG discovery before binding cross-app access credentials', async () => {
    const endpoint = 'https://mcp.example/mcp'
    const issuer = 'https://auth.example/'
    const binding = {
      ...serverIdentity,
      endpoint,
      authorizationServerIssuer: issuer,
      protectedResourceUrl: endpoint,
      clientId: 'target-client'
    }
    const config = {
      type: 'http' as const,
      baseUrl: endpoint,
      authorization: {
        mode: 'cross_app_access' as const,
        authorizationServerIssuer: issuer,
        protectedResourceUrl: endpoint,
        clientId: 'target-client',
        identityProfileId: 'work'
      },
      ...serverIdentity
    }
    const store = createStore(null)
    vi.mocked(store.loadEnterpriseResourceSecret).mockResolvedValue({
      secret: 'target-secret',
      binding,
      updatedAt: 1
    })
    vi.mocked(store.getCredentialRecordStatus).mockResolvedValue({
      configured: true,
      updatedAt: 1
    })
    const discovery = {
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        token_endpoint_auth_methods_supported: ['client_secret_basic']
      },
      resourceMetadata: { resource: endpoint }
    }
    discoverOAuthServerInfoMock.mockResolvedValue(discovery)
    authMock.mockResolvedValue('AUTHORIZED')
    const createCrossAppProvider = vi
      .spyOn(McpEnterpriseIdentityManager.prototype, 'createCrossAppProvider')
      .mockResolvedValue(
        {} as Awaited<ReturnType<McpEnterpriseIdentityManager['createCrossAppProvider']>>
      )
    const manager = new McpOAuthManager(
      store,
      vi.fn(async () => undefined),
      publishDeepchatEventMock,
      undefined,
      {} as McpSettings
    )
    await expect(manager.createRuntimeProvider('example', config)).rejects.toThrow(
      'does not support the ID-JAG grant profile'
    )
    expect(createCrossAppProvider).not.toHaveBeenCalled()
    expect(store.loadEnterpriseResourceSecret).not.toHaveBeenCalled()
    discoverOAuthServerInfoMock.mockResolvedValue({
      ...discovery,
      authorizationServerMetadata: {
        ...discovery.authorizationServerMetadata,
        authorization_grant_profiles_supported: ['urn:ietf:params:oauth:grant-profile:id-jag']
      }
    })
    const provider = await manager.createRuntimeProvider('example', config)
    expect(createCrossAppProvider).toHaveBeenCalledWith(config, 'target-secret', issuer)
    expect(authMock).toHaveBeenCalledWith(provider, {
      serverUrl: endpoint,
      scope: undefined
    })
  })

  it('rejects a delayed runtime stop after the server binding is invalidated', async () => {
    const store = createStore(null)
    let finish!: () => void
    let entered!: () => void
    const stopping = new Promise<void>((resolve) => {
      entered = resolve
    })
    const effects: string[] = []
    const onRuntimeChange = vi.fn(
      async (_id: string, action: 'restart' | 'stop', assertCurrent: () => void) => {
        if (action === 'stop') {
          entered()
          await new Promise<void>((resolve) => {
            finish = resolve
          })
        }
        assertCurrent()
        effects.push(action)
      }
    )
    const manager = new McpOAuthManager(
      store,
      vi.fn(async () => undefined),
      publishDeepchatEventMock,
      onRuntimeChange
    )
    const binding = { ...serverIdentity, endpoint: 'https://mcp.example/mcp' }
    const removing = manager.removeCredential(binding, 'client_secret')
    const rejected = expect(removing).rejects.toThrow('interrupted')
    await stopping
    await manager.clearServerCredentials(binding.serverId)
    finish()
    await rejected
    expect(effects).toEqual([])
    expect(store.clearEntry).toHaveBeenCalledOnce()
  })
})
