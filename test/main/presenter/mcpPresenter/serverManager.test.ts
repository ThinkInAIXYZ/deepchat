import { beforeEach, describe, expect, it, vi } from 'vitest'

const eventBusMocks = vi.hoisted(() => ({
  send: vi.fn(),
  sendToMain: vi.fn()
}))

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

const clientMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  isServerRunning: vi.fn()
}))

vi.mock('@/eventbus', () => ({
  eventBus: eventBusMocks
}))

vi.mock('@/events', () => ({
  MCP_EVENTS: {
    CLIENT_LIST_UPDATED: 'client-list-updated'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'show-error'
  }
}))

vi.mock('@/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn(() => '')
  }
}))

vi.mock('../../../../src/main/presenter/mcpPresenter/mcpClient', () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    connect: clientMocks.connect,
    disconnect: clientMocks.disconnect,
    isServerRunning: clientMocks.isServerRunning
  }))
}))

import { ServerManager } from '../../../../src/main/presenter/mcpPresenter/serverManager'
import { McpClient } from '../../../../src/main/presenter/mcpPresenter/mcpClient'

describe('ServerManager plugin MCP errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.connect.mockResolvedValue(undefined)
    clientMocks.disconnect.mockResolvedValue(undefined)
    clientMocks.isServerRunning.mockReturnValue(true)
    vi.mocked(McpClient).mockImplementation(
      () =>
        ({
          connect: clientMocks.connect,
          disconnect: clientMocks.disconnect,
          isServerRunning: clientMocks.isServerRunning
        }) as never
    )
  })

  function createConfigPresenter(servers: Record<string, any>) {
    return {
      getMcpServers: vi.fn().mockResolvedValue(servers),
      getLanguage: vi.fn().mockReturnValue('en-US'),
      getEffectiveNpmRegistry: vi.fn().mockReturnValue(null),
      getPrivacyModeEnabled: vi.fn().mockReturnValue(false)
    }
  }

  it('suppresses global connection toasts for plugin-owned MCP servers', async () => {
    const manager = new ServerManager(
      createConfigPresenter({
        plugin: {
          command: 'plugin-command',
          args: [],
          env: {},
          type: 'stdio',
          source: 'plugin',
          ownerPluginId: 'com.deepchat.fixture'
        }
      }) as never
    )
    clientMocks.connect.mockRejectedValueOnce(new Error('connect failed'))

    await expect(manager.startServer('plugin')).rejects.toThrow('connect failed')

    expect(manager.getServerLastError('plugin')).toBe('connect failed')
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })

  it('keeps global connection toasts for normal MCP servers', async () => {
    const manager = new ServerManager(
      createConfigPresenter({
        regular: {
          command: 'regular-command',
          args: [],
          env: {},
          type: 'stdio'
        }
      }) as never
    )
    clientMocks.connect.mockRejectedValueOnce(new Error('connect failed'))

    await expect(manager.startServer('regular')).rejects.toThrow('connect failed')

    expect(manager.getServerLastError('regular')).toBe('connect failed')
    expect(publishDeepchatEventMock).toHaveBeenCalledTimes(1)
  })
})
