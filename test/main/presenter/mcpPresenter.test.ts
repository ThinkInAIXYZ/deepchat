import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const serverManagerMocks = vi.hoisted(() => ({
  startServer: vi.fn(),
  stopServer: vi.fn(),
  isServerRunning: vi.fn(),
  getRunningClients: vi.fn().mockResolvedValue([]),
  testNpmRegistrySpeed: vi.fn().mockResolvedValue('https://registry.npmjs.org/'),
  getNpmRegistry: vi.fn().mockReturnValue('https://registry.npmjs.org/'),
  updateNpmRegistryInBackground: vi.fn().mockResolvedValue(undefined),
  loadRegistryFromCache: vi.fn(),
  refreshNpmRegistry: vi.fn().mockResolvedValue('https://registry.npmjs.org/'),
  getUvRegistry: vi.fn().mockReturnValue(null)
}))

const toolManagerMocks = vi.hoisted(() => ({
  getAllToolDefinitions: vi.fn().mockResolvedValue([]),
  getRunningClients: vi.fn().mockResolvedValue([])
}))

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/main/presenter/mcpPresenter/serverManager', () => ({
  ServerManager: vi.fn().mockImplementation(() => ({
    startServer: serverManagerMocks.startServer,
    stopServer: serverManagerMocks.stopServer,
    isServerRunning: serverManagerMocks.isServerRunning,
    getRunningClients: serverManagerMocks.getRunningClients,
    testNpmRegistrySpeed: serverManagerMocks.testNpmRegistrySpeed,
    getNpmRegistry: serverManagerMocks.getNpmRegistry,
    updateNpmRegistryInBackground: serverManagerMocks.updateNpmRegistryInBackground,
    loadRegistryFromCache: serverManagerMocks.loadRegistryFromCache,
    refreshNpmRegistry: serverManagerMocks.refreshNpmRegistry,
    getUvRegistry: serverManagerMocks.getUvRegistry
  }))
}))

vi.mock('../../../src/main/presenter/mcpPresenter/toolManager', () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    getAllToolDefinitions: toolManagerMocks.getAllToolDefinitions,
    getRunningClients: toolManagerMocks.getRunningClients
  }))
}))

vi.mock('../../../src/main/presenter/mcpPresenter/mcprouterManager', () => ({
  McpRouterManager: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    send: vi.fn(),
    sendToMain: vi.fn()
  }
}))

vi.mock('@/events', () => ({
  MCP_EVENTS: {
    SERVER_STARTED: 'server-started',
    SERVER_STOPPED: 'server-stopped',
    CONFIG_CHANGED: 'config-changed',
    SERVER_STATUS_CHANGED: 'server-status-changed',
    CLIENT_LIST_UPDATED: 'client-list-updated',
    INITIALIZED: 'initialized'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'show-error'
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {
    configPresenter: {}
  }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

import { eventBus } from '@/eventbus'
import { McpPresenter } from '../../../src/main/presenter/mcpPresenter'

describe('McpPresenter#setMcpServerEnabled', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    serverManagerMocks.startServer.mockResolvedValue(undefined)
    serverManagerMocks.stopServer.mockResolvedValue(undefined)
    serverManagerMocks.isServerRunning.mockReturnValue(false)
    serverManagerMocks.getRunningClients.mockResolvedValue([])
    serverManagerMocks.testNpmRegistrySpeed.mockResolvedValue('https://registry.npmjs.org/')
    serverManagerMocks.updateNpmRegistryInBackground.mockResolvedValue(undefined)
    serverManagerMocks.refreshNpmRegistry.mockResolvedValue('https://registry.npmjs.org/')
    toolManagerMocks.getAllToolDefinitions.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const createConfigPresenter = (
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
      getLanguage: vi.fn().mockReturnValue('en-US'),
      getPrivacyModeEnabled: vi.fn(() => privacyModeEnabled)
    }) as any

  it('starts a server immediately after enabling it when MCP is active', async () => {
    const configPresenter = createConfigPresenter(true)
    const presenter = new McpPresenter(configPresenter)
    const startSpy = vi.spyOn(presenter, 'startServer').mockResolvedValue(undefined)
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpServerEnabled('demo-server', true)

    expect(configPresenter.setMcpServerEnabled).toHaveBeenCalledWith('demo-server', true)
    expect(startSpy).toHaveBeenCalledWith('demo-server')
    expect(stopSpy).not.toHaveBeenCalled()
    expect(configPresenter.setMcpServerEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      startSpy.mock.invocationCallOrder[0]
    )
  })

  it('stops a server immediately after disabling it when MCP is active', async () => {
    const configPresenter = createConfigPresenter(true)
    const presenter = new McpPresenter(configPresenter)
    const startSpy = vi.spyOn(presenter, 'startServer').mockResolvedValue(undefined)
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpServerEnabled('demo-server', false)

    expect(configPresenter.setMcpServerEnabled).toHaveBeenCalledWith('demo-server', false)
    expect(stopSpy).toHaveBeenCalledWith('demo-server')
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('only persists config when MCP is globally disabled', async () => {
    const configPresenter = createConfigPresenter(false)
    const presenter = new McpPresenter(configPresenter)
    const startSpy = vi.spyOn(presenter, 'startServer').mockResolvedValue(undefined)
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpServerEnabled('demo-server', true)

    expect(configPresenter.setMcpServerEnabled).toHaveBeenCalledWith('demo-server', true)
    expect(startSpy).not.toHaveBeenCalled()
    expect(stopSpy).not.toHaveBeenCalled()
  })

  it('starts plugin-owned servers even when MCP is globally disabled', async () => {
    const configPresenter = createConfigPresenter(
      false,
      false,
      {
        regular: { enabled: true },
        plugin: { enabled: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' }
      },
      ['regular', 'plugin']
    )
    const presenter = new McpPresenter(configPresenter)
    ;(presenter as any).serverManager = {
      startServer: serverManagerMocks.startServer,
      testNpmRegistrySpeed: serverManagerMocks.testNpmRegistrySpeed,
      getNpmRegistry: serverManagerMocks.getNpmRegistry,
      updateNpmRegistryInBackground: serverManagerMocks.updateNpmRegistryInBackground
    }

    await presenter.initialize()

    expect(serverManagerMocks.startServer).toHaveBeenCalledTimes(1)
    expect(serverManagerMocks.startServer).toHaveBeenCalledWith('plugin')
  })

  it('does not start plugin-owned servers when enabling the global MCP switch', async () => {
    const configPresenter = createConfigPresenter(
      true,
      false,
      {
        regular: { enabled: true },
        plugin: { enabled: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' }
      },
      ['regular', 'plugin']
    )
    const presenter = new McpPresenter(configPresenter)
    const startSpy = vi.spyOn(presenter, 'startServer').mockResolvedValue(undefined)

    await presenter.setMcpEnabled(true)

    expect(configPresenter.setMcpEnabled).toHaveBeenCalledWith(true)
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(startSpy).toHaveBeenCalledWith('regular')
  })

  it('does not stop plugin-owned servers when disabling the global MCP switch', async () => {
    const configPresenter = createConfigPresenter(false, false, {
      regular: { enabled: true },
      plugin: { enabled: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' }
    })
    serverManagerMocks.getRunningClients.mockResolvedValue([
      { serverName: 'regular' },
      { serverName: 'plugin' }
    ])
    const presenter = new McpPresenter(configPresenter)
    ;(presenter as any).serverManager = {
      getRunningClients: serverManagerMocks.getRunningClients
    }
    const stopSpy = vi.spyOn(presenter, 'stopServer').mockResolvedValue(undefined)

    await presenter.setMcpEnabled(false)

    expect(configPresenter.setMcpEnabled).toHaveBeenCalledWith(false)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).toHaveBeenCalledWith('regular')
  })

  it('stops all running clients during shutdown and continues after stop failures', async () => {
    const configPresenter = createConfigPresenter(true)
    const presenter = new McpPresenter(configPresenter)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(presenter as any).serverManager = {
      getRunningClients: serverManagerMocks.getRunningClients,
      stopServer: serverManagerMocks.stopServer
    }
    serverManagerMocks.getRunningClients.mockResolvedValue([
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
    const configPresenter = createConfigPresenter(true)
    const presenter = new McpPresenter(configPresenter)
    ;(presenter as any).serverManager = {
      getRunningClients: serverManagerMocks.getRunningClients,
      stopServer: serverManagerMocks.stopServer
    }
    serverManagerMocks.getRunningClients
      .mockResolvedValueOnce([{ serverName: 'first' }])
      .mockResolvedValueOnce([])
    serverManagerMocks.stopServer.mockResolvedValue(undefined)

    await presenter.shutdown()
    await presenter.shutdown()

    expect(serverManagerMocks.getRunningClients).toHaveBeenCalledTimes(2)
    expect(serverManagerMocks.stopServer).toHaveBeenCalledTimes(1)
    expect(serverManagerMocks.stopServer).toHaveBeenCalledWith('first')
  })

  it('shares one in-flight shutdown across concurrent callers', async () => {
    const configPresenter = createConfigPresenter(true)
    const presenter = new McpPresenter(configPresenter)
    ;(presenter as any).serverManager = {
      getRunningClients: serverManagerMocks.getRunningClients,
      stopServer: serverManagerMocks.stopServer
    }
    let resolveStop: (() => void) | undefined
    serverManagerMocks.getRunningClients.mockResolvedValue([{ serverName: 'first' }])
    serverManagerMocks.stopServer.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve
        })
    )

    const firstShutdown = presenter.shutdown()
    const secondShutdown = presenter.shutdown()
    await Promise.resolve()

    expect(serverManagerMocks.getRunningClients).toHaveBeenCalledTimes(1)
    expect(serverManagerMocks.stopServer).toHaveBeenCalledTimes(1)

    resolveStop?.()
    await Promise.all([firstShutdown, secondShutdown])
  })

  it('keeps plugin-owned tool definitions available when MCP is globally disabled', async () => {
    const configPresenter = createConfigPresenter(false, false, {
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
    const presenter = new McpPresenter(configPresenter)
    ;(presenter as any).toolManager = {
      getAllToolDefinitions: toolManagerMocks.getAllToolDefinitions
    }

    const tools = await presenter.getAllToolDefinitions()

    expect(tools.map((tool) => tool.function.name)).toEqual(['plugin_tool'])
  })

  it('gates source plugin tools by plugin policy before server policy', async () => {
    const configPresenter = createConfigPresenter(true, false, {
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
    const presenter = new McpPresenter(configPresenter)
    ;(presenter as any).toolManager = {
      getAllToolDefinitions: toolManagerMocks.getAllToolDefinitions
    }

    const blockedTools = await presenter.getAllToolDefinitions({
      enabledServerIds: ['plugin'],
      enabledPluginIds: []
    })
    const allowedTools = await presenter.getAllToolDefinitions({
      enabledServerIds: [],
      enabledPluginIds: ['plugin-a']
    })

    expect(blockedTools).toEqual([])
    expect(allowedTools.map((tool) => tool.function.name)).toEqual(['plugin_tool'])
  })

  it('rejects when the runtime transition fails after persisting config', async () => {
    const configPresenter = createConfigPresenter(true)
    const presenter = new McpPresenter(configPresenter)
    const runtimeError = new Error('runtime failed')

    vi.spyOn(presenter, 'startServer').mockRejectedValue(runtimeError)

    await expect(presenter.setMcpServerEnabled('demo-server', true)).rejects.toThrow(
      'runtime failed'
    )
    expect(configPresenter.setMcpServerEnabled).toHaveBeenCalledWith('demo-server', true)
  })

  it('skips automatic npm registry probing in privacy mode and keeps manual refresh available', async () => {
    const configPresenter = createConfigPresenter(true, true)
    const presenter = new McpPresenter(configPresenter)
    ;(presenter as any).serverManager.refreshNpmRegistry = serverManagerMocks.refreshNpmRegistry

    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5000)

    expect(serverManagerMocks.testNpmRegistrySpeed).not.toHaveBeenCalled()
    expect(serverManagerMocks.updateNpmRegistryInBackground).not.toHaveBeenCalled()

    await presenter.refreshNpmRegistry()

    expect(serverManagerMocks.refreshNpmRegistry).toHaveBeenCalledTimes(1)
  })
})

describe('McpPresenter sampling events', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    serverManagerMocks.getRunningClients.mockResolvedValue([])
    toolManagerMocks.getAllToolDefinitions.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const createConfigPresenter = () =>
    ({
      getMcpEnabled: vi.fn().mockResolvedValue(true),
      getMcpServers: vi.fn().mockResolvedValue({}),
      getEnabledMcpServers: vi.fn().mockResolvedValue([]),
      getLanguage: vi.fn().mockReturnValue('en-US'),
      getPrivacyModeEnabled: vi.fn(() => false)
    }) as any

  it('publishes typed sampling request and decision events without raw renderer channels', async () => {
    const presenter = new McpPresenter(createConfigPresenter())
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
    const presenter = new McpPresenter(createConfigPresenter())
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
