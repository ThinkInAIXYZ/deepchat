import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const discoverOAuthServerInfoMock = vi.hoisted(() => vi.fn())

vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@modelcontextprotocol/client')>()),
  discoverOAuthServerInfo: discoverOAuthServerInfoMock
}))

import { McpOAuthManager } from '@/mcp/mcpOAuthManager'
import type { McpOAuthCredentialStore } from '@/mcp/oauthCredentialStore'

const createStore = (entry: unknown): McpOAuthCredentialStore =>
  ({
    getStorageState: vi.fn(() => 'file'),
    isPersistent: vi.fn(() => true),
    load: vi.fn(() => entry),
    findInteractiveCredential: vi.fn(() => null),
    saveEntry: vi.fn(),
    clearEntry: vi.fn(),
    clearEntryScope: vi.fn()
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
    expect(bindingChanged).toHaveBeenCalledTimes(2)
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
})
