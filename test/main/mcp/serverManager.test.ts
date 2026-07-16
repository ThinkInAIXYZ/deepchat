import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

const clientMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  isServerRunning: vi.fn(),
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
  McpClient: vi.fn().mockImplementation(() => ({
    connect: clientMocks.connect,
    disconnect: clientMocks.disconnect,
    isServerRunning: clientMocks.isServerRunning,
    getConnectionCompletion: clientMocks.getConnectionCompletion
  })),
  McpConnectionCancelledError: clientMocks.McpConnectionCancelledError
}))

import { ServerManager } from '@/mcp/serverManager'
import { McpClient, McpConnectionCancelledError } from '@/mcp/mcpClient'

describe('ServerManager plugin MCP errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.connect.mockResolvedValue(undefined)
    clientMocks.disconnect.mockResolvedValue(undefined)
    clientMocks.isServerRunning.mockReturnValue(true)
    clientMocks.getConnectionCompletion.mockReturnValue(null)
    vi.mocked(McpClient).mockImplementation(
      () =>
        ({
          connect: clientMocks.connect,
          disconnect: clientMocks.disconnect,
          isServerRunning: clientMocks.isServerRunning,
          getConnectionCompletion: clientMocks.getConnectionCompletion
        }) as never
    )
  })

  function createProviderSettings(servers: Record<string, any>) {
    return {
      getMcpServers: vi.fn().mockResolvedValue(servers),
      getLanguage: vi.fn().mockReturnValue('en-US'),
      getEffectiveNpmRegistry: vi.fn().mockReturnValue(null)
    }
  }

  it('suppresses global connection toasts for plugin-owned MCP servers', async () => {
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
    const manager = new ServerManager(
      { getLanguage: vi.fn().mockReturnValue('en-US') },
      providerSettings as never,
      { isEnabled: () => false },
      vi.fn() as never,
      {} as never,
      vi.fn(),
      publishDeepchatEventMock
    )
    clientMocks.connect.mockRejectedValueOnce(new Error('connect failed'))

    await expect(manager.startServer('plugin')).rejects.toThrow('connect failed')

    expect(manager.getServerLastError('plugin')).toBe('connect failed')
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })

  it('keeps global connection toasts for normal MCP servers', async () => {
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = new ServerManager(
      { getLanguage: vi.fn().mockReturnValue('en-US') },
      providerSettings as never,
      { isEnabled: () => false },
      vi.fn() as never,
      {} as never,
      vi.fn(),
      publishDeepchatEventMock
    )
    clientMocks.connect.mockRejectedValueOnce(new Error('connect failed'))

    await expect(manager.startServer('regular')).rejects.toThrow('connect failed')

    expect(manager.getServerLastError('regular')).toBe('connect failed')
    expect(publishDeepchatEventMock).toHaveBeenCalledTimes(1)
  })

  it('does not publish global errors when a background startup is cancelled', async () => {
    const providerSettings = createProviderSettings({
      regular: {
        command: 'regular-command',
        args: [],
        env: {},
        type: 'stdio'
      }
    })
    const manager = new ServerManager(
      { getLanguage: vi.fn().mockReturnValue('en-US') },
      providerSettings as never,
      { isEnabled: () => false },
      vi.fn() as never,
      {} as never,
      vi.fn(),
      publishDeepchatEventMock
    )
    clientMocks.connect.mockResolvedValueOnce('soft-timeout-released')
    clientMocks.getConnectionCompletion.mockReturnValueOnce(
      Promise.reject(new McpConnectionCancelledError('regular'))
    )

    await expect(manager.startServer('regular')).resolves.toBe('soft-timeout-released')
    await Promise.resolve()

    expect(manager.getServerLastError('regular')).toBeUndefined()
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })
})
