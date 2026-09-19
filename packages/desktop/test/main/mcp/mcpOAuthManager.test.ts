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

import { McpOAuthManager } from '@/mcp/mcpOAuthManager'
import { McpEnterpriseIdentityManager } from '@/mcp/enterpriseIdentityManager'
import type { McpOAuthCredentialStore } from '@/mcp/oauthCredentialStore'
import type { McpSettings } from '@/mcp/settings'

const createStore = (entry: unknown): McpOAuthCredentialStore =>
  ({
    getStorageState: vi.fn(() => 'file'),
    isPersistent: vi.fn(() => true),
    load: vi.fn(() => entry),
    findInteractiveCredential: vi.fn(() => null),
    saveEntry: vi.fn(),
    clearEntry: vi.fn(),
    clearEntryScope: vi.fn(),
    loadClientSecret: vi.fn(() => null),
    loadPrivateKey: vi.fn(() => null),
    loadEnterpriseResourceSecret: vi.fn(() => null),
    getCredentialRecordStatus: vi.fn(() => ({ configured: false }))
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
          access_token: 'access-token'
        },
        discoveryState: {
          authorizationServerUrl: 'https://auth.example'
        },
        updatedAt: 123
      }),
      publishDeepchatEventMock
    )
    const config = {
      type: 'http',
      baseUrl: 'https://mcp.linear.app/mcp',
      ...serverIdentity
    }

    manager.handleConnectionError('linear', config, new Error('401 unauthorized'))

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
    const manager = new McpOAuthManager(createStore(null), publishDeepchatEventMock)
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
      manager as unknown as { failAuthFlow: (...args: unknown[]) => void },
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
        type: 'http',
        baseUrl: initialBinding.endpoint,
        authorization: { mode: 'interactive' },
        ...serverIdentity
      },
      'http://localhost/callback?code=code&state=state'
    )

    expect(resolveCallbackUrl).toHaveBeenCalledOnce()
    expect(failAuthFlow).not.toHaveBeenCalled()
  })

  it('classifies HTTP status shaped OAuth failures', () => {
    const config = {
      type: 'http',
      baseUrl: 'https://mcp.linear.app/mcp',
      ...serverIdentity
    } as const
    const errors = [{ status: 401 }, { httpStatus: 401 }, { response: { status: '401' } }]

    for (const error of errors) {
      const manager = new McpOAuthManager(createStore(null), publishDeepchatEventMock)

      expect(manager.handleConnectionError('linear', config, error)).toBe(true)
      expect(manager.getStatus('linear', config).state).toBe('required')
    }
  })

  it('ignores stale authenticated flows after a newer auth attempt starts', () => {
    const closeStaleSession = vi.fn()
    const closeActiveSession = vi.fn()
    const onAuthenticated = vi.fn()
    const manager = new McpOAuthManager(
      createStore({
        tokens: {
          access_token: 'access-token'
        },
        updatedAt: 123
      }),
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
    managerInternals.finishAuthenticatedFlow(staleFlow)

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
      tokens: { access_token: 'stale-token' },
      binding: {
        ...serverIdentity,
        endpoint: 'https://mcp.example/mcp',
        authorizationServerIssuer: 'https://auth.old.example/',
        protectedResourceUrl: 'https://mcp.example/mcp'
      },
      updatedAt: 123
    }
    const store = createStore(null)
    vi.mocked(store.findInteractiveCredential).mockReturnValue({
      key: 'stale-key',
      entry: staleEntry
    })
    const manager = new McpOAuthManager(store, publishDeepchatEventMock)

    await expect(
      manager.createRuntimeProvider('example', {
        type: 'http',
        baseUrl: 'https://mcp.example/mcp',
        authorization: { mode: 'interactive' },
        ...serverIdentity
      })
    ).resolves.toBeUndefined()
    expect(store.clearEntry).toHaveBeenCalledWith('stale-key')
  })

  it('finalizes the persisted server binding from interactive discovery', async () => {
    const discovery = {
      authorizationServerUrl: 'https://auth.example/',
      authorizationServerMetadata: {
        issuer: 'https://auth.example/'
      },
      resourceMetadata: {
        resource: 'https://mcp.example/mcp'
      }
    }
    discoverOAuthServerInfoMock.mockResolvedValue(discovery)
    const entry = {
      tokens: { access_token: 'access-token' },
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
    vi.mocked(store.findInteractiveCredential).mockReturnValue({
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
      updateMcpServer: vi.fn(async (_serverName: string, update: Record<string, unknown>) => {
        currentConfig = {
          ...currentConfig,
          ...update,
          configGeneration: 2,
          bindingHash: 'b'.repeat(64)
        } as typeof currentConfig
      })
    }
    const bindingChanged = vi.fn()
    const manager = new McpOAuthManager(
      store,
      publishDeepchatEventMock,
      undefined,
      settings as never,
      bindingChanged
    )

    await expect(manager.createRuntimeProvider('example', currentConfig)).resolves.toBeDefined()

    expect(settings.updateMcpServer).toHaveBeenCalledWith('example', {
      authorization: {
        mode: 'interactive',
        authorizationServerIssuer: 'https://auth.example/',
        protectedResourceUrl: 'https://mcp.example/mcp',
        clientId: 'dynamic-client'
      }
    })
    expect(bindingChanged).toHaveBeenCalledOnce()
    expect(store.saveEntry).toHaveBeenCalledWith(
      expect.not.stringMatching(/^old-key$/),
      expect.objectContaining({
        binding: expect.objectContaining({
          configGeneration: 2,
          bindingHash: 'b'.repeat(64),
          authorizationServerIssuer: 'https://auth.example/',
          protectedResourceUrl: 'https://mcp.example/mcp',
          clientId: 'dynamic-client'
        })
      })
    )
    expect(store.clearEntry).toHaveBeenCalledWith('old-key')
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
    vi.mocked(store.loadClientSecret).mockReturnValue({
      secret: 'client-secret',
      binding,
      updatedAt: 1
    })
    vi.mocked(store.getCredentialRecordStatus).mockReturnValue({
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
    const manager = new McpOAuthManager(store, publishDeepchatEventMock)

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
    vi.mocked(store.loadClientSecret).mockReturnValue({
      secret: 'client-secret',
      binding,
      updatedAt: 1
    })
    vi.mocked(store.getCredentialRecordStatus).mockReturnValue({
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
    const manager = new McpOAuthManager(store, publishDeepchatEventMock, onAuthenticated)

    const status = await manager.startAuth('example', config)

    expect(onAuthenticated).toHaveBeenCalledWith('example')
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
    vi.mocked(store.loadPrivateKey).mockReturnValue({
      privateKey: 'private-key',
      algorithm: 'RS256',
      fingerprint: 'fingerprint',
      binding,
      updatedAt: 1
    })
    vi.mocked(store.getCredentialRecordStatus).mockReturnValue({
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
    const manager = new McpOAuthManager(store, publishDeepchatEventMock)

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
    vi.mocked(store.loadEnterpriseResourceSecret).mockReturnValue({
      secret: 'target-secret',
      binding,
      updatedAt: 1
    })
    vi.mocked(store.getCredentialRecordStatus).mockReturnValue({
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
})
