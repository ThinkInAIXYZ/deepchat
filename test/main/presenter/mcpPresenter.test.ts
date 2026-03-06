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
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/events', () => ({
  MCP_EVENTS: {
    SERVER_STARTED: 'server-started',
    SERVER_STOPPED: 'server-stopped',
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

import { McpPresenter } from '../../../src/main/presenter/mcpPresenter'

describe('McpPresenter#setMcpServerEnabled', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    serverManagerMocks.startServer.mockResolvedValue(undefined)
    serverManagerMocks.stopServer.mockResolvedValue(undefined)
    serverManagerMocks.isServerRunning.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const createConfigPresenter = (mcpEnabled: boolean) =>
    ({
      setMcpServerEnabled: vi.fn().mockResolvedValue(undefined),
      getMcpEnabled: vi.fn().mockResolvedValue(mcpEnabled),
      getMcpServers: vi.fn().mockResolvedValue({}),
      getEnabledMcpServers: vi.fn().mockResolvedValue([]),
      getLanguage: vi.fn().mockReturnValue('en-US')
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
})
