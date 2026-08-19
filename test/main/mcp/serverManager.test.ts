import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const semanticNotificationsMock = vi.hoisted(() => ({
  occur: vi.fn(),
  recover: vi.fn()
}))

const clientMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  isActive: vi.fn(),
  isServerRunning: vi.fn(),
  getLifecycleStatus: vi.fn(),
  getConnectionCompletion: vi.fn(),
  McpConnectionCancelledError: class McpConnectionCancelledError extends Error {
    constructor(serverName: string) {
      super(`Connection to MCP server ${serverName} was cancelled`)
      this.name = 'McpConnectionCancelledError'
    }
  }
}))

vi.mock('@/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn(() => '')
  }
}))

vi.mock('@/mcp/mcpClient', () => ({
  McpClient: vi.fn().mockImplementation((_name, serverConfig) => ({
    connect: clientMocks.connect,
    disconnect: clientMocks.disconnect,
    isActive: clientMocks.isActive,
    isServerRunning: clientMocks.isServerRunning,
    getLifecycleStatus: clientMocks.getLifecycleStatus,
    serverConfig,
    getConnectionCompletion: clientMocks.getConnectionCompletion
  })),
  McpConnectionCancelledError: clientMocks.McpConnectionCancelledError
}))

import { ServerManager } from '@/mcp/serverManager'
import { McpClient, McpConnectionCancelledError } from '@/mcp/mcpClient'

describe('ServerManager notifications and plugin isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.connect.mockResolvedValue('connected')
    clientMocks.disconnect.mockResolvedValue(undefined)
    clientMocks.isActive.mockReturnValue(false)
    clientMocks.isServerRunning.mockReturnValue(true)
    clientMocks.getLifecycleStatus.mockReturnValue('ready')
    clientMocks.getConnectionCompletion.mockReturnValue(null)
    vi.mocked(McpClient).mockImplementation(
      (_name, serverConfig) =>
        ({
          connect: clientMocks.connect,
          disconnect: clientMocks.disconnect,
          isActive: clientMocks.isActive,
          isServerRunning: clientMocks.isServerRunning,
          getLifecycleStatus: clientMocks.getLifecycleStatus,
          serverConfig,
          getConnectionCompletion: clientMocks.getConnectionCompletion
        }) as never
    )
  })

  function createProviderSettings(servers: Record<string, any>) {
    return {
      getMcpServers: vi.fn().mockResolvedValue(servers),
      getEffectiveNpmRegistry: vi.fn().mockReturnValue(null)
    }
  }

  function createManager(providerSettings: ReturnType<typeof createProviderSettings>) {
    return new ServerManager(
      providerSettings as never,
      { isEnabled: () => false },
      vi.fn() as never,
      {} as never,
      vi.fn(),
      semanticNotificationsMock,
      publishDeepchatEventMock
    )
  }

  it('suppresses semantic connection occurrences for plugin-owned MCP servers', async () => {
    const providerSettings = createProviderSettings({
      plugin: {
        command: 'plugin-command',
        args: [],
        env: {},
        type: 'stdio',
        source: 'plugin',
        ownerPluginId: 'com.deepchat.fixture'
      }
    })
    const manager = createManager(providerSettings)
    clientMocks.connect.mockRejectedValueOnce(new Error('connect failed'))

    await expect(manager.startServer('plugin')).rejects.toThrow('connect failed')

    expect(manager.getServerLastError('plugin')).toBe('connect failed')
    expect(semanticNotificationsMock.occur).not.toHaveBeenCalled()
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })

  it('publishes a semantic connection occurrence for normal MCP servers', async () => {
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = createManager(providerSettings)
    clientMocks.connect.mockRejectedValueOnce(new Error('connect failed'))

    await expect(manager.startServer('regular')).rejects.toThrow('connect failed')

    expect(manager.getServerLastError('regular')).toBe('connect failed')
    expect(manager.getClient('regular')).toBeDefined()
    expect(semanticNotificationsMock.occur).toHaveBeenCalledWith({
      code: 'mcp.connectionFailed',
      serverName: 'regular'
    })
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })

  it('recovers the connection episode after a successful start', async () => {
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = createManager(providerSettings)

    await expect(manager.startServer('regular')).resolves.toBe('connected')

    expect(semanticNotificationsMock.recover).toHaveBeenCalledWith({
      code: 'mcp.connectionFailed',
      serverName: 'regular'
    })
  })

  it('replaces retained failed clients on a later manual start', async () => {
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = createManager(providerSettings)
    clientMocks.isServerRunning.mockReturnValue(false)
    clientMocks.connect.mockRejectedValueOnce(new Error('connect failed'))

    await expect(manager.startServer('regular')).rejects.toThrow('connect failed')
    await expect(manager.startServer('regular')).resolves.toBe('connected')

    expect(clientMocks.disconnect).toHaveBeenCalledOnce()
    expect(McpClient).toHaveBeenCalledTimes(2)
    expect(manager.getServerLastError('regular')).toBeUndefined()
  })

  it('recovers the connection episode only after a successful stop', async () => {
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = createManager(providerSettings)
    await manager.startServer('regular')
    semanticNotificationsMock.recover.mockClear()

    await manager.stopServer('regular')

    expect(semanticNotificationsMock.recover).toHaveBeenCalledWith({
      code: 'mcp.connectionFailed',
      serverName: 'regular'
    })

    await manager.startServer('regular')
    semanticNotificationsMock.recover.mockClear()
    clientMocks.disconnect.mockRejectedValueOnce(new Error('disconnect failed'))

    await expect(manager.stopServer('regular')).rejects.toThrow('disconnect failed')

    expect(semanticNotificationsMock.recover).not.toHaveBeenCalled()
  })

  it('does not publish a connection occurrence when background startup is cancelled', async () => {
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = createManager(providerSettings)
    let rejectConnection: (error: Error) => void = () => {}
    const connectionCompletion = new Promise<void>((_resolve, reject) => {
      rejectConnection = reject
    })
    clientMocks.getConnectionCompletion.mockReturnValue(connectionCompletion)
    clientMocks.connect.mockImplementationOnce(async () => {
      await Promise.resolve()
      clientMocks.getConnectionCompletion.mockReturnValue(null)
      return 'soft-timeout-released'
    })

    await expect(manager.startServer('regular')).resolves.toBe('soft-timeout-released')
    rejectConnection(new McpConnectionCancelledError('regular'))
    await Promise.resolve()

    expect(clientMocks.getConnectionCompletion).toHaveBeenCalledOnce()
    expect(manager.getServerLastError('regular')).toBeUndefined()
    expect(semanticNotificationsMock.occur).not.toHaveBeenCalled()
    expect(semanticNotificationsMock.recover).not.toHaveBeenCalled()
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })

  it('retains the background completion when the client clears its internal reference', async () => {
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = createManager(providerSettings)
    let resolveConnection = () => {}
    const connectionCompletion = new Promise<void>((resolve) => {
      resolveConnection = resolve
    })
    const onBackgroundConnected = vi.fn()
    clientMocks.getConnectionCompletion.mockReturnValue(connectionCompletion)
    clientMocks.connect.mockImplementationOnce(async () => {
      await Promise.resolve()
      clientMocks.getConnectionCompletion.mockReturnValue(null)
      return 'soft-timeout-released'
    })

    await expect(manager.startServer('regular', { onBackgroundConnected })).resolves.toBe(
      'soft-timeout-released'
    )
    resolveConnection()
    await connectionCompletion
    await Promise.resolve()

    expect(onBackgroundConnected).toHaveBeenCalledOnce()
    expect(semanticNotificationsMock.recover).toHaveBeenCalledWith({
      code: 'mcp.connectionFailed',
      serverName: 'regular'
    })
  })

  it('propagates supervised startup waiting into the client connection', async () => {
    const providerSettings = createProviderSettings({
      plugin: {
        command: 'plugin-command',
        args: [],
        env: {},
        type: 'stdio',
        ownerPluginId: 'com.deepchat.fixture'
      }
    })
    const manager = createManager(providerSettings)

    await expect(manager.startServer('plugin', { waitForConnection: true })).resolves.toBe(
      'connected'
    )

    expect(clientMocks.connect).toHaveBeenCalledWith({
      phase: 'startup',
      waitForConnection: true
    })
  })

  it('replaces an inactive client when a runtime supplies a fresh launch override', async () => {
    const persistedEnvironment = { LEGACY_SECRET: 'must-not-be-inherited' }
    const providerSettings = createProviderSettings({
      plugin: {
        command: 'persisted-command',
        args: ['persisted'],
        env: persistedEnvironment,
        type: 'stdio',
        ownerPluginId: 'com.deepchat.fixture'
      }
    })
    const manager = createManager(providerSettings)
    await manager.startServer('plugin')
    clientMocks.isServerRunning.mockReturnValue(false)
    clientMocks.isActive.mockReturnValue(false)

    await manager.startServer('plugin', {
      configOverride: {
        command: 'fresh-command',
        args: ['fresh'],
        env: { DEEPCHAT_PLUGIN_ID: 'com.deepchat.fixture' }
      },
      waitForConnection: true
    })

    expect(clientMocks.disconnect).toHaveBeenCalledOnce()
    expect(McpClient).toHaveBeenCalledTimes(2)
    expect(vi.mocked(McpClient).mock.calls[1][1]).toMatchObject({
      command: 'fresh-command',
      args: ['fresh'],
      env: { DEEPCHAT_PLUGIN_ID: 'com.deepchat.fixture' }
    })
    expect(vi.mocked(McpClient).mock.calls[1][1]).not.toMatchObject({
      env: persistedEnvironment
    })
  })

  it('reuses an in-flight start instead of creating a second client', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    providerSettings.getMcpServers.mockImplementation(async () => {
      await blocked
      return {
        regular: {
          command: 'regular-command',
          args: [],
          env: {},
          type: 'stdio'
        }
      }
    })
    const manager = createManager(providerSettings)
    const first = manager.startServer('regular')
    const second = manager.startServer('regular')
    expect(manager.isServerActive('regular')).toBe(true)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual(['connected', 'connected'])
    expect(McpClient).toHaveBeenCalledTimes(1)
    expect(clientMocks.connect).toHaveBeenCalledTimes(1)
  })

  it('clears in-flight tracking when stopServer runs before a client exists', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    providerSettings.getMcpServers.mockImplementation(async () => {
      await blocked
      return {
        regular: {
          command: 'regular-command',
          args: [],
          env: {},
          type: 'stdio'
        }
      }
    })
    const manager = createManager(providerSettings)
    const first = manager.startServer('regular')
    await Promise.resolve()
    expect(manager.isServerActive('regular')).toBe(true)
    const started = Date.now()
    await manager.stopServer('regular')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(manager.isServerActive('regular')).toBe(false)
    release()
    await expect(first).resolves.toBe('stopped')
  })

  it('returns from stop while an in-flight connect is hung', async () => {
    clientMocks.connect.mockImplementation(() => new Promise(() => {}))
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = createManager(providerSettings)
    void manager.startServer('regular')
    await vi.waitFor(() => {
      expect(clientMocks.connect).toHaveBeenCalled()
    })
    const started = Date.now()
    await manager.stopServer('regular')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(clientMocks.disconnect).toHaveBeenCalled()
    expect(manager.isServerActive('regular')).toBe(false)
  })

  it('does not leave a second client when stop races a pre-client start', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    providerSettings.getMcpServers.mockImplementation(async () => {
      await blocked
      return {
        regular: {
          command: 'regular-command',
          args: [],
          env: {},
          type: 'stdio'
        }
      }
    })
    const manager = createManager(providerSettings)
    const first = manager.startServer('regular')
    await Promise.resolve()
    const stopped = manager.stopServer('regular')
    const second = manager.startServer('regular')
    release()
    await expect(first).resolves.toBe('stopped')
    await stopped
    await expect(second).resolves.toBe('connected')
    expect(McpClient).toHaveBeenCalledTimes(1)
  })

  it('upgrades an in-flight soft-timeout start when a later caller waits', async () => {
    let releaseConnect!: (result: 'soft-timeout-released' | 'connected') => void
    clientMocks.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseConnect = resolve
        })
    )
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = createManager(providerSettings)
    const first = manager.startServer('regular')
    await Promise.resolve()
    const second = manager.startServer('regular', { waitForConnection: true })
    releaseConnect('soft-timeout-released')
    await expect(first).resolves.toBe('soft-timeout-released')
    releaseConnect('connected')
    await expect(second).resolves.toBe('connected')
    expect(clientMocks.connect).toHaveBeenLastCalledWith({
      phase: 'startup',
      waitForConnection: true
    })
  })

  it('does not reuse an in-flight configOverride start', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    providerSettings.getMcpServers.mockImplementation(async () => {
      await blocked
      return {
        regular: {
          command: 'regular-command',
          args: [],
          env: {},
          type: 'stdio'
        }
      }
    })
    const manager = createManager(providerSettings)
    const overridden = manager.startServer('regular', {
      configOverride: { command: 'plugin-command' }
    })
    const regular = manager.startServer('regular')
    release()
    await expect(Promise.all([overridden, regular])).resolves.toEqual(['connected', 'connected'])
    expect(McpClient).toHaveBeenCalledTimes(2)
    expect(vi.mocked(McpClient).mock.calls[0][1]).toMatchObject({ command: 'plugin-command' })
    expect(vi.mocked(McpClient).mock.calls[1][1]).toMatchObject({ command: 'regular-command' })
  })
})
