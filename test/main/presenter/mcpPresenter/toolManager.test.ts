import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const eventBusMocks = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  send: vi.fn(),
  sendToRenderer: vi.fn()
}))

const presenterMocks = vi.hoisted(() => ({
  agentSessionPresenter: {
    getSession: vi.fn()
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: eventBusMocks,
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/events', () => ({
  MCP_EVENTS: {
    CLIENT_LIST_UPDATED: 'client-list-updated',
    CONFIG_CHANGED: 'config-changed',
    TOOL_CALL_RESULT: 'tool-call-result'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'show-error'
  }
}))

vi.mock('@/presenter', () => ({
  presenter: presenterMocks
}))

import { ToolManager } from '../../../../src/main/presenter/mcpPresenter/toolManager'

describe('ToolManager ACP MCP access control', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function createClient(serverName: string) {
    return {
      serverName,
      serverConfig: {
        icons: '',
        descriptions: ''
      },
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'echo',
          description: 'Echo tool',
          inputSchema: {
            properties: {},
            required: []
          }
        }
      ]),
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
      {
        getRunningClients: vi.fn().mockResolvedValue([client])
      } as never
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

  it('skips ACP session resolution when provider hint is non-ACP', async () => {
    const client = createClient('open-server')
    const configPresenter = createConfigPresenter('open-server')
    presenterMocks.agentSessionPresenter.getSession.mockResolvedValue(null)

    const manager = new ToolManager(
      configPresenter as never,
      {
        getRunningClients: vi.fn().mockResolvedValue([client])
      } as never
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
      {
        getRunningClients: vi.fn().mockResolvedValue([client])
      } as never
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

  it('treats missing provider hint as a fallback to new session resolution', async () => {
    const client = createClient('open-server')
    const configPresenter = createConfigPresenter('open-server')
    presenterMocks.agentSessionPresenter.getSession.mockResolvedValue(null)

    const manager = new ToolManager(
      configPresenter as never,
      {
        getRunningClients: vi.fn().mockResolvedValue([client])
      } as never
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
