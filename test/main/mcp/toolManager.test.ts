import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolManager, type ComputerUsePreviewObserver } from '@/mcp/toolManager'
import * as toolPolicyStore from '@/plugin/toolPolicyStore'

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

  function createToolManager(
    providerSettings: unknown,
    serverManager: unknown,
    computerUsePreviewObserver?: ComputerUsePreviewObserver
  ) {
    return new ToolManager(
      providerSettings as never,
      { getLanguage: vi.fn().mockReturnValue('en-US') },
      providerSettings as never,
      serverManager as never,
      vi.fn(),
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
      createServerManager([normalClient, blockedClient, pluginClient]) as never
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

  it('keeps source plugin MCP servers available outside normal server policy', async () => {
    const pluginClient = createClient('plugin-source-server', undefined, {
      source: 'plugin',
      sourceId: 'plugin-b'
    })
    const providerSettings = createProviderSettings('plugin-source-server')
    providerSettings.getMcpServers.mockResolvedValue({
      'plugin-source-server': {
        autoApprove: ['all'],
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

    expect(definitions.map((tool) => tool.server.name)).toEqual(['plugin-source-server'])
    expect(result.isError).toBe(false)
    expect(pluginClient.callTool).toHaveBeenCalledWith('echo', {})
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

  it('records plugin tool-list failures without showing a global toast', async () => {
    const client = createClient('plugin-server', [], {
      source: 'plugin',
      ownerPluginId: 'com.deepchat.fixture'
    })
    client.listTools.mockRejectedValue(new Error('tool list failed'))
    const providerSettings = createProviderSettings('plugin-server')
    const serverManager = createServerManager([client])
    const manager = createToolManager(providerSettings as never, serverManager as never)

    const definitions = await manager.getAllToolDefinitions()

    expect(definitions).toEqual([])
    expect(serverManager.setServerLastError).toHaveBeenCalledWith(
      'plugin-server',
      'tool list failed'
    )
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
    expect(client.callTool).toHaveBeenCalledWith('echo', {})
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
      expect(client.callTool).toHaveBeenCalledWith('echo', {}, { signal: abortController.signal })
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

  it('rejects permission pre-check promptly during tool-definition refresh', async () => {
    const client = createClient('open-server')
    const manager = createToolManager(
      createProviderSettings('open-server') as never,
      createServerManager([client]) as never
    )
    const definitions = deferred<Awaited<ReturnType<ToolManager['getAllToolDefinitions']>>>()
    const loadDefinitions = vi
      .spyOn(manager, 'getAllToolDefinitions')
      .mockReturnValue(definitions.promise)
    const abortController = new AbortController()

    const checking = manager.preCheckToolPermission(
      {
        id: 'permission-preflight-cancel',
        type: 'function',
        function: { name: 'echo', arguments: '{}' }
      },
      { signal: abortController.signal }
    )
    await vi.waitFor(() => expect(loadDefinitions).toHaveBeenCalledOnce())

    abortController.abort()

    await expect(checking).rejects.toMatchObject({ name: 'AbortError' })
    definitions.resolve([])
  })

  it('rejects permission pre-check promptly while server config is loading', async () => {
    const client = createClient('open-server')
    const providerSettings = createProviderSettings('open-server')
    const manager = createToolManager(
      providerSettings as never,
      createServerManager([client]) as never
    )
    await manager.getAllToolDefinitions()
    const servers = deferred<Awaited<ReturnType<typeof providerSettings.getMcpServers>>>()
    providerSettings.getMcpServers.mockReturnValue(servers.promise)
    const abortController = new AbortController()

    const checking = manager.preCheckToolPermission(
      {
        id: 'permission-config-cancel',
        type: 'function',
        function: { name: 'echo', arguments: '{}' }
      },
      { signal: abortController.signal }
    )
    await vi.waitFor(() => expect(providerSettings.getMcpServers).toHaveBeenCalledOnce())

    abortController.abort()

    await expect(checking).rejects.toMatchObject({ name: 'AbortError' })
    servers.resolve({ 'open-server': { autoApprove: ['all'] } })
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
    expect(client.callTool).toHaveBeenCalledWith('echo', {})
    expect(providerSettings.getAgentMcpSelections).not.toHaveBeenCalled()
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
        ownerPluginId: 'com.deepchat.plugins.cua'
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

    expect(client.callTool).toHaveBeenCalledWith('get_window_state', {
      pid: 12,
      window_id: 34
    })
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
        ownerPluginId: 'com.deepchat.plugins.cua'
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
    vi.spyOn(toolPolicyStore, 'getPluginToolPolicy').mockImplementation((_serverId, toolName) =>
      toolName === 'get_window_state' ? snapshotPolicy : null
    )
    const client = createClient(
      'cua-driver',
      [
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
      ],
      {
        source: 'plugin',
        ownerPluginId: 'com.deepchat.plugins.cua'
      }
    )
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
      { getLanguage: vi.fn().mockReturnValue('en-US') },
      providerSettings as never,
      createServerManager([client]) as never,
      publishEvent,
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
      isError: false
    })
    expect(client.callTool).toHaveBeenNthCalledWith(1, 'click', {
      pid: 12,
      window_id: 34,
      x: 10,
      y: 20
    })
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
        ownerPluginId: 'com.deepchat.plugins.cua'
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

  it('does not observe a CUA permission response before actual invocation', async () => {
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
        ownerPluginId: 'com.deepchat.plugins.cua'
      }
    )
    const providerSettings = createProviderSettings('cua-driver')
    providerSettings.getMcpServers.mockResolvedValue({
      'cua-driver': {
        autoApprove: []
      }
    })
    const observer = {
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn()
    }
    const manager = createToolManager(providerSettings, createServerManager([client]), observer)

    const result = await manager.callTool(
      {
        id: 'cua-state-permission',
        type: 'function',
        function: {
          name: 'get_window_state',
          arguments: '{"pid":12,"window_id":34}'
        },
        conversationId: 'session-1'
      },
      { runId: 'run-1' }
    )

    expect(result.requiresPermission).toBe(true)
    expect(client.callTool).not.toHaveBeenCalled()
    expect(observer.started).not.toHaveBeenCalled()
    expect(observer.completed).not.toHaveBeenCalled()
    expect(observer.failed).not.toHaveBeenCalled()
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
        ownerPluginId: 'com.deepchat.plugins.cua'
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
    expect(client.callTool).toHaveBeenCalledWith('echo', {})
    expect(providerSettings.getAgentMcpSelections).not.toHaveBeenCalled()
  })
})
