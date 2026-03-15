import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLoopHandler } from '@/presenter/agentPresenter/loop/agentLoopHandler'

const presenterMock = vi.hoisted(() => ({
  toolPresenter: {
    getAllToolDefinitions: vi.fn().mockResolvedValue([
      {
        function: {
          name: 'read'
        },
        server: {
          name: 'agent-filesystem',
          icons: '',
          description: 'Filesystem'
        }
      }
    ]),
    preCheckToolPermission: vi.fn().mockResolvedValue(null),
    callTool: vi.fn().mockResolvedValue({
      content: 'ok',
      rawData: {}
    })
  },
  mcpPresenter: {},
  yoBrowserPresenter: {}
}))

vi.mock('@/presenter', () => ({
  presenter: presenterMock
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

describe('AgentLoopHandler session runtime wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves model and workspace through injected session runtime in tool processing', async () => {
    const sessionRuntime = {
      getSession: vi.fn().mockResolvedValue({
        resolved: {
          modelId: 'model-from-session'
        }
      }),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({
        chatMode: 'agent',
        agentWorkspacePath: 'C:/workspace'
      })
    }
    const handler = new AgentLoopHandler({
      configPresenter: {} as any,
      getProviderInstance: vi.fn() as any,
      activeStreams: new Map(),
      canStartNewStream: vi.fn().mockReturnValue(true),
      rateLimitManager: {} as any,
      sessionRuntime
    })

    const processor = (handler as any).toolCallProcessor.process({
      eventId: 'evt-loop',
      toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{}' }],
      enabledMcpTools: [],
      conversationMessages: [],
      modelConfig: {
        functionCall: false,
        type: 'chat'
      },
      abortSignal: new AbortController().signal,
      currentToolCallCount: 0,
      maxToolCalls: 5,
      conversationId: 'conv-loop',
      providerId: 'mock-provider'
    })

    while (true) {
      const next = await processor.next()
      if (next.done) {
        break
      }
    }

    expect(sessionRuntime.getSession).toHaveBeenCalledWith('conv-loop')
    expect(sessionRuntime.resolveWorkspaceContext).toHaveBeenCalledWith(
      'conv-loop',
      'model-from-session'
    )
    expect(presenterMock.toolPresenter.getAllToolDefinitions).toHaveBeenCalled()
  })
})
