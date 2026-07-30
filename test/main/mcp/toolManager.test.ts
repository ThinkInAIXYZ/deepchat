import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CUA_PLUGIN_ID } from '@shared/types/plugin'
import { ToolManager, type ComputerUsePreviewObserver } from '@/mcp/toolManager'
import type { PluginRuntimeStartReason } from '@/plugin/runtimeSupervisor'
import * as toolPolicyStore from '@/plugin/toolPolicyStore'

const TOOL_POLICY_PLUGIN_ID = 'com.deepchat.plugins.permission-test'
const { registerPluginToolPolicy, unregisterPluginToolPolicies } = toolPolicyStore
const semanticNotifications = {
  occur: vi.fn(),
  recover: vi.fn()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('ToolManager', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    unregisterPluginToolPolicies(TOOL_POLICY_PLUGIN_ID)
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

  function createProviderSettings(serverName: string) {
    return {
      getSetting: vi.fn(() => {
        throw new Error('input_chatMode should not be read')
      }),
      getMcpServers: vi.fn().mockResolvedValue({
        [serverName]: {}
      }),
      getAcpAgents: vi.fn().mockResolvedValue([]),
      getAgentMcpSelections: vi.fn().mockResolvedValue([])
    }
  }

  function createServerManager(clients: unknown[]) {
    const clientsByName = new Map(
      clients.map((client) => {
        const namedClient = client as { serverName: string }
        return [namedClient.serverName, client]
      })
    )
    return {
      getRunningClients: vi.fn().mockResolvedValue(clients),
      getClient: vi.fn((serverName: string) => clientsByName.get(serverName)),
      setServerLastError: vi.fn(),
      clearServerLastError: vi.fn()
    }
  }

  function createToolManager(
    providerSettings: unknown,
    serverManager: unknown,
    pluginOwners: Record<string, string> = {},
    runtime: {
      catalogs?: Array<{
        pluginId: string
        serverName: string
        displayName: string
        toolCatalog: {
          version: string
          tools: Array<{
            name: string
            description: string
            inputSchema: Record<string, unknown>
          }>
        }
      }>
      ensureRunning?: (serverName: string, reason: PluginRuntimeStartReason) => Promise<void>
      unavailableServers?: Set<string>
    } = {},
    computerUsePreviewObserver?: ComputerUsePreviewObserver
  ) {
    return new ToolManager(
      providerSettings as never,
      providerSettings as never,
      serverManager as never,
      semanticNotifications,
      vi.fn(),
      {
        ownsServer: (serverName) => Object.hasOwn(pluginOwners, serverName),
        isServerAvailable: (serverName) =>
          Object.hasOwn(pluginOwners, serverName) && !runtime.unavailableServers?.has(serverName),
        getOwnerPluginId: (serverName) => pluginOwners[serverName],
        getAvailableToolCatalogs: () =>
          (runtime.catalogs ?? []).filter(
            (catalog) => !runtime.unavailableServers?.has(catalog.serverName)
          ),
        ensureRunning:
          runtime.ensureRunning ??
          (async (serverName) => {
            throw new Error(`Unexpected runtime start for ${serverName}`)
          })
      },
      computerUsePreviewObserver
    )
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
    const providerSettings = createProviderSettings(serverName)
    const manager = createToolManager(
      providerSettings as never,
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
    const providerSettings = createProviderSettings('regular-server')
    const manager = createToolManager(
      providerSettings as never,
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

  it('keeps MCP tools sequential even when the server declares readOnlyHint', async () => {
    const client = createClient('untrusted-server', [
      {
        name: 'inspect',
        description: 'Inspect remote state',
        inputSchema: { properties: {}, required: [] },
        annotations: { readOnlyHint: true }
      }
    ])
    const providerSettings = createProviderSettings('untrusted-server')
    const manager = createToolManager(
      providerSettings as never,
      createServerManager([client]) as never
    )

    const definitions = await manager.getAllToolDefinitions()

    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toMatchObject({
      execution: { effect: 'write', mode: 'sequential' }
    })
    expect(client.listTools).toHaveBeenCalledOnce()
  })

  it('discovers an on-demand catalog without starting its runtime and starts on first dispatch', async () => {
    const serverName = 'catalog-server'
    const liveClient = createClient(serverName, [
      {
        name: 'inspect_screen',
        description: 'Live inspect screen',
        inputSchema: { type: 'object', properties: {}, required: [] }
      }
    ])
    const serverManager = createServerManager([])
    serverManager.getClient.mockReturnValue(liveClient)
    const ensureRunning = vi.fn().mockResolvedValue(undefined)
    const providerSettings = createProviderSettings(serverName)
    const manager = createToolManager(
      providerSettings,
      serverManager,
      { [serverName]: 'com.deepchat.plugins.fixture' },
      {
        ensureRunning,
        catalogs: [
          {
            pluginId: 'com.deepchat.plugins.fixture',
            serverName,
            displayName: 'Catalog Server',
            toolCatalog: {
              version: '1.0.0',
              tools: [
                {
                  name: 'inspect_screen',
                  description: 'Static inspect screen',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                }
              ]
            }
          }
        ]
      }
    )

    const definitions = await manager.getAllToolDefinitions()

    expect(definitions).toEqual([
      expect.objectContaining({
        function: expect.objectContaining({
          name: 'inspect_screen',
          description: 'Static inspect screen'
        }),
        server: {
          name: serverName,
          icons: 'plugin',
          description: 'Catalog Server'
        }
      })
    ])
    expect(ensureRunning).not.toHaveBeenCalled()
    expect(liveClient.listTools).not.toHaveBeenCalled()

    const liveTools = deferred<Awaited<ReturnType<typeof liveClient.listTools>>>()
    liveClient.listTools.mockReturnValue(liveTools.promise)
    const firstCall = manager.callTool({
      id: 'catalog-tool-1',
      type: 'function',
      function: { name: 'inspect_screen', arguments: '{}' }
    })
    const secondCall = manager.callTool({
      id: 'catalog-tool-2',
      type: 'function',
      function: { name: 'inspect_screen', arguments: '{}' }
    })
    await vi.waitFor(() => expect(liveClient.listTools).toHaveBeenCalledOnce())
    liveTools.resolve([
      {
        name: 'inspect_screen',
        description: 'Live inspect screen',
        inputSchema: { type: 'object', properties: {}, required: [] }
      }
    ])
    const [first, second] = await Promise.all([firstCall, secondCall])

    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(ensureRunning).toHaveBeenCalledTimes(2)
    expect(ensureRunning).toHaveBeenNthCalledWith(1, serverName, 'tool')
    expect(liveClient.listTools).toHaveBeenCalledOnce()
    expect(liveClient.callTool).toHaveBeenCalledTimes(2)
  })

  it('hard-fails when a catalog tool is missing from the live runtime', async () => {
    const serverName = 'catalog-server'
    const liveClient = createClient(serverName, [
      {
        name: 'different_tool',
        description: 'Different tool',
        inputSchema: { type: 'object', properties: {}, required: [] }
      }
    ])
    const serverManager = createServerManager([])
    serverManager.getClient.mockReturnValue(liveClient)
    const manager = createToolManager(
      createProviderSettings(serverName),
      serverManager,
      { [serverName]: 'com.deepchat.plugins.fixture' },
      {
        ensureRunning: vi.fn().mockResolvedValue(undefined),
        catalogs: [
          {
            pluginId: 'com.deepchat.plugins.fixture',
            serverName,
            displayName: 'Catalog Server',
            toolCatalog: {
              version: '1.0.0',
              tools: [
                {
                  name: 'inspect_screen',
                  description: 'Static inspect screen',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                }
              ]
            }
          }
        ]
      }
    )

    const result = await manager.callTool({
      id: 'catalog-tool-missing',
      type: 'function',
      function: { name: 'inspect_screen', arguments: '{}' }
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Live MCP tool "inspect_screen" is missing')
    expect(liveClient.callTool).not.toHaveBeenCalled()
    expect(serverManager.setServerLastError).toHaveBeenCalledWith(
      serverName,
      expect.stringContaining('missing')
    )
  })

  it('fails closed for tools absent from an enabled plugin policy', async () => {
    const serverName = 'closed-policy-server'
    const client = createClient(serverName, [
      {
        name: 'known_tool',
        description: 'Known tool',
        inputSchema: { type: 'object', properties: {}, required: [] }
      },
      {
        name: 'new_upstream_tool',
        description: 'Unexpected upstream tool',
        inputSchema: { type: 'object', properties: {}, required: [] }
      }
    ])
    registerPluginToolPolicy({
      pluginId: TOOL_POLICY_PLUGIN_ID,
      serverId: serverName,
      tools: { known_tool: 'allow' },
      enabled: true
    })
    const manager = createToolManager(
      createProviderSettings(serverName),
      createServerManager([client]),
      { [serverName]: TOOL_POLICY_PLUGIN_ID }
    )

    const result = await manager.callTool({
      id: 'unknown-policy-tool',
      type: 'function',
      function: { name: 'new_upstream_tool', arguments: '{}' },
      conversationId: 'closed-policy-conversation'
    })

    expect(result).toMatchObject({
      isError: true,
      content: expect.stringContaining('not declared by its closed plugin policy')
    })
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('does not advertise explicitly denied plugin catalog tools', async () => {
    const serverName = 'closed-policy-server'
    registerPluginToolPolicy({
      pluginId: TOOL_POLICY_PLUGIN_ID,
      serverId: serverName,
      tools: {
        known_tool: 'allow',
        internal_diagnostic: 'deny'
      },
      enabled: true
    })
    const manager = createToolManager(
      createProviderSettings(serverName),
      createServerManager([]),
      { [serverName]: TOOL_POLICY_PLUGIN_ID },
      {
        catalogs: [
          {
            pluginId: TOOL_POLICY_PLUGIN_ID,
            serverName,
            displayName: 'Closed Policy Server',
            toolCatalog: {
              version: '1.0.0',
              tools: [
                {
                  name: 'known_tool',
                  description: 'Known tool',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                },
                {
                  name: 'internal_diagnostic',
                  description: 'Internal diagnostic',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                }
              ]
            }
          }
        ]
      }
    )

    const definitions = await manager.getAllToolDefinitions()

    expect(definitions.map((definition) => definition.function.name)).toEqual(['known_tool'])
  })

  it('hard-fails when a live catalog tool schema drifts', async () => {
    const serverName = 'catalog-server'
    const liveClient = createClient(serverName, [
      {
        name: 'inspect_screen',
        description: 'Live inspect screen',
        inputSchema: {
          type: 'object',
          properties: { display_id: { type: 'integer' } },
          required: ['display_id']
        }
      }
    ])
    const serverManager = createServerManager([])
    serverManager.getClient.mockReturnValue(liveClient)
    const manager = createToolManager(
      createProviderSettings(serverName),
      serverManager,
      { [serverName]: TOOL_POLICY_PLUGIN_ID },
      {
        ensureRunning: vi.fn().mockResolvedValue(undefined),
        catalogs: [
          {
            pluginId: TOOL_POLICY_PLUGIN_ID,
            serverName,
            displayName: 'Catalog Server',
            toolCatalog: {
              version: '1.0.0',
              tools: [
                {
                  name: 'inspect_screen',
                  description: 'Static inspect screen',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                }
              ]
            }
          }
        ]
      }
    )

    const result = await manager.callTool({
      id: 'catalog-schema-drift',
      type: 'function',
      function: { name: 'inspect_screen', arguments: '{}' }
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('schema differs from the packaged catalog')
    expect(liveClient.callTool).not.toHaveBeenCalled()
  })

  it('records duplicate live catalog tools as a server error', async () => {
    const serverName = 'catalog-server'
    const duplicateTool = {
      name: 'inspect_screen',
      description: 'Inspect screen',
      inputSchema: { type: 'object', properties: {}, required: [] }
    }
    const liveClient = createClient(serverName, [duplicateTool, duplicateTool])
    const serverManager = createServerManager([])
    serverManager.getClient.mockReturnValue(liveClient)
    const manager = createToolManager(
      createProviderSettings(serverName),
      serverManager,
      { [serverName]: TOOL_POLICY_PLUGIN_ID },
      {
        ensureRunning: vi.fn().mockResolvedValue(undefined),
        catalogs: [
          {
            pluginId: TOOL_POLICY_PLUGIN_ID,
            serverName,
            displayName: 'Catalog Server',
            toolCatalog: {
              version: '1.0.0',
              tools: [duplicateTool]
            }
          }
        ]
      }
    )

    const result = await manager.callTool({
      id: 'catalog-duplicate-tool',
      type: 'function',
      function: { name: 'inspect_screen', arguments: '{}' }
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('returned duplicate tool "inspect_screen"')
    expect(liveClient.callTool).not.toHaveBeenCalled()
    expect(serverManager.setServerLastError).toHaveBeenCalledWith(
      serverName,
      expect.objectContaining({
        message: expect.stringContaining('returned duplicate tool "inspect_screen"')
      })
    )
  })

  it('runs permission diagnostics only through the owned runtime gate', async () => {
    const serverName = 'catalog-server'
    const liveClient = createClient(serverName, [
      {
        name: 'check_permissions',
        description: 'Check permissions',
        inputSchema: { type: 'object', properties: {}, required: [] }
      }
    ])
    liveClient.callTool.mockResolvedValue({
      structuredContent: { accessibility: true, screen_recording: false },
      content: [],
      isError: false
    })
    const serverManager = createServerManager([])
    serverManager.getClient.mockReturnValue(liveClient)
    const ensureRunning = vi.fn().mockResolvedValue(undefined)
    const manager = createToolManager(
      createProviderSettings(serverName),
      serverManager,
      { [serverName]: 'com.deepchat.plugins.cua' },
      {
        ensureRunning,
        catalogs: [
          {
            pluginId: 'com.deepchat.plugins.cua',
            serverName,
            displayName: 'CUA Driver',
            toolCatalog: {
              version: '0.14.1',
              tools: [
                {
                  name: 'check_permissions',
                  description: 'Check permissions',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                }
              ]
            }
          }
        ]
      }
    )

    await expect(manager.checkPluginRuntimePermissions(serverName)).resolves.toMatchObject({
      structuredContent: { accessibility: true, screen_recording: false }
    })
    expect(ensureRunning).toHaveBeenCalledWith(serverName, 'runtime-test')
    expect(liveClient.listTools).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal)
    })
    expect(liveClient.callTool).toHaveBeenCalledWith(
      'check_permissions',
      { prompt: false },
      { signal: expect.any(AbortSignal) }
    )

    const unowned = createToolManager(
      createProviderSettings('manual-server'),
      createServerManager([])
    )
    await expect(unowned.checkPluginRuntimePermissions('manual-server')).rejects.toThrow(
      'is not owned by a plugin runtime'
    )
  })

  it('uses the same conflict rename for static and live tool definitions', async () => {
    const liveClient = createClient('live-server')
    const manager = createToolManager(
      createProviderSettings('live-server'),
      createServerManager([liveClient]),
      { 'catalog-server': 'com.deepchat.plugins.fixture' },
      {
        catalogs: [
          {
            pluginId: 'com.deepchat.plugins.fixture',
            serverName: 'catalog-server',
            displayName: 'Catalog Server',
            toolCatalog: {
              version: '1.0.0',
              tools: [
                {
                  name: 'echo',
                  description: 'Catalog echo',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                }
              ]
            }
          }
        ]
      }
    )

    const definitions = await manager.getAllToolDefinitions()

    expect(definitions.map((definition) => definition.function.name)).toEqual([
      'live-server_echo',
      'catalog-server_echo'
    ])
    expect(liveClient.listTools).toHaveBeenCalledOnce()
  })

  it('fails closed when a catalog runtime becomes unavailable before dispatch', async () => {
    const serverName = 'quarantined-catalog-server'
    const unavailableServers = new Set<string>()
    const liveClient = createClient(serverName, [
      {
        name: 'inspect_screen',
        description: 'Inspect screen',
        inputSchema: { type: 'object', properties: {}, required: [] }
      }
    ])
    const serverManager = createServerManager([])
    serverManager.getClient.mockReturnValue(liveClient)
    const ensureRunning = vi.fn().mockResolvedValue(undefined)
    const manager = createToolManager(
      createProviderSettings(serverName),
      serverManager,
      { [serverName]: 'com.deepchat.plugins.fixture' },
      {
        unavailableServers,
        ensureRunning,
        catalogs: [
          {
            pluginId: 'com.deepchat.plugins.fixture',
            serverName,
            displayName: 'Quarantined Catalog Server',
            toolCatalog: {
              version: '1.0.0',
              tools: [
                {
                  name: 'inspect_screen',
                  description: 'Inspect screen',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                }
              ]
            }
          }
        ]
      }
    )
    const [definition] = await manager.getAllToolDefinitions()
    unavailableServers.add(serverName)

    const response = await manager.callTool({
      id: 'call-1',
      conversationId: 'conversation-1',
      type: 'function',
      function: {
        name: definition.function.name,
        arguments: '{}'
      }
    })

    expect(response).toMatchObject({
      isError: true,
      content: expect.stringContaining('is no longer available')
    })
    expect(ensureRunning).toHaveBeenCalledWith(serverName, 'tool')
    expect(liveClient.callTool).not.toHaveBeenCalled()
  })

  it('does not advertise tools from an unavailable owned runtime client', async () => {
    const serverName = 'quarantined-live-server'
    const liveClient = createClient(serverName)
    const manager = createToolManager(
      createProviderSettings(serverName),
      createServerManager([liveClient]),
      { [serverName]: 'com.deepchat.plugins.fixture' },
      { unavailableServers: new Set([serverName]) }
    )

    await expect(manager.getAllToolDefinitions()).resolves.toEqual([])

    expect(liveClient.listTools).not.toHaveBeenCalled()
  })

  it('uses explicit ACP agent context instead of global chat mode', async () => {
    const client = createClient('blocked-server')
    const providerSettings = createProviderSettings('blocked-server')
    providerSettings.getAcpAgents.mockResolvedValue([{ id: 'agent-1', name: 'Agent 1' }])
    providerSettings.getAgentMcpSelections.mockResolvedValue([])

    const manager = createToolManager(
      providerSettings as never,
      createServerManager([client]) as never
    )

    const result = await manager.callTool(
      {
        id: 'tool-1',
        type: 'function',
        function: {
          name: 'echo',
          arguments: '{}'
        },
        conversationId: 'session-1',
        providerId: 'acp'
      },
      { agentId: 'agent-1' }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain("MCP server 'blocked-server' is not allowed")
    expect(client.callTool).not.toHaveBeenCalled()
    expect(providerSettings.getSetting).not.toHaveBeenCalled()
    expect(providerSettings.getAgentMcpSelections).toHaveBeenCalledWith('agent-1')
  })

  it('filters normal MCP definitions while keeping plugin-owned definitions available', async () => {
    const normalClient = createClient('server-a')
    const blockedClient = createClient('server-b')
    const pluginClient = createClient('plugin-server', undefined, {
      source: 'plugin',
      ownerPluginId: 'plugin-a'
    })
    const providerSettings = createProviderSettings('server-a')
    const manager = createToolManager(
      providerSettings as never,
      createServerManager([normalClient, blockedClient, pluginClient]) as never,
      { 'plugin-server': 'plugin-a' }
    )

    const definitions = await manager.getAllToolDefinitions({
      agentId: 'agent-1',
      enabledServerIds: ['server-a']
    })

    expect(definitions.map((tool) => tool.server.name).sort()).toEqual([
      'plugin-server',
      'server-a'
    ])
  })

  it('does not trust source plugin metadata as lifecycle ownership', async () => {
    const pluginClient = createClient('plugin-source-server', undefined, {
      source: 'plugin',
      sourceId: 'plugin-b'
    })
    const providerSettings = createProviderSettings('plugin-source-server')
    providerSettings.getMcpServers.mockResolvedValue({
      'plugin-source-server': {
        source: 'plugin',
        sourceId: 'plugin-b'
      }
    })
    const manager = createToolManager(
      providerSettings as never,
      createServerManager([pluginClient]) as never
    )

    const definitions = await manager.getAllToolDefinitions({ enabledServerIds: [] })
    const result = await manager.callTool(
      {
        id: 'plugin-tool',
        type: 'function',
        function: {
          name: 'echo',
          arguments: '{}'
        },
        conversationId: 'deepchat-session',
        providerId: 'openai'
      },
      {
        agentId: 'deepchat',
        enabledServerIds: []
      }
    )

    expect(definitions).toEqual([])
    expect(result.isError).toBe(true)
    expect(result.content).toContain("MCP server 'plugin-source-server' is not allowed")
    expect(pluginClient.callTool).not.toHaveBeenCalled()
  })

  it('blocks DeepChat MCP tool calls outside enabled server policy', async () => {
    const client = createClient('blocked-server')
    const providerSettings = createProviderSettings('blocked-server')
    const manager = createToolManager(
      providerSettings as never,
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

  it('records plugin tool-list failures without publishing a semantic occurrence', async () => {
    const client = createClient('plugin-server', [], {
      source: 'plugin',
      ownerPluginId: 'com.deepchat.fixture'
    })
    client.listTools.mockRejectedValue(new Error('tool list failed'))
    const providerSettings = createProviderSettings('plugin-server')
    const serverManager = createServerManager([client])
    const manager = createToolManager(providerSettings as never, serverManager as never, {
      'plugin-server': 'com.deepchat.fixture'
    })

    const definitions = await manager.getAllToolDefinitions()

    expect(definitions).toEqual([])
    expect(serverManager.setServerLastError).toHaveBeenCalledWith(
      'plugin-server',
      'tool list failed'
    )
    expect(semanticNotifications.occur).not.toHaveBeenCalled()
  })

  it('publishes and recovers semantic tool-list episodes for regular servers', async () => {
    const client = createClient('regular-server')
    const providerSettings = createProviderSettings('regular-server')
    const serverManager = createServerManager([client])
    const manager = createToolManager(providerSettings as never, serverManager as never)
    client.listTools.mockRejectedValueOnce(new Error('tool list failed'))

    await expect(manager.getAllToolDefinitions()).resolves.toEqual([])

    expect(semanticNotifications.occur).toHaveBeenCalledWith({
      code: 'mcp.toolListFailed',
      serverName: 'regular-server'
    })

    manager.invalidateRegistry()
    await expect(manager.getAllToolDefinitions()).resolves.toHaveLength(1)

    expect(semanticNotifications.recover).toHaveBeenCalledWith({
      code: 'mcp.toolListFailed',
      serverName: 'regular-server'
    })
  })

  it('skips ACP access checks when provider hint is non-ACP', async () => {
    const client = createClient('open-server')
    const providerSettings = createProviderSettings('open-server')

    const manager = createToolManager(
      providerSettings as never,
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
    expect(client.callTool).toHaveBeenCalledWith(
      'echo',
      {},
      expect.objectContaining({
        toolDefinition: expect.objectContaining({ name: 'echo' })
      })
    )
    expect(providerSettings.getAgentMcpSelections).not.toHaveBeenCalled()
  })

  it('forwards the caller abort signal to the selected MCP client', async () => {
    const client = createClient('open-server')
    client.callTool.mockImplementation(
      (_name: string, _args: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          const signal = options?.signal
          if (!signal) {
            reject(new Error('Missing abort signal'))
            return
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const providerSettings = createProviderSettings('open-server')
    const manager = createToolManager(
      providerSettings as never,
      createServerManager([client]) as never
    )
    const abortController = new AbortController()

    const callPromise = manager.callTool(
      {
        id: 'tool-cancellable',
        type: 'function',
        function: {
          name: 'echo',
          arguments: '{}'
        },
        conversationId: 'conv-cancellable',
        providerId: 'openai'
      },
      { signal: abortController.signal }
    )

    await vi.waitFor(() => {
      expect(client.callTool).toHaveBeenCalledWith(
        'echo',
        {},
        expect.objectContaining({
          signal: abortController.signal,
          toolDefinition: expect.objectContaining({ name: 'echo' })
        })
      )
    })
    abortController.abort()

    await expect(callPromise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects promptly when cancellation lands during tool-definition refresh', async () => {
    const client = createClient('open-server')
    const providerSettings = createProviderSettings('open-server')
    const manager = createToolManager(
      providerSettings as never,
      createServerManager([client]) as never
    )
    const definitions = deferred<Awaited<ReturnType<ToolManager['getAllToolDefinitions']>>>()
    const loadDefinitions = vi
      .spyOn(manager, 'getAllToolDefinitions')
      .mockReturnValue(definitions.promise)
    const abortController = new AbortController()

    const callPromise = manager.callTool(
      {
        id: 'tool-preflight-cancel',
        type: 'function',
        function: { name: 'echo', arguments: '{}' },
        conversationId: 'conv-preflight-cancel',
        providerId: 'openai'
      },
      { signal: abortController.signal }
    )
    await vi.waitFor(() => expect(loadDefinitions).toHaveBeenCalledOnce())

    abortController.abort()

    await expect(callPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.callTool).not.toHaveBeenCalled()
    definitions.resolve([])
  })

  it('does not commit tool definitions after their refresh is cancelled', async () => {
    const client = createClient('stale-server')
    const tools = deferred<Awaited<ReturnType<typeof client.listTools>>>()
    client.listTools.mockReturnValue(tools.promise)
    const manager = createToolManager(
      createProviderSettings('stale-server') as never,
      createServerManager([client]) as never
    )
    const abortController = new AbortController()

    const refresh = manager.getAllToolDefinitions(undefined, {
      signal: abortController.signal
    })
    await vi.waitFor(() => expect(client.listTools).toHaveBeenCalledOnce())

    abortController.abort()

    await expect(refresh).rejects.toMatchObject({ name: 'AbortError' })
    tools.resolve([
      {
        name: 'stale_tool',
        description: 'Stale tool',
        inputSchema: { properties: {}, required: [] }
      }
    ])
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect((manager as any).cachedToolDefinitions).toBeNull()
    expect((manager as any).toolNameToTargetMap).toBeNull()
  })

  it('discards a refresh superseded by a configuration cache clear', async () => {
    const staleClient = createClient('stale-server')
    const currentClient = createClient('current-server', [
      {
        name: 'current_tool',
        description: 'Current tool',
        inputSchema: { properties: {}, required: [] }
      }
    ])
    const staleTools = deferred<Awaited<ReturnType<typeof staleClient.listTools>>>()
    staleClient.listTools.mockReturnValueOnce(staleTools.promise).mockResolvedValueOnce([
      {
        name: 'stale_tool',
        description: 'Stale tool',
        inputSchema: { properties: {}, required: [] }
      }
    ])
    const serverManager = createServerManager([staleClient])
    const manager = createToolManager(
      createProviderSettings('current-server') as never,
      serverManager as never
    )

    const refresh = manager.getAllToolDefinitions()
    await vi.waitFor(() => expect(staleClient.listTools).toHaveBeenCalledOnce())
    manager.invalidateRegistry()
    serverManager.getRunningClients.mockResolvedValue([currentClient])
    staleTools.resolve([
      {
        name: 'stale_tool',
        description: 'Stale tool',
        inputSchema: { properties: {}, required: [] }
      }
    ])

    const definitions = await refresh

    expect(definitions.map((definition) => definition.function.name)).toEqual(['current_tool'])
    expect((manager as any).toolNameToTargetMap.has('current_tool')).toBe(true)
    expect((manager as any).toolNameToTargetMap.has('stale_tool')).toBe(false)
  })

  it('cancels dispatch when the authorized server binding changes', async () => {
    const serverName = 'bound-server'
    const client = createClient(serverName)
    const providerSettings = createProviderSettings(serverName)
    const originalConfig = {
      serverId: '11111111-1111-4111-8111-111111111111',
      configGeneration: 1,
      bindingHash: 'binding-a'
    }
    providerSettings.getMcpServers.mockResolvedValue({
      [serverName]: originalConfig
    })
    const manager = createToolManager(providerSettings, createServerManager([client]))
    const [definition] = await manager.getAllToolDefinitions()

    providerSettings.getMcpServers.mockResolvedValue({
      [serverName]: {
        ...originalConfig,
        configGeneration: 2,
        bindingHash: 'binding-b'
      }
    })
    const result = await manager.callTool(
      {
        id: 'bound-call',
        type: 'function',
        function: { name: 'echo', arguments: '{}' }
      },
      {
        expectedTarget: {
          finalName: definition.function.name,
          serverName: definition.server.name,
          serverId: definition.server.id!,
          configGeneration: definition.server.configGeneration!,
          bindingHash: definition.server.bindingHash!,
          originalName: definition.raw!.name
        }
      }
    )

    expect(result).toMatchObject({
      isError: true,
      content: expect.stringContaining('server binding changed before dispatch')
    })
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('wakes refresh waiters when configuration invalidates a blocked refresh', async () => {
    const staleClient = createClient('stale-server')
    const currentClient = createClient('current-server', [
      {
        name: 'current_tool',
        description: 'Current tool',
        inputSchema: { properties: {}, required: [] }
      }
    ])
    const staleTools = deferred<Awaited<ReturnType<typeof staleClient.listTools>>>()
    staleClient.listTools.mockReturnValue(staleTools.promise)
    const serverManager = createServerManager([staleClient])
    const manager = createToolManager(
      createProviderSettings('current-server') as never,
      serverManager as never
    )

    const blockedRefresh = manager.getAllToolDefinitions()
    await vi.waitFor(() => expect(staleClient.listTools).toHaveBeenCalledOnce())
    const waitingRefresh = manager.getAllToolDefinitions()

    serverManager.getRunningClients.mockResolvedValue([currentClient])
    manager.invalidateRegistry()

    await expect(waitingRefresh).resolves.toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: 'current_tool' }) })
    ])
    expect(currentClient.listTools).toHaveBeenCalled()

    staleTools.resolve([])
    await expect(blockedRefresh).resolves.toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: 'current_tool' }) })
    ])
  })

  it('observes a definition failure after refresh synchronously cancels the call', async () => {
    const client = createClient('open-server')
    const manager = createToolManager(
      createProviderSettings('open-server') as never,
      createServerManager([client]) as never
    )
    const definitions = deferred<Awaited<ReturnType<ToolManager['getAllToolDefinitions']>>>()
    const abortController = new AbortController()
    const lateError = new Error('late definition failure')
    const unhandled = vi.fn()
    vi.spyOn(manager, 'getAllToolDefinitions').mockImplementation(() => {
      abortController.abort()
      return definitions.promise
    })

    await expect(
      manager.callTool(
        {
          id: 'tool-sync-cancel',
          type: 'function',
          function: { name: 'echo', arguments: '{}' },
          providerId: 'openai'
        },
        { signal: abortController.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.callTool).not.toHaveBeenCalled()

    process.on('unhandledRejection', unhandled)
    try {
      definitions.reject(lateError)
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('does not start tool-definition refresh for a pre-cancelled call', async () => {
    const client = createClient('open-server')
    const manager = createToolManager(
      createProviderSettings('open-server') as never,
      createServerManager([client]) as never
    )
    const loadDefinitions = vi.spyOn(manager, 'getAllToolDefinitions')
    const abortController = new AbortController()
    abortController.abort()

    await expect(
      manager.callTool(
        {
          id: 'tool-pre-cancelled',
          type: 'function',
          function: { name: 'echo', arguments: '{}' },
          providerId: 'openai'
        },
        { signal: abortController.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(loadDefinitions).not.toHaveBeenCalled()
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('skips ACP selection gating for non-ACP sessions', async () => {
    const client = createClient('open-server')
    const providerSettings = createProviderSettings('open-server')

    const manager = createToolManager(
      providerSettings as never,
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
    expect(client.callTool).toHaveBeenCalledWith(
      'echo',
      {},
      expect.objectContaining({
        toolDefinition: expect.objectContaining({ name: 'echo' })
      })
    )
    expect(providerSettings.getAgentMcpSelections).not.toHaveBeenCalled()
  })

  it('normalizes empty CUA element tokens immediately before dispatch', async () => {
    const client = createClient(
      'cua-driver',
      [
        {
          name: 'click',
          description: 'Click',
          inputSchema: {
            type: 'object',
            properties: {
              element_index: { type: 'integer' },
              element_token: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' }
            }
          }
        }
      ],
      {
        source: 'plugin',
        ownerPluginId: CUA_PLUGIN_ID
      }
    )
    const manager = createToolManager(
      createProviderSettings('cua-driver'),
      createServerManager([client]),
      { 'cua-driver': CUA_PLUGIN_ID },
      { ensureRunning: vi.fn().mockResolvedValue(undefined) }
    )

    const result = await manager.callTool({
      id: 'cua-click',
      type: 'function',
      function: {
        name: 'click',
        arguments:
          '{"element_index":2,"element_token":"","x":0,"y":0,"modifier":[],"from_zoom":false}'
      }
    })

    expect(result.isError).toBe(false)
    expect(client.callTool).toHaveBeenCalledWith(
      'click',
      {
        element_index: 2,
        x: 0,
        y: 0,
        modifier: [],
        from_zoom: false
      },
      expect.objectContaining({
        toolDefinition: expect.objectContaining({ name: 'click' })
      })
    )
  })

  it('preserves raw CUA structured content and appends reviewed projections', async () => {
    const client = createClient(
      'cua-driver',
      [
        {
          name: 'get_window_state',
          description: 'Get window state',
          inputSchema: {
            type: 'object',
            properties: {
              pid: { type: 'integer' },
              window_id: { type: 'integer' }
            }
          }
        }
      ],
      {
        source: 'plugin',
        ownerPluginId: CUA_PLUGIN_ID
      }
    )
    const structuredContent = {
      snapshot_id: 's9',
      tree_markdown: '- AXButton "Clear" [element_index 2]',
      elements: [
        {
          element_index: 2,
          element_token: '00000002',
          role: 'AXButton',
          label: 'Clear'
        }
      ],
      capture_coverage: {
        browser_chrome: {
          status: 'not_observable_in_window_scope'
        },
        recovery: {
          when: 'verified_window_action_ineffective',
          escalate: {
            tool: 'escalate_session',
            reason: 'foreground_ineffective'
          },
          inspect: 'get_desktop_state',
          act_scope: 'desktop',
          verify: 'get_desktop_state'
        }
      }
    }
    client.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'window tree' }],
      structuredContent,
      isError: false
    })
    const manager = createToolManager(
      createProviderSettings('cua-driver'),
      createServerManager([client]),
      { 'cua-driver': CUA_PLUGIN_ID },
      { ensureRunning: vi.fn().mockResolvedValue(undefined) }
    )

    const result = await manager.callTool({
      id: 'cua-window-state',
      type: 'function',
      function: {
        name: 'get_window_state',
        arguments: '{"pid":10,"window_id":20}'
      }
    })

    expect(result.structuredContent).toBe(structuredContent)
    expect(result.ownerPluginId).toBe(CUA_PLUGIN_ID)
    expect(result.content).toEqual([
      { type: 'text', text: 'window tree' },
      {
        type: 'text',
        text: expect.stringContaining('2="00000002"')
      },
      {
        type: 'text',
        text: expect.stringContaining('## CUA browser chrome coverage')
      }
    ])
  })

  it.each([
    ['stale_element_token', 'element_token is stale; call get_window_state again to refresh'],
    ['generation_mismatch', 'element_token belongs to another runtime generation'],
    ['invalid_element_token', 'element_token has invalid format']
  ])('projects the CUA refusal code %s into model-visible content', async (code, message) => {
    const client = createClient(
      'cua-driver',
      [
        {
          name: 'click',
          description: 'Click an element',
          inputSchema: {
            type: 'object',
            properties: {
              pid: { type: 'integer' },
              element_token: { type: 'string' }
            }
          }
        }
      ],
      {
        source: 'plugin',
        ownerPluginId: CUA_PLUGIN_ID
      }
    )
    const structuredContent = {
      status: 'refused',
      refusal: { code, message }
    }
    client.callTool.mockResolvedValue({
      content: [{ type: 'text', text: message }],
      structuredContent,
      isError: true
    })
    const manager = createToolManager(
      createProviderSettings('cua-driver'),
      createServerManager([client]),
      { 'cua-driver': CUA_PLUGIN_ID },
      { ensureRunning: vi.fn().mockResolvedValue(undefined) }
    )

    const result = await manager.callTool({
      id: `cua-refusal-${code}`,
      type: 'function',
      function: {
        name: 'click',
        arguments: '{"pid":10,"element_token":"garbage-token"}'
      }
    })

    expect(result.structuredContent).toBe(structuredContent)
    expect(result.ownerPluginId).toBe(CUA_PLUGIN_ID)
    expect(result.content).toEqual([
      { type: 'text', text: message },
      {
        type: 'text',
        text: `## CUA structured refusal\nrefusal.code=${JSON.stringify(code)}`
      }
    ])
  })

  it('observes trusted CUA snapshots with run metadata without changing tool arguments', async () => {
    const client = createClient(
      'cua-driver',
      [
        {
          name: 'get_window_state',
          description: 'Read the current window',
          inputSchema: {
            properties: {},
            required: []
          }
        }
      ],
      {
        source: 'plugin',
        ownerPluginId: CUA_PLUGIN_ID
      }
    )
    client.callTool.mockResolvedValue({
      content: [
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'aW1hZ2U='
        }
      ],
      isError: false
    })
    const observer = {
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn()
    }
    const manager = createToolManager(
      createProviderSettings('cua-driver'),
      createServerManager([client]),
      { 'cua-driver': CUA_PLUGIN_ID },
      { ensureRunning: vi.fn().mockResolvedValue(undefined) },
      observer
    )
    const toolCall = {
      id: 'cua-state-1',
      type: 'function' as const,
      function: {
        name: 'get_window_state',
        arguments: '{"pid":12,"window_id":34}'
      },
      conversationId: 'session-1'
    }

    const result = await manager.callTool(toolCall, { runId: 'run-1' })

    expect(client.callTool).toHaveBeenCalledWith(
      'get_window_state',
      {
        pid: 12,
        window_id: 34
      },
      expect.objectContaining({
        toolDefinition: expect.objectContaining({ name: 'get_window_state' })
      })
    )
    expect(observer.started).toHaveBeenCalledWith({
      conversationId: 'session-1',
      runId: 'run-1',
      toolCallId: 'cua-state-1',
      toolName: 'get_window_state',
      args: {
        pid: 12,
        window_id: 34
      },
      source: {
        serverName: 'cua-driver',
        ownerPluginId: CUA_PLUGIN_ID
      }
    })
    expect(observer.completed).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'cua-state-1' }),
      result
    )
    expect(observer.failed).not.toHaveBeenCalled()
    expect(JSON.stringify(client.callTool.mock.calls)).not.toContain('run-1')
  })

  it('refreshes PiP after a trusted click without exposing or awaiting the private snapshot', async () => {
    let snapshotPolicy: 'allow' | 'ask' = 'allow'
    vi.spyOn(toolPolicyStore, 'resolvePluginToolPolicy').mockImplementation(
      (_serverId, toolName) => ({
        managed: toolName === 'get_window_state',
        decision: toolName === 'get_window_state' ? snapshotPolicy : null
      })
    )
    const tools = [
      {
        name: 'click',
        description: 'Click the current window',
        inputSchema: {
          properties: {},
          required: []
        }
      },
      {
        name: 'get_window_state',
        description: 'Read the current window',
        inputSchema: {
          properties: {},
          required: []
        }
      }
    ]
    const client = createClient('cua-driver', tools, {
      source: 'plugin',
      ownerPluginId: CUA_PLUGIN_ID
    })
    const privateSnapshots = [
      deferred<{
        content: Array<{ type: string; mimeType: string; data: string }>
        isError: boolean
      }>(),
      deferred<{
        content: Array<{ type: string; mimeType: string; data: string }>
        isError: boolean
      }>()
    ]
    let privateSnapshotIndex = 0
    client.callTool.mockImplementation((toolName: string) => {
      if (toolName === 'click') {
        return Promise.resolve({
          content: 'clicked',
          isError: false
        })
      }
      return privateSnapshots[privateSnapshotIndex++].promise
    })
    const publishEvent = vi.fn()
    const observer = {
      shouldCaptureAfterClick: vi.fn(() => true),
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn()
    }
    const providerSettings = createProviderSettings('cua-driver')
    const manager = new ToolManager(
      providerSettings as never,
      providerSettings as never,
      createServerManager([client]) as never,
      semanticNotifications,
      publishEvent,
      {
        ownsServer: (serverName) => serverName === 'cua-driver',
        isServerAvailable: (serverName) => serverName === 'cua-driver',
        getOwnerPluginId: (serverName) => (serverName === 'cua-driver' ? CUA_PLUGIN_ID : undefined),
        getAvailableToolCatalogs: () => [
          {
            pluginId: CUA_PLUGIN_ID,
            serverName: 'cua-driver',
            displayName: 'CUA Driver',
            toolCatalog: {
              version: '1',
              tools
            }
          }
        ],
        ensureRunning: vi.fn().mockResolvedValue(undefined)
      },
      observer
    )

    const result = await manager.callTool(
      {
        id: 'cua-click-1',
        type: 'function',
        function: {
          name: 'click',
          arguments: '{"pid":12,"window_id":34,"x":10,"y":20}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )

    expect(result).toEqual({
      toolCallId: 'cua-click-1',
      content: 'clicked',
      isError: false,
      ownerPluginId: CUA_PLUGIN_ID
    })
    expect(client.callTool).toHaveBeenNthCalledWith(
      1,
      'click',
      {
        pid: 12,
        window_id: 34,
        x: 10,
        y: 20
      },
      expect.objectContaining({
        toolDefinition: expect.objectContaining({ name: 'click' })
      })
    )
    await vi.waitFor(() => expect(client.callTool).toHaveBeenCalledTimes(2))
    expect(client.callTool).toHaveBeenNthCalledWith(2, 'get_window_state', {
      pid: 12,
      window_id: 34
    })
    expect(observer.shouldCaptureAfterClick).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'cua-click-1',
        toolName: 'click',
        conversationId: 'session-1',
        runId: 'run-1'
      })
    )
    expect(observer.started).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'cua-click-1:pip-snapshot',
        toolName: 'get_window_state',
        args: {
          pid: 12,
          window_id: 34
        }
      })
    )
    expect(observer.completed).not.toHaveBeenCalled()
    expect(publishEvent).toHaveBeenCalledOnce()
    expect(publishEvent).toHaveBeenCalledWith(
      'mcp.toolCall.result',
      expect.objectContaining({
        functionName: 'click',
        content: 'clicked'
      })
    )

    privateSnapshots[0].resolve({
      content: [
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'aW1hZ2U='
        }
      ],
      isError: false
    })
    await vi.waitFor(() => expect(observer.completed).toHaveBeenCalledOnce())

    expect(observer.completed).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'cua-click-1:pip-snapshot' }),
      expect.objectContaining({
        toolCallId: 'cua-click-1:pip-snapshot',
        content: [
          {
            type: 'image',
            mimeType: 'image/png',
            data: 'aW1hZ2U='
          }
        ]
      })
    )
    expect(publishEvent).toHaveBeenCalledOnce()
    expect(observer.failed).not.toHaveBeenCalled()

    const laterResult = await manager.callTool(
      {
        id: 'cua-click-2',
        type: 'function',
        function: {
          name: 'click',
          arguments: '{"pid":12,"window_id":34,"x":30,"y":40}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )
    expect(laterResult.content).toBe('clicked')
    expect(publishEvent).toHaveBeenCalledTimes(2)

    const privateFailure = new Error('private snapshot failed')
    privateSnapshots[1].reject(privateFailure)
    await vi.waitFor(() => expect(observer.failed).toHaveBeenCalledOnce())

    expect(observer.failed).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'cua-click-2:pip-snapshot' }),
      privateFailure
    )
    expect(publishEvent).toHaveBeenCalledTimes(2)

    snapshotPolicy = 'ask'
    const guardedResult = await manager.callTool(
      {
        id: 'cua-click-3',
        type: 'function',
        function: {
          name: 'click',
          arguments: '{"pid":12,"window_id":34,"x":50,"y":60}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )

    expect(guardedResult.content).toBe('clicked')
    expect(client.callTool).toHaveBeenCalledTimes(5)
    expect(observer.shouldCaptureAfterClick).toHaveBeenCalledTimes(2)
    expect(observer.started).toHaveBeenCalledTimes(2)
  })

  it('blocks a private PiP snapshot when the live schema differs from the catalog', async () => {
    vi.spyOn(toolPolicyStore, 'resolvePluginToolPolicy').mockImplementation(
      (_serverId, toolName) => ({
        managed: toolName === 'get_window_state',
        decision: toolName === 'get_window_state' ? 'allow' : null
      })
    )
    const liveTools = [
      {
        name: 'click',
        description: 'Click the current window',
        inputSchema: {
          properties: {},
          required: []
        }
      },
      {
        name: 'get_window_state',
        description: 'Read the current window',
        inputSchema: {
          properties: {
            pid: { type: 'integer' }
          },
          required: ['pid']
        }
      }
    ]
    const catalogTools = [
      liveTools[0],
      {
        ...liveTools[1],
        inputSchema: {
          properties: {
            pid: { type: 'integer' },
            window_id: { type: 'integer' }
          },
          required: ['pid', 'window_id']
        }
      }
    ]
    const client = createClient('cua-driver', liveTools, {
      source: 'plugin',
      ownerPluginId: CUA_PLUGIN_ID
    })
    client.callTool.mockResolvedValue({
      content: 'clicked',
      isError: false
    })
    const serverManager = createServerManager([client])
    const observer = {
      shouldCaptureAfterClick: vi.fn(() => true),
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn()
    }
    const manager = createToolManager(
      createProviderSettings('cua-driver'),
      serverManager,
      { 'cua-driver': CUA_PLUGIN_ID },
      {
        ensureRunning: vi.fn().mockResolvedValue(undefined),
        catalogs: [
          {
            pluginId: CUA_PLUGIN_ID,
            serverName: 'cua-driver',
            displayName: 'CUA Driver',
            toolCatalog: {
              version: '1',
              tools: catalogTools
            }
          }
        ]
      },
      observer
    )

    const result = await manager.callTool(
      {
        id: 'cua-click-schema-drift',
        type: 'function',
        function: {
          name: 'click',
          arguments: '{"pid":12,"window_id":34,"x":10,"y":20}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )

    expect(result.content).toBe('clicked')
    await vi.waitFor(() => expect(observer.failed).toHaveBeenCalledOnce())
    expect(client.callTool).toHaveBeenCalledOnce()
    expect(client.callTool).toHaveBeenCalledWith(
      'click',
      {
        pid: 12,
        window_id: 34,
        x: 10,
        y: 20
      },
      expect.objectContaining({
        toolDefinition: expect.objectContaining({ name: 'click' })
      })
    )
    expect(observer.completed).not.toHaveBeenCalled()
    expect(observer.failed).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'cua-click-schema-drift:pip-snapshot',
        toolName: 'get_window_state'
      }),
      expect.objectContaining({
        message:
          'Live MCP tool "get_window_state" schema differs from the packaged catalog for server "cua-driver"'
      })
    )
    expect(serverManager.setServerLastError).toHaveBeenCalledWith(
      'cua-driver',
      'Live MCP tool "get_window_state" schema differs from the packaged catalog for server "cua-driver"'
    )
  })

  it('does not privately snapshot failed, invalid-target, or untrusted clicks', async () => {
    const trustedClient = createClient(
      'cua-driver',
      [
        {
          name: 'click',
          description: 'Click the current window',
          inputSchema: {
            properties: {},
            required: []
          }
        }
      ],
      {
        source: 'plugin',
        ownerPluginId: CUA_PLUGIN_ID
      }
    )
    trustedClient.callTool
      .mockResolvedValueOnce({ content: 'click failed', isError: true })
      .mockResolvedValueOnce({ content: 'clicked', isError: false })
    const trustedObserver = {
      shouldCaptureAfterClick: vi.fn(() => true),
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn()
    }
    const trustedManager = createToolManager(
      createProviderSettings('cua-driver'),
      createServerManager([trustedClient]),
      { 'cua-driver': CUA_PLUGIN_ID },
      { ensureRunning: vi.fn().mockResolvedValue(undefined) },
      trustedObserver
    )

    await trustedManager.callTool(
      {
        id: 'failed-click',
        type: 'function',
        function: {
          name: 'click',
          arguments: '{"pid":12,"window_id":34,"x":10,"y":20}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )
    await trustedManager.callTool(
      {
        id: 'missing-window-click',
        type: 'function',
        function: {
          name: 'click',
          arguments: '{"pid":12,"x":10,"y":20}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )

    expect(trustedClient.callTool).toHaveBeenCalledTimes(2)
    expect(trustedObserver.shouldCaptureAfterClick).not.toHaveBeenCalled()
    expect(trustedObserver.started).not.toHaveBeenCalled()

    const untrustedClient = createClient(
      'manual-cua',
      [
        {
          name: 'click',
          description: 'Click the current window',
          inputSchema: {
            properties: {},
            required: []
          }
        }
      ],
      {
        source: 'manual',
        sourceId: 'com.deepchat.plugins.cua'
      }
    )
    const untrustedObserver = {
      shouldCaptureAfterClick: vi.fn(() => true),
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn()
    }
    const untrustedManager = createToolManager(
      createProviderSettings('manual-cua'),
      createServerManager([untrustedClient]),
      {},
      {},
      untrustedObserver
    )

    await untrustedManager.callTool(
      {
        id: 'untrusted-click',
        type: 'function',
        function: {
          name: 'click',
          arguments: '{"pid":12,"window_id":34,"x":10,"y":20}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )

    expect(untrustedClient.callTool).toHaveBeenCalledOnce()
    expect(untrustedObserver.shouldCaptureAfterClick).not.toHaveBeenCalled()
    expect(untrustedObserver.started).not.toHaveBeenCalled()
  })

  it('does not trust a non-plugin server that spoofs the CUA source id', async () => {
    const client = createClient(
      'spoofed-cua',
      [
        {
          name: 'get_window_state',
          description: 'Read the current window',
          inputSchema: {
            properties: {},
            required: []
          }
        }
      ],
      {
        source: 'manual',
        sourceId: 'com.deepchat.plugins.cua'
      }
    )
    const observer = {
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn()
    }
    const manager = createToolManager(
      createProviderSettings('spoofed-cua'),
      createServerManager([client]),
      {},
      {},
      observer
    )

    await manager.callTool(
      {
        id: 'spoofed-cua-state',
        type: 'function',
        function: {
          name: 'get_window_state',
          arguments: '{"pid":12,"window_id":34}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )

    expect(client.callTool).toHaveBeenCalledOnce()
    expect(observer.started).not.toHaveBeenCalled()
    expect(observer.completed).not.toHaveBeenCalled()
    expect(observer.failed).not.toHaveBeenCalled()
  })

  it('reports a failed trusted CUA invocation without changing the tool error response', async () => {
    const client = createClient(
      'cua-driver',
      [
        {
          name: 'get_window_state',
          description: 'Read the current window',
          inputSchema: {
            properties: {},
            required: []
          }
        }
      ],
      {
        source: 'plugin',
        ownerPluginId: CUA_PLUGIN_ID
      }
    )
    const failure = new Error('driver failed')
    client.callTool.mockRejectedValue(failure)
    const observer = {
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn()
    }
    const manager = createToolManager(
      createProviderSettings('cua-driver'),
      createServerManager([client]),
      { 'cua-driver': CUA_PLUGIN_ID },
      { ensureRunning: vi.fn().mockResolvedValue(undefined) },
      observer
    )

    const result = await manager.callTool(
      {
        id: 'cua-state-failed',
        type: 'function',
        function: {
          name: 'get_window_state',
          arguments: '{"pid":12,"window_id":34}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )

    expect(result).toEqual({
      toolCallId: 'cua-state-failed',
      content: "Error: Failed to execute tool 'get_window_state': driver failed",
      isError: true
    })
    expect(observer.started).toHaveBeenCalledOnce()
    expect(observer.completed).not.toHaveBeenCalled()
    expect(observer.failed).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'cua-state-failed' }),
      failure
    )
  })

  it('normalizes CUA Windows launch bundle paths before dispatch', async () => {
    const client = createClient('cua-driver', [], {
      source: 'plugin',
      ownerPluginId: 'com.deepchat.plugins.cua'
    })
    const providerSettings = createProviderSettings('cua-driver')
    const manager = createToolManager(
      providerSettings as never,
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
    const providerSettings = createProviderSettings('cua-driver')
    const manager = createToolManager(
      providerSettings as never,
      createServerManager([client]) as never
    )

    const prepared = await (manager as any).prepareCuaWindowsLaunchArgs(client, {
      bundle_id: 'com.apple.TextEdit'
    })

    expect(prepared.error).toContain("Windows app target 'com.apple.TextEdit' was not found")
    expect(client.callTool).toHaveBeenCalledWith('list_apps', {})
  })

  it('forwards and preserves cancellation from the CUA Windows preflight helper', async () => {
    const client = createClient('cua-driver', [], {
      source: 'plugin',
      ownerPluginId: 'com.deepchat.plugins.cua'
    })
    client.callTool.mockImplementation(
      (_name: string, _args: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true
          })
        })
    )
    const manager = createToolManager(
      createProviderSettings('cua-driver') as never,
      createServerManager([client]) as never
    )
    const abortController = new AbortController()

    const preparing = (manager as any).prepareCuaWindowsLaunchArgs(
      client,
      { bundle_id: 'com.apple.TextEdit' },
      abortController.signal
    )
    await vi.waitFor(() =>
      expect(client.callTool).toHaveBeenCalledWith(
        'list_apps',
        {},
        {
          signal: abortController.signal
        }
      )
    )

    abortController.abort()

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not guess ACP access when provider hint is missing', async () => {
    const client = createClient('open-server')
    const providerSettings = createProviderSettings('open-server')

    const manager = createToolManager(
      providerSettings as never,
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
    expect(client.callTool).toHaveBeenCalledWith(
      'echo',
      {},
      expect.objectContaining({
        toolDefinition: expect.objectContaining({ name: 'echo' })
      })
    )
    expect(providerSettings.getAgentMcpSelections).not.toHaveBeenCalled()
  })
})
