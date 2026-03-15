import { beforeEach, describe, expect, it, vi } from 'vitest'

const eventBusMocks = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  send: vi.fn(),
  sendToRenderer: vi.fn()
}))

const presenterMocks = vi.hoisted(() => ({
  newAgentPresenter: {
    getSession: vi.fn()
  },
  sessionPresenter: {
    getConversation: vi.fn()
  },
  getLegacyConversation: vi.fn((conversationId: string) =>
    presenterMocks.sessionPresenter.getConversation(conversationId)
  )
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
  beforeEach(() => {
    vi.clearAllMocks()
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

    presenterMocks.newAgentPresenter.getSession.mockResolvedValue({
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
      conversationId: 'session-1'
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain("MCP server 'blocked-server' is not allowed")
    expect(client.callTool).not.toHaveBeenCalled()
    expect(configPresenter.getSetting).not.toHaveBeenCalled()
    expect(configPresenter.getAgentMcpSelections).toHaveBeenCalledWith('agent-1')
  })

  it('falls back to legacy conversation ACP context when new session is missing', async () => {
    const client = createClient('legacy-server')
    const configPresenter = createConfigPresenter('legacy-server')
    configPresenter.getAcpAgents.mockResolvedValue([{ id: 'agent-legacy', name: 'Legacy Agent' }])
    configPresenter.getAgentMcpSelections.mockResolvedValue(['legacy-server'])

    presenterMocks.newAgentPresenter.getSession.mockResolvedValue(null)
    presenterMocks.sessionPresenter.getConversation.mockResolvedValue({
      id: 'conv-1',
      title: 'Legacy',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        providerId: 'acp',
        modelId: 'agent-legacy',
        chatMode: 'acp agent',
        agentWorkspacePath: '/workspace/legacy',
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 8000,
        artifacts: 0
      }
    })

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
      conversationId: 'conv-1'
    })

    expect(result.isError).toBe(false)
    expect(result.content).toBe('ok')
    expect(client.callTool).toHaveBeenCalledWith('echo', {})
    expect(presenterMocks.sessionPresenter.getConversation).toHaveBeenCalledWith('conv-1')
    expect(configPresenter.getAgentMcpSelections).toHaveBeenCalledWith('agent-legacy')
  })

  it('skips ACP selection gating for non-ACP sessions', async () => {
    const client = createClient('open-server')
    const configPresenter = createConfigPresenter('open-server')

    presenterMocks.newAgentPresenter.getSession.mockResolvedValue({
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
})
