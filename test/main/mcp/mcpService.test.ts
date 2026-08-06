import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const serverManagerMocks = vi.hoisted(() => ({
  startServer: vi.fn(),
  stopServer: vi.fn(),
  isServerRunning: vi.fn(),
  getRunningClients: vi.fn().mockResolvedValue([]),
  getActiveClients: vi.fn().mockResolvedValue([]),
  testNpmRegistrySpeed: vi.fn().mockResolvedValue('https://registry.npmjs.org/'),
  getNpmRegistry: vi.fn().mockReturnValue('https://registry.npmjs.org/'),
  updateNpmRegistryInBackground: vi.fn().mockResolvedValue(undefined),
  loadRegistryFromCache: vi.fn(),
  refreshNpmRegistry: vi.fn().mockResolvedValue('https://registry.npmjs.org/'),
  getUvRegistry: vi.fn().mockReturnValue(null)
}))

const toolManagerMocks = vi.hoisted(() => ({
  getAllToolDefinitions: vi.fn().mockResolvedValue([]),
  getRunningClients: vi.fn().mockResolvedValue([]),
  invalidateRegistry: vi.fn(),
  callTool: vi.fn()
}))

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const semanticNotificationsMock = vi.hoisted(() => ({
  occur: vi.fn(),
  recover: vi.fn()
}))

vi.mock('../../../src/main/mcp/serverManager', () => ({
  ServerManager: vi.fn().mockImplementation(() => ({
    startServer: serverManagerMocks.startServer,
    stopServer: serverManagerMocks.stopServer,
    isServerRunning: serverManagerMocks.isServerRunning,
    getRunningClients: serverManagerMocks.getRunningClients,
    getActiveClients: serverManagerMocks.getActiveClients,
    testNpmRegistrySpeed: serverManagerMocks.testNpmRegistrySpeed,
    getNpmRegistry: serverManagerMocks.getNpmRegistry,
    updateNpmRegistryInBackground: serverManagerMocks.updateNpmRegistryInBackground,
    loadRegistryFromCache: serverManagerMocks.loadRegistryFromCache,
    refreshNpmRegistry: serverManagerMocks.refreshNpmRegistry,
    getUvRegistry: serverManagerMocks.getUvRegistry
  }))
}))

vi.mock('../../../src/main/mcp/toolManager', () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    getAllToolDefinitions: toolManagerMocks.getAllToolDefinitions,
    getRunningClients: toolManagerMocks.getRunningClients,
    invalidateRegistry: toolManagerMocks.invalidateRegistry,
    callTool: toolManagerMocks.callTool
  }))
}))

vi.mock('../../../src/main/mcp/mcprouterManager', () => ({
  McpRouterManager: vi.fn().mockImplementation(() => ({}))
}))

import { McpService } from '../../../src/main/mcp'
import { ToolManager } from '../../../src/main/mcp/toolManager'
import type { CacheImageOptions } from '../../../src/main/platform/imageCache'

const installToolManagerMock = () => {
  vi.mocked(ToolManager).mockImplementation(
    () =>
      ({
        getAllToolDefinitions: toolManagerMocks.getAllToolDefinitions,
        getRunningClients: toolManagerMocks.getRunningClients,
        invalidateRegistry: toolManagerMocks.invalidateRegistry,
        callTool: toolManagerMocks.callTool
      }) as never
  )
}

const createMcpService = (
  providerSettings: any,
  onRegistryChanged = vi.fn(),
  mcpApps?: {
    registry: { revokeByServer(serverId: string): void }
  },
  cacheImage?: (data: string, options?: CacheImageOptions) => Promise<string>
) =>
  new McpService(
    providerSettings,
    providerSettings,
    { getCustomPrompts: vi.fn().mockResolvedValue([]) },
    providerSettings,
    { isEnabled: () => providerSettings.privacyModeEnabled === true },
    vi.fn() as never,
    {} as never,
    onRegistryChanged,
    semanticNotificationsMock,
    publishDeepchatEventMock,
    cacheImage,
    undefined,
    undefined,
    mcpApps
      ? ({
          registry: mcpApps.registry,
          permissionBroker: {},
          getPermissionMode: vi.fn(),
          validateSource: vi.fn(),
          persistModelContext: vi.fn()
        } as never)
      : undefined
  )

describe('McpService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    installToolManagerMock()
    serverManagerMocks.startServer.mockResolvedValue(undefined)
    serverManagerMocks.stopServer.mockResolvedValue(undefined)
    serverManagerMocks.isServerRunning.mockReturnValue(false)
    serverManagerMocks.getRunningClients.mockResolvedValue([])
    serverManagerMocks.getActiveClients.mockResolvedValue([])
    serverManagerMocks.testNpmRegistrySpeed.mockResolvedValue('https://registry.npmjs.org/')
    serverManagerMocks.updateNpmRegistryInBackground.mockResolvedValue(undefined)
    serverManagerMocks.refreshNpmRegistry.mockResolvedValue('https://registry.npmjs.org/')
    toolManagerMocks.getAllToolDefinitions.mockResolvedValue([])
    toolManagerMocks.callTool.mockReset()
  })

  it('caches embedded MCP image URLs before exposing the tool result to the model', async () => {
    const sourceUrl = 'https://example.com/generated/output.jpeg?Expires=123'
    const mcpResult = {
      schemaVersion: 1,
      toolName: 'draw',
      content: [{ type: 'text', text: `Success. Image URL(s): ${sourceUrl}` }]
    }
    toolManagerMocks.callTool.mockResolvedValue({
      toolCallId: 'tool-image',
      content: [{ type: 'text', text: `Success. Image URL(s): ${sourceUrl}` }],
      isError: false,
      mcpResult
    })
    const cacheImage = vi.fn().mockResolvedValue('imgcache://generated.jpg')
    const presenter = createMcpService(
      createProviderSettings(true, false, {
        remote: { type: 'http' }
      }),
      undefined,
      undefined,
      cacheImage
    )

    const result = await presenter.callTool({
      id: 'tool-image',
      type: 'function',
      function: { name: 'draw', arguments: '{}' },
      server: { name: 'remote', icons: '', description: '' }
    })

    expect(cacheImage).toHaveBeenCalledWith(sourceUrl, {
      signal: undefined,
      allowPrivateNetwork: false
    })
    expect(result.content).toBe('Success. Image URL(s): imgcache://generated.jpg')
    expect(result.rawData).toMatchObject({
      content: [
        {
          type: 'text',
          text: 'Success. Image URL(s): imgcache://generated.jpg'
        }
      ],
      mcpResult,
      imagePreviews: [
        {
          data: 'imgcache://generated.jpg',
          mimeType: 'image/jpeg',
          source: 'tool_output'
        }
      ]
    })
    expect(result.rawData.mcpResult).toBe(mcpResult)
  })

  it('allows local MCP transports to cache private-network image URLs', async () => {
    const sourceUrl = 'http://127.0.0.1/generated.png'
    toolManagerMocks.callTool.mockResolvedValue({
      toolCallId: 'tool-local-image',
      content: sourceUrl,
      isError: false
    })
    const cacheImage = vi.fn().mockResolvedValue('imgcache://generated.png')
    const presenter = createMcpService(
      createProviderSettings(true, false, {
        local: { type: 'stdio' }
      }),
      undefined,
      undefined,
      cacheImage
    )

    await presenter.callTool({
      id: 'tool-local-image',
      type: 'function',
      function: { name: 'draw', arguments: '{}' },
      server: { name: 'local', icons: '', description: '' }
    })

    expect(cacheImage).toHaveBeenCalledWith(sourceUrl, {
      signal: undefined,
      allowPrivateNetwork: true
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('invalidates tool caches through the explicit config callback', () => {
    const onRegistryChanged = vi.fn()
    const presenter = createMcpService(createProviderSettings(true), onRegistryChanged)

    presenter.handleConfigChanged()

    expect(toolManagerMocks.invalidateRegistry).toHaveBeenCalledOnce()
    expect(onRegistryChanged).toHaveBeenCalledOnce()
  })

  it('delegates supervised startup waiting to ServerManager', async () => {
    const presenter = createMcpService(createProviderSettings(true))
    ;(presenter as any).serverManager = {
      startServer: serverManagerMocks.startServer
    }
    serverManagerMocks.startServer.mockResolvedValueOnce('connected')

    await (presenter as any).startServerDirect('plugin-runtime', { command: 'runtime-proxy' }, true)

    expect(serverManagerMocks.startServer).toHaveBeenCalledWith('plugin-runtime', {
      onBackgroundConnected: undefined,
      configOverride: { command: 'runtime-proxy' },
      waitForConnection: true
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith(
      'mcp.server.started',
      expect.objectContaining({ serverName: 'plugin-runtime' })
    )
  })

  const createProviderSettings = (
    mcpEnabled: boolean,
    privacyModeEnabled = false,
    servers: Record<string, any> = {},
    enabledServers: string[] = []
  ) =>
    ({
      setMcpServerEnabled: vi.fn().mockResolvedValue(undefined),
      getMcpEnabled: vi.fn().mockResolvedValue(mcpEnabled),
      setMcpEnabled: vi.fn().mockResolvedValue(undefined),
      getMcpServers: vi.fn().mockResolvedValue(servers),
      getEnabledMcpServers: vi.fn().mockResolvedValue(enabledServers),
      addMcpServer: vi.fn().mockResolvedValue(undefined),
      privacyModeEnabled
    }) as any

  it('returns a typed duplicate result without mutating settings', async () => {
    const providerSettings = createProviderSettings(true, false, {
      existing: { type: 'stdio', command: 'node' }
    })
    const presenter = createMcpService(providerSettings)

    await expect(
      presenter.addMcpServer('existing', { type: 'stdio', command: 'node' })
    ).resolves.toEqual({ status: 'duplicate' })

    expect(providerSettings.addMcpServer).not.toHaveBeenCalled()
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })

  it('persists a new server and returns an added result', async () => {
    const providerSettings = createProviderSettings(true)
    const presenter = createMcpService(providerSettings)
    const config = { type: 'stdio', command: 'node' } as const

    await expect(presenter.addMcpServer('new-server', config)).resolves.toEqual({
      status: 'added'
    })

    expect(providerSettings.addMcpServer).toHaveBeenCalledWith('new-server', config)
  })

  it('serializes concurrent adds so duplicate results remain truthful', async () => {
    const servers: Record<string, any> = {}
    const providerSettings = createProviderSettings(true)
    providerSettings.getMcpServers.mockImplementation(async () => ({ ...servers }))
    providerSettings.addMcpServer.mockImplementation(async (name: string, config: any) => {
      servers[name] = config
    })
    const presenter = createMcpService(providerSettings)
    const config = { type: 'stdio', command: 'node' } as const

    await expect(
      Promise.all([
        presenter.addMcpServer('shared-name', config),
        presenter.addMcpServer('shared-name', config)
      ])
    ).resolves.toEqual([{ status: 'added' }, { status: 'duplicate' }])

    expect(providerSettings.addMcpServer).toHaveBeenCalledOnce()
  })

  it('starts a server immediately after enabling it when MCP is active', async () => {
    const providerSettings = createProviderSettings(true)
    const presenter = createMcpService(providerSettings)
    const startSpy = vi.spyOn(presenter, 'startServer').mockResolvedValue(undefined)
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpServerEnabled('demo-server', true)

    expect(providerSettings.setMcpServerEnabled).toHaveBeenCalledWith('demo-server', true)
    expect(startSpy).toHaveBeenCalledWith('demo-server')
    expect(stopSpy).not.toHaveBeenCalled()
    expect(providerSettings.setMcpServerEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      startSpy.mock.invocationCallOrder[0]
    )
  })

  it('stops a server immediately after disabling it when MCP is active', async () => {
    const providerSettings = createProviderSettings(true)
    const presenter = createMcpService(providerSettings)
    const startSpy = vi.spyOn(presenter, 'startServer').mockResolvedValue(undefined)
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpServerEnabled('demo-server', false)

    expect(providerSettings.setMcpServerEnabled).toHaveBeenCalledWith('demo-server', false)
    expect(stopSpy).toHaveBeenCalledWith('demo-server')
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('revokes bound MCP Apps before disabling their server', async () => {
    const providerSettings = createProviderSettings(true, false, {
      'demo-server': {
        enabled: true,
        serverId: '11111111-1111-4111-8111-111111111111'
      }
    })
    const registry = { revokeByServer: vi.fn() }
    const presenter = createMcpService(providerSettings, vi.fn(), { registry })
    vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpServerEnabled('demo-server', false)

    expect(registry.revokeByServer).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(registry.revokeByServer.mock.invocationCallOrder[0]).toBeLessThan(
      providerSettings.setMcpServerEnabled.mock.invocationCallOrder[0]
    )
  })

  it('only persists config when MCP is globally disabled', async () => {
    const providerSettings = createProviderSettings(false)
    const presenter = createMcpService(providerSettings)
    const startSpy = vi.spyOn(presenter, 'startServer').mockResolvedValue(undefined)
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpServerEnabled('demo-server', true)

    expect(providerSettings.setMcpServerEnabled).toHaveBeenCalledWith('demo-server', true)
    expect(startSpy).not.toHaveBeenCalled()
    expect(stopSpy).not.toHaveBeenCalled()
  })

  it('does not start persisted plugin-owned servers without trusted registration', async () => {
    const providerSettings = createProviderSettings(
      false,
      false,
      {
        regular: { enabled: true },
        plugin: { enabled: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' }
      },
      ['regular', 'plugin']
    )
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).serverManager = {
      startServer: serverManagerMocks.startServer,
      testNpmRegistrySpeed: serverManagerMocks.testNpmRegistrySpeed,
      getNpmRegistry: serverManagerMocks.getNpmRegistry,
      updateNpmRegistryInBackground: serverManagerMocks.updateNpmRegistryInBackground
    }

    await presenter.initialize()

    expect(serverManagerMocks.startServer).not.toHaveBeenCalled()
  })

  it('does not wait for hanging enabled servers during initialization', async () => {
    const providerSettings = createProviderSettings(
      true,
      false,
      {
        regular: { enabled: true },
        plugin: { enabled: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' }
      },
      ['regular', 'plugin']
    )
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).serverManager = {
      startServer: serverManagerMocks.startServer,
      testNpmRegistrySpeed: serverManagerMocks.testNpmRegistrySpeed,
      getNpmRegistry: serverManagerMocks.getNpmRegistry,
      updateNpmRegistryInBackground: serverManagerMocks.updateNpmRegistryInBackground
    }
    serverManagerMocks.startServer.mockImplementation(() => new Promise(() => {}))

    const result = Promise.race([
      presenter.initialize().then(() => 'initialized'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 1))
    ])
    await vi.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toBe('initialized')
    expect(serverManagerMocks.startServer).toHaveBeenCalledWith(
      'regular',
      expect.objectContaining({ onBackgroundConnected: expect.any(Function) })
    )
    expect(serverManagerMocks.startServer).toHaveBeenCalledTimes(1)
  })

  it('does not start plugin-owned servers when enabling the global MCP switch', async () => {
    const providerSettings = createProviderSettings(
      true,
      false,
      {
        regular: { enabled: true },
        plugin: { enabled: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' }
      },
      ['regular', 'plugin']
    )
    const presenter = createMcpService(providerSettings)
    const startSpy = vi.spyOn(presenter, 'startServer').mockResolvedValue(undefined)

    await presenter.setMcpEnabled(true)

    expect(providerSettings.setMcpEnabled).toHaveBeenCalledWith(true)
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(startSpy).toHaveBeenCalledWith('regular')
  })

  it('keeps trusted plugin runtimes outside the global switch and stops stale source metadata', async () => {
    const providerSettings = createProviderSettings(false, false, {
      regular: { enabled: true },
      plugin: { enabled: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' },
      trusted: { enabled: false, source: 'plugin', ownerPluginId: 'com.deepchat.trusted' }
    })
    serverManagerMocks.getActiveClients.mockResolvedValue([
      { serverName: 'regular' },
      { serverName: 'plugin' },
      { serverName: 'trusted' }
    ])
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).toolManager = {
      invalidateRegistry: toolManagerMocks.invalidateRegistry
    }
    ;(presenter as any).pluginRuntimeSupervisor.registerServer({
      pluginId: 'com.deepchat.trusted',
      serverName: 'trusted',
      startMode: 'eager',
      surfaces: ['tools']
    })
    ;(presenter as any).serverManager = {
      getActiveClients: serverManagerMocks.getActiveClients,
      stopServer: serverManagerMocks.stopServer
    }
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpEnabled(false)

    expect(providerSettings.setMcpEnabled).toHaveBeenCalledWith(false)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).toHaveBeenCalledWith('regular')
    expect(serverManagerMocks.stopServer).toHaveBeenCalledWith('plugin')
    expect(serverManagerMocks.stopServer).not.toHaveBeenCalledWith('trusted')
  })

  it('stops connecting non-plugin servers when disabling the global MCP switch', async () => {
    const providerSettings = createProviderSettings(false, false, {
      connecting: { enabled: true }
    })
    serverManagerMocks.getActiveClients.mockResolvedValue([{ serverName: 'connecting' }])
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).serverManager = {
      getActiveClients: serverManagerMocks.getActiveClients
    }
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpEnabled(false)

    expect(stopSpy).toHaveBeenCalledWith('connecting')
  })

  it('stops all running clients during shutdown and continues after stop failures', async () => {
    const providerSettings = createProviderSettings(true)
    const presenter = createMcpService(providerSettings)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(presenter as any).serverManager = {
      getActiveClients: serverManagerMocks.getActiveClients,
      stopServer: serverManagerMocks.stopServer
    }
    serverManagerMocks.getActiveClients.mockResolvedValue([
      { serverName: 'first' },
      { serverName: 'second' }
    ])
    serverManagerMocks.stopServer
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(undefined)

    await presenter.shutdown()

    expect(serverManagerMocks.stopServer).toHaveBeenCalledTimes(2)
    expect(serverManagerMocks.stopServer).toHaveBeenCalledWith('first')
    expect(serverManagerMocks.stopServer).toHaveBeenCalledWith('second')
    consoleErrorSpy.mockRestore()
  })

  it('is safe to call shutdown repeatedly', async () => {
    const providerSettings = createProviderSettings(true)
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).serverManager = {
      getActiveClients: serverManagerMocks.getActiveClients,
      stopServer: serverManagerMocks.stopServer
    }
    serverManagerMocks.getActiveClients
      .mockResolvedValueOnce([{ serverName: 'first' }])
      .mockResolvedValueOnce([])
    serverManagerMocks.stopServer.mockResolvedValue(undefined)

    await presenter.shutdown()
    await presenter.shutdown()

    expect(serverManagerMocks.getActiveClients).toHaveBeenCalledTimes(2)
    expect(serverManagerMocks.stopServer).toHaveBeenCalledTimes(1)
    expect(serverManagerMocks.stopServer).toHaveBeenCalledWith('first')
  })

  it('shares one in-flight shutdown across concurrent callers', async () => {
    const providerSettings = createProviderSettings(true)
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).serverManager = {
      getActiveClients: serverManagerMocks.getActiveClients,
      stopServer: serverManagerMocks.stopServer
    }
    let resolveStop: (() => void) | undefined
    serverManagerMocks.getActiveClients.mockResolvedValue([{ serverName: 'first' }])
    serverManagerMocks.stopServer.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve
        })
    )

    const firstShutdown = presenter.shutdown()
    const secondShutdown = presenter.shutdown()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(serverManagerMocks.getActiveClients).toHaveBeenCalledTimes(1)
    expect(serverManagerMocks.stopServer).toHaveBeenCalledTimes(1)

    resolveStop?.()
    await Promise.all([firstShutdown, secondShutdown])
  })

  it('rejects generic lifecycle controls for trusted plugin-owned servers', async () => {
    const providerSettings = createProviderSettings(true, false, {
      plugin: {
        enabled: false,
        source: 'plugin',
        ownerPluginId: 'com.deepchat.plugins.fixture'
      }
    })
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).toolManager = {
      invalidateRegistry: toolManagerMocks.invalidateRegistry
    }
    ;(presenter as any).pluginRuntimeSupervisor.registerServer({
      pluginId: 'com.deepchat.plugins.fixture',
      serverName: 'plugin',
      startMode: 'eager',
      surfaces: ['tools']
    })

    await expect(presenter.setMcpServerEnabled('plugin', true)).rejects.toThrow(
      'controlled by its plugin'
    )
    await expect(presenter.startServer('plugin')).rejects.toThrow(
      'cannot be started through the generic MCP route'
    )
    await expect(presenter.stopServer('plugin')).rejects.toThrow(
      'cannot be stopped through the generic MCP route'
    )

    expect(providerSettings.setMcpServerEnabled).not.toHaveBeenCalled()
    expect(serverManagerMocks.startServer).not.toHaveBeenCalled()
    expect(serverManagerMocks.stopServer).not.toHaveBeenCalled()
  })

  it('keeps plugin-owned tool definitions available when MCP is globally disabled', async () => {
    const providerSettings = createProviderSettings(false, false, {
      regular: { enabled: true },
      plugin: { enabled: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' }
    })
    toolManagerMocks.getAllToolDefinitions.mockResolvedValueOnce([
      {
        type: 'function',
        function: {
          name: 'regular_tool',
          description: '',
          parameters: { type: 'object', properties: {} }
        },
        server: { name: 'regular', icons: '', description: '' }
      },
      {
        type: 'function',
        function: {
          name: 'plugin_tool',
          description: '',
          parameters: { type: 'object', properties: {} }
        },
        server: { name: 'plugin', icons: '', description: '' }
      }
    ])
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).toolManager = {
      getAllToolDefinitions: toolManagerMocks.getAllToolDefinitions,
      invalidateRegistry: toolManagerMocks.invalidateRegistry
    }
    ;(presenter as any).pluginRuntimeSupervisor.registerServer({
      pluginId: 'com.deepchat.plugins.fixture',
      serverName: 'plugin',
      startMode: 'eager',
      surfaces: ['tools']
    })

    const tools = await presenter.getAllToolDefinitions({ enabledServerIds: [] })

    expect(tools.map((tool) => tool.function.name)).toEqual(['plugin_tool'])
  })

  it('does not grant plugin access from writable source metadata alone', async () => {
    const providerSettings = createProviderSettings(true, false, {
      plugin: { enabled: true, source: 'plugin', sourceId: 'plugin-a' }
    })
    toolManagerMocks.getAllToolDefinitions.mockResolvedValue([
      {
        type: 'function',
        function: {
          name: 'plugin_tool',
          description: '',
          parameters: { type: 'object', properties: {} }
        },
        server: { name: 'plugin', icons: '', description: '' }
      }
    ])
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).toolManager = {
      getAllToolDefinitions: toolManagerMocks.getAllToolDefinitions
    }

    const tools = await presenter.getAllToolDefinitions({ enabledServerIds: [] })

    expect(tools).toEqual([])
  })

  it('rejects when the runtime transition fails after persisting config', async () => {
    const providerSettings = createProviderSettings(true)
    const presenter = createMcpService(providerSettings)
    const runtimeError = new Error('runtime failed')

    vi.spyOn(presenter, 'startServer').mockRejectedValue(runtimeError)

    await expect(presenter.setMcpServerEnabled('demo-server', true)).rejects.toThrow(
      'runtime failed'
    )
    expect(providerSettings.setMcpServerEnabled).toHaveBeenCalledWith('demo-server', true)
  })

  it('skips automatic npm registry probing in privacy mode and keeps manual refresh available', async () => {
    const providerSettings = createProviderSettings(true, true)
    const presenter = createMcpService(providerSettings)
    ;(presenter as any).serverManager.refreshNpmRegistry = serverManagerMocks.refreshNpmRegistry

    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5000)

    expect(serverManagerMocks.testNpmRegistrySpeed).not.toHaveBeenCalled()
    expect(serverManagerMocks.updateNpmRegistryInBackground).not.toHaveBeenCalled()

    await presenter.refreshNpmRegistry()

    expect(serverManagerMocks.refreshNpmRegistry).toHaveBeenCalledTimes(1)
  })

  it('resolves installed source IDs with one config read', async () => {
    const providerSettings = createProviderSettings(true, false, {
      context7: { source: 'mcprouter', sourceId: 'context7' },
      context7Alias: { source: 'mcprouter', sourceId: 'context7' },
      localFiles: { source: 'builtin', sourceId: 'filesystem' }
    })
    const presenter = createMcpService(providerSettings)

    await expect(
      presenter.listInstalledServerIds('mcprouter', ['context7', 'filesystem', 'missing'])
    ).resolves.toEqual(['context7'])
    expect(providerSettings.getMcpServers).toHaveBeenCalledTimes(1)
  })

  it('removes every router authorization header when the API key is cleared', async () => {
    const presenter = createMcpService(createProviderSettings(true))
    const setRouterApiKeyAndServers = vi.fn()
    ;(presenter as any).mcpSettings = {
      getRouterApiKey: vi.fn().mockReturnValue('old-key'),
      getMcpServers: vi.fn().mockResolvedValue({
        primary: {
          source: 'mcprouter',
          customHeaders: {
            Authorization: 'Bearer old-key',
            'X-Router-Region': 'global'
          }
        },
        legacy: {
          source: 'mcprouter',
          customHeaders: {
            authorization: 'Bearer legacy-key'
          }
        },
        local: {
          source: 'custom',
          customHeaders: {
            Authorization: 'Bearer unrelated-key'
          }
        }
      }),
      setRouterApiKeyAndServers
    }

    await presenter.setMcpRouterApiKey('   ')

    expect(setRouterApiKeyAndServers).toHaveBeenCalledOnce()
    expect(setRouterApiKeyAndServers).toHaveBeenCalledWith('', {
      primary: {
        source: 'mcprouter',
        customHeaders: { 'X-Router-Region': 'global' }
      },
      legacy: {
        source: 'mcprouter',
        customHeaders: {}
      },
      local: {
        source: 'custom',
        customHeaders: {
          Authorization: 'Bearer unrelated-key'
        }
      }
    })
  })

  it('rewrites only router authorization headers that differ from the API key', async () => {
    const presenter = createMcpService(createProviderSettings(true))
    const setRouterApiKeyAndServers = vi.fn()
    ;(presenter as any).mcpSettings = {
      getRouterApiKey: vi.fn().mockReturnValue('current-key'),
      getMcpServers: vi.fn().mockResolvedValue({
        synchronized: {
          source: 'mcprouter',
          customHeaders: {
            Authorization: 'Bearer current-key'
          }
        },
        stale: {
          source: 'mcprouter',
          customHeaders: {
            authorization: 'Bearer old-key',
            'X-Router-Region': 'global'
          }
        }
      }),
      setRouterApiKeyAndServers
    }

    await presenter.setMcpRouterApiKey(' current-key ')

    expect(setRouterApiKeyAndServers).toHaveBeenCalledOnce()
    expect(setRouterApiKeyAndServers).toHaveBeenCalledWith('current-key', {
      synchronized: {
        source: 'mcprouter',
        customHeaders: {
          Authorization: 'Bearer current-key'
        }
      },
      stale: {
        source: 'mcprouter',
        customHeaders: {
          Authorization: 'Bearer current-key',
          'X-Router-Region': 'global'
        }
      }
    })
  })

  it('does not rewrite Router credentials that are already synchronized', async () => {
    const presenter = createMcpService(createProviderSettings(true))
    const setRouterApiKeyAndServers = vi.fn()
    ;(presenter as any).mcpSettings = {
      getRouterApiKey: vi.fn().mockReturnValue('current-key'),
      getMcpServers: vi.fn().mockResolvedValue({
        synchronized: {
          source: 'mcprouter',
          customHeaders: {
            Authorization: 'Bearer current-key'
          }
        }
      }),
      setRouterApiKeyAndServers
    }

    await presenter.setMcpRouterApiKey('current-key')

    expect(setRouterApiKeyAndServers).not.toHaveBeenCalled()
  })
})

describe('McpService sampling events', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    installToolManagerMock()
    serverManagerMocks.getRunningClients.mockResolvedValue([])
    toolManagerMocks.getAllToolDefinitions.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const createProviderSettings = () =>
    ({
      getMcpEnabled: vi.fn().mockResolvedValue(true),
      getMcpServers: vi.fn().mockResolvedValue({}),
      getEnabledMcpServers: vi.fn().mockResolvedValue([]),
      getLanguage: vi.fn().mockReturnValue('en-US'),
      privacyModeEnabled: false
    }) as any

  it('publishes typed sampling request and decision events without raw renderer channels', async () => {
    const presenter = createMcpService(createProviderSettings())
    const request = {
      requestId: 'sampling-request-1',
      serverName: 'demo-server',
      messages: [],
      requiresVision: false
    } as any
    const decision = {
      requestId: 'sampling-request-1',
      approved: false,
      reason: 'Rejected by test'
    }

    const pendingDecision = presenter.handleSamplingRequest(request)

    expect(publishDeepchatEventMock).toHaveBeenCalledWith('mcp.sampling.request', {
      request,
      version: expect.any(Number)
    })

    await presenter.submitSamplingDecision(decision)
    await expect(pendingDecision).resolves.toEqual(decision)

    expect(publishDeepchatEventMock).toHaveBeenCalledWith('mcp.sampling.decision', {
      decision,
      version: expect.any(Number)
    })
  })

  it('publishes typed sampling cancellation without raw renderer channels', async () => {
    const presenter = createMcpService(createProviderSettings())
    const request = {
      requestId: 'sampling-request-2',
      serverName: 'demo-server',
      messages: [],
      requiresVision: false
    } as any

    const pendingDecision = presenter.handleSamplingRequest(request)

    await presenter.cancelSamplingRequest('sampling-request-2', 'Cancelled by test')
    await expect(pendingDecision).rejects.toThrow('Cancelled by test')

    expect(publishDeepchatEventMock).toHaveBeenCalledWith('mcp.sampling.cancelled', {
      requestId: 'sampling-request-2',
      reason: 'Cancelled by test',
      version: expect.any(Number)
    })
  })
})
