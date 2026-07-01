import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const eventBusMocks = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  send: vi.fn()
}))

const presenterMocks = vi.hoisted(() => ({
  agentSessionPresenter: {
    getSession: vi.fn()
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: eventBusMocks
}))

vi.mock('@/events', () => ({
  MCP_EVENTS: {
    CLIENT_LIST_UPDATED: 'client-list-updated',
    CONFIG_CHANGED: 'config-changed'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'show-error'
  }
}))

vi.mock('@/presenter', () => ({
  presenter: presenterMocks
}))

import { ToolManager } from '../../../../src/main/presenter/mcpPresenter/toolManager'

describe('ToolManager', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function createClient(
    serverName: string,
    tools = [
      {
        name: 'echo',
        description: 'Echo tool',
        inputSchema: {
          properties: {},
          required: []
        }
      }
    ],
    serverConfig: Record<string, unknown> = {}
  ) {
    return {
      serverName,
      serverConfig: {
        icons: '',
        descriptions: '',
        ...serverConfig
      },
      listTools: vi.fn().mockResolvedValue(tools),
      callTool: vi.fn().mockResolvedValue({
        content: 'ok',
        isError: false
      })
    }
  }

  function createConfigPresenter(serverName: string) {
    return {
      getSetting: vi.fn(() => {
        throw new Error('input_chatMode should not be read')
      }),
      getMcpServers: vi.fn().mockResolvedValue({
        [serverName]: {
          autoApprove: ['all']
        }
      }),
      getAcpAgents: vi.fn().mockResolvedValue([]),
      getAgentMcpSelections: vi.fn().mockResolvedValue([]),
      getLanguage: vi.fn().mockReturnValue('en-US')
    }
  }

  function createServerManager(clients: unknown[]) {
    return {
      getRunningClients: vi.fn().mockResolvedValue(clients),
      setServerLastError: vi.fn(),
      clearServerLastError: vi.fn()
    }
  }

  it('leaves plugin runtime tool descriptions unchanged', async () => {
    const serverName = 'plugin-runtime'
    const client = createClient(serverName, [
      {
        name: 'list_apps',
        description: 'List apps original description',
        inputSchema: {
          properties: {},
          required: []
        }
      },
      {
        name: 'launch_app',
        description: 'Launch app original description',
        inputSchema: {
          properties: {},
          required: []
        }
      },
      {
        name: 'click',
        description: 'Click original description',
        inputSchema: {
          properties: {},
          required: []
        }
      }
    ])
    const configPresenter = createConfigPresenter(serverName)
    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const definitions = await manager.getAllToolDefinitions()
    const listApps = definitions.find((tool) => tool.function.name === 'list_apps')
    const launchApp = definitions.find((tool) => tool.function.name === 'launch_app')
    const click = definitions.find((tool) => tool.function.name === 'click')

    expect(listApps?.function.description).toBe('List apps original description')
    expect(launchApp?.function.description).toBe('Launch app original description')
    expect(click?.function.description).toBe('Click original description')
  })

  it('leaves regular tool descriptions unchanged', async () => {
    const client = createClient('regular-server', [
      {
        name: 'list_apps',
        description: 'Regular list apps description',
        inputSchema: {
          properties: {},
          required: []
        }
      },
      {
        name: 'launch_app',
        description: 'Regular launch app description',
        inputSchema: {
          properties: {},
          required: []
        }
      }
    ])
    const configPresenter = createConfigPresenter('regular-server')
    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const definitions = await manager.getAllToolDefinitions()

    expect(
      definitions.find((tool) => tool.function.name === 'list_apps')?.function.description
    ).toBe('Regular list apps description')
    expect(
      definitions.find((tool) => tool.function.name === 'launch_app')?.function.description
    ).toBe('Regular launch app description')
  })

  it('uses new session ACP context instead of global chat mode', async () => {
    const client = createClient('blocked-server')
    const configPresenter = createConfigPresenter('blocked-server')
    configPresenter.getAcpAgents.mockResolvedValue([{ id: 'agent-1', name: 'Agent 1' }])
    configPresenter.getAgentMcpSelections.mockResolvedValue([])

    presenterMocks.agentSessionPresenter.getSession.mockResolvedValue({
      id: 'session-1',
      agentId: 'agent-1',
      title: 'New Chat',
      projectDir: '/workspace/acp',
      isPinned: false,
      isDraft: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'idle',
      providerId: 'acp',
      modelId: 'agent-1'
    })

    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const result = await manager.callTool({
      id: 'tool-1',
      type: 'function',
      function: {
        name: 'echo',
        arguments: '{}'
      },
      conversationId: 'session-1',
      providerId: 'acp'
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain("MCP server 'blocked-server' is not allowed")
    expect(client.callTool).not.toHaveBeenCalled()
    expect(configPresenter.getSetting).not.toHaveBeenCalled()
    expect(configPresenter.getAgentMcpSelections).toHaveBeenCalledWith('agent-1')
  })

  it('filters DeepChat MCP tool definitions by enabled server and plugin policies', async () => {
    const normalClient = createClient('server-a')
    const blockedClient = createClient('server-b')
    const pluginClient = createClient('plugin-server', undefined, {
      source: 'plugin',
      ownerPluginId: 'plugin-a'
    })
    const configPresenter = createConfigPresenter('server-a')
    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([normalClient, blockedClient, pluginClient]) as never
    )

    const definitions = await manager.getAllToolDefinitions({
      agentId: 'agent-1',
      enabledServerIds: ['server-a'],
      enabledPluginIds: ['plugin-a']
    })

    expect(definitions.map((tool) => tool.server.name).sort()).toEqual([
      'plugin-server',
      'server-a'
    ])
  })

  it('gates source plugin MCP servers by plugin policy instead of server policy', async () => {
    const pluginClient = createClient('plugin-source-server', undefined, {
      source: 'plugin',
      sourceId: 'plugin-b'
    })
    const configPresenter = createConfigPresenter('plugin-source-server')
    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([pluginClient]) as never
    )

    const blockedDefinitions = await manager.getAllToolDefinitions({
      enabledServerIds: ['plugin-source-server'],
      enabledPluginIds: []
    })
    const allowedDefinitions = await manager.getAllToolDefinitions({
      enabledServerIds: [],
      enabledPluginIds: ['plugin-b']
    })

    expect(blockedDefinitions).toEqual([])
    expect(allowedDefinitions.map((tool) => tool.server.name)).toEqual(['plugin-source-server'])
  })

  it('blocks DeepChat MCP tool calls outside enabled server policy', async () => {
    const client = createClient('blocked-server')
    const configPresenter = createConfigPresenter('blocked-server')
    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const result = await manager.callTool(
      {
        id: 'tool-deepchat-blocked',
        type: 'function',
        function: {
          name: 'echo',
          arguments: '{}'
        },
        conversationId: 'session-deepchat',
        providerId: 'openai'
      },
      {
        agentId: 'agent-1',
        enabledServerIds: ['allowed-server']
      }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain("MCP server 'blocked-server' is not allowed")
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('records plugin tool-list failures without showing a global toast', async () => {
    const client = createClient('plugin-server', [], {
      source: 'plugin',
      ownerPluginId: 'com.deepchat.fixture'
    })
    client.listTools.mockRejectedValue(new Error('tool list failed'))
    const configPresenter = createConfigPresenter('plugin-server')
    const serverManager = createServerManager([client])
    const manager = new ToolManager(configPresenter as never, serverManager as never)

    const definitions = await manager.getAllToolDefinitions()

    expect(definitions).toEqual([])
    expect(serverManager.setServerLastError).toHaveBeenCalledWith(
      'plugin-server',
      'tool list failed'
    )
  })

  it('skips ACP session resolution when provider hint is non-ACP', async () => {
    const client = createClient('open-server')
    const configPresenter = createConfigPresenter('open-server')
    presenterMocks.agentSessionPresenter.getSession.mockResolvedValue(null)

    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const result = await manager.callTool({
      id: 'tool-2',
      type: 'function',
      function: {
        name: 'echo',
        arguments: '{}'
      },
      conversationId: 'conv-1',
      providerId: 'openai'
    })

    expect(result.isError).toBe(false)
    expect(result.content).toBe('ok')
    expect(client.callTool).toHaveBeenCalledWith('echo', {})
    expect(presenterMocks.agentSessionPresenter.getSession).not.toHaveBeenCalled()
    expect(configPresenter.getAgentMcpSelections).not.toHaveBeenCalled()
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes('Failed to resolve legacy session MCP context')
      )
    ).toBe(false)
  })

  it('skips ACP selection gating for non-ACP sessions', async () => {
    const client = createClient('open-server')
    const configPresenter = createConfigPresenter('open-server')

    presenterMocks.agentSessionPresenter.getSession.mockResolvedValue({
      id: 'session-2',
      agentId: 'deepchat',
      title: 'Normal Chat',
      projectDir: null,
      isPinned: false,
      isDraft: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4'
    })

    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const result = await manager.callTool({
      id: 'tool-3',
      type: 'function',
      function: {
        name: 'echo',
        arguments: '{}'
      },
      conversationId: 'session-2'
    })

    expect(result.isError).toBe(false)
    expect(result.content).toBe('ok')
    expect(client.callTool).toHaveBeenCalledWith('echo', {})
    expect(configPresenter.getAgentMcpSelections).not.toHaveBeenCalled()
  })

  it('normalizes CUA Windows launch bundle paths before dispatch', async () => {
    const client = createClient('cua-driver', [], {
      source: 'plugin',
      ownerPluginId: 'com.deepchat.plugins.cua'
    })
    const configPresenter = createConfigPresenter('cua-driver')
    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const prepared = await (manager as any).prepareCuaWindowsLaunchArgs(client, {
      bundle_id: 'C:\\Windows\\System32\\notepad.exe'
    })

    expect(prepared).toEqual({
      ok: true,
      args: {
        path: 'C:\\Windows\\System32\\notepad.exe'
      }
    })
  })

  it('fails CUA Windows launch quickly for unresolved macOS bundle ids', async () => {
    const client = createClient('cua-driver', [], {
      source: 'plugin',
      ownerPluginId: 'com.deepchat.plugins.cua'
    })
    client.callTool.mockResolvedValue({
      structuredContent: {
        apps: [
          {
            name: 'Notepad',
            aumid: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App'
          }
        ]
      },
      content: [],
      isError: false
    })
    const configPresenter = createConfigPresenter('cua-driver')
    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const prepared = await (manager as any).prepareCuaWindowsLaunchArgs(client, {
      bundle_id: 'com.apple.TextEdit'
    })

    expect(prepared.error).toContain("Windows app target 'com.apple.TextEdit' was not found")
    expect(client.callTool).toHaveBeenCalledWith('list_apps', {})
  })

  it('treats missing provider hint as a fallback to new session resolution', async () => {
    const client = createClient('open-server')
    const configPresenter = createConfigPresenter('open-server')
    presenterMocks.agentSessionPresenter.getSession.mockResolvedValue(null)

    const manager = new ToolManager(
      configPresenter as never,
      createServerManager([client]) as never
    )

    const result = await manager.callTool({
      id: 'tool-4',
      type: 'function',
      function: {
        name: 'echo',
        arguments: '{}'
      },
      conversationId: 'conv-fallback'
    })

    expect(result.isError).toBe(false)
    expect(result.content).toBe('ok')
    expect(client.callTool).toHaveBeenCalledWith('echo', {})
    expect(presenterMocks.agentSessionPresenter.getSession).toHaveBeenCalledWith('conv-fallback')
    expect(configPresenter.getAgentMcpSelections).not.toHaveBeenCalled()
  })
})
