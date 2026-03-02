import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StreamState, IoParams } from '@/presenter/deepchatAgentPresenter/types'
import { createState } from '@/presenter/deepchatAgentPresenter/types'
import type { MCPToolDefinition } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'

vi.mock('@/eventbus', () => ({
  eventBus: { sendToRenderer: vi.fn() },
  SendTarget: { ALL_WINDOWS: 'all' }
}))

vi.mock('@/events', () => ({
  STREAM_EVENTS: {
    RESPONSE: 'stream:response',
    END: 'stream:end',
    ERROR: 'stream:error'
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {
    commandPermissionService: {
      extractCommandSignature: vi.fn().mockReturnValue('mock-signature'),
      approve: vi.fn()
    },
    filePermissionService: { approve: vi.fn() },
    settingsPermissionService: { approve: vi.fn() },
    mcpPresenter: {
      grantPermission: vi.fn().mockResolvedValue(undefined)
    }
  }
}))

import { executeTools, finalize, finalizeError } from '@/presenter/deepchatAgentPresenter/dispatch'
import { eventBus } from '@/eventbus'

function createIo(overrides?: Partial<IoParams>): IoParams {
  return {
    sessionId: 's1',
    messageId: 'm1',
    messageStore: {
      updateAssistantContent: vi.fn(),
      finalizeAssistantMessage: vi.fn(),
      setMessageError: vi.fn()
    } as any,
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

function makeTool(name: string): MCPToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: `Tool ${name}`,
      parameters: { type: 'object', properties: {} }
    },
    server: { name: 'test-server', icons: 'icon', description: 'Test server' }
  }
}

function createMockToolPresenter(responses: Record<string, string> = {}): IToolPresenter {
  return {
    getAllToolDefinitions: vi.fn().mockResolvedValue([]),
    callTool: vi.fn(async (request) => {
      const name = request.function.name
      const responseText = responses[name] ?? `result for ${name}`
      return {
        content: responseText,
        rawData: {
          toolCallId: request.id,
          content: responseText,
          isError: false
        }
      }
    }),
    buildToolSystemPrompt: vi.fn().mockReturnValue('')
  } as unknown as IToolPresenter
}

describe('dispatch', () => {
  let state: StreamState
  let io: IoParams

  beforeEach(() => {
    vi.clearAllMocks()
    state = createState()
    io = createIo()
  })

  describe('executeTools', () => {
    it('builds assistant message, calls tools, updates blocks', async () => {
      const tools = [makeTool('get_weather')]
      const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny, 72F' })
      const conversation = [{ role: 'user' as const, content: 'Hello' }]

      // Simulate accumulator having produced a tool_call block
      state.blocks.push({
        type: 'content',
        content: 'Checking weather...',
        status: 'pending',
        timestamp: Date.now()
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'get_weather', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'get_weather', arguments: '{}' }]

      const executed = await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access'
      )

      expect(executed.executed).toBe(1)
      expect(toolPresenter.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tc1',
          function: { name: 'get_weather', arguments: '{}' },
          server: tools[0].server,
          conversationId: 's1'
        })
      )

      // Conversation should have assistant + tool messages
      expect(conversation).toHaveLength(3)
      expect(conversation[1].role).toBe('assistant')
      expect(conversation[2].role).toBe('tool')
      expect(conversation[2].content).toBe('Sunny, 72F')

      // Block should be updated with response
      const toolBlock = state.blocks.find((b) => b.type === 'tool_call')
      expect(toolBlock!.tool_call!.response).toBe('Sunny, 72F')
      expect(toolBlock!.status).toBe('success')
    })

    it('enriches tool_call blocks with server info', async () => {
      const tools = [makeTool('get_weather')]
      const toolPresenter = createMockToolPresenter({ get_weather: 'Sunny' })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'get_weather', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'get_weather', arguments: '{}' }]

      await executeTools(state, [], 0, tools, toolPresenter, 'gpt-4', io, 'full_access')

      expect(state.blocks[0].tool_call!.server_name).toBe('test-server')
      expect(state.blocks[0].tool_call!.server_icons).toBe('icon')
      expect(state.blocks[0].tool_call!.server_description).toBe('Test server')
    })

    it('includes reasoning_content for deepseek-reasoner models', async () => {
      const tools = [makeTool('search')]
      const toolPresenter = createMockToolPresenter({ search: 'result' })
      const conversation: any[] = []

      state.blocks.push({
        type: 'reasoning_content',
        content: 'Let me think...',
        status: 'pending',
        timestamp: Date.now()
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'search', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'search', arguments: '{}' }]

      await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'deepseek-reasoner',
        io,
        'full_access'
      )

      const assistantMsg = conversation.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.reasoning_content).toBe('Let me think...')
    })

    it('does not include reasoning_content for non-reasoning models', async () => {
      const tools = [makeTool('search')]
      const toolPresenter = createMockToolPresenter({ search: 'result' })
      const conversation: any[] = []

      state.blocks.push({
        type: 'reasoning_content',
        content: 'Thinking...',
        status: 'pending',
        timestamp: Date.now()
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'search', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'search', arguments: '{}' }]

      await executeTools(state, conversation, 0, tools, toolPresenter, 'gpt-4', io, 'full_access')

      const assistantMsg = conversation.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.reasoning_content).toBeUndefined()
    })

    it('handles tool error', async () => {
      const tools = [makeTool('bad_tool')]
      const toolPresenter = createMockToolPresenter()
      ;(toolPresenter.callTool as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Tool failed')
      )
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'bad_tool', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'bad_tool', arguments: '{}' }]

      await executeTools(state, conversation, 0, tools, toolPresenter, 'gpt-4', io, 'full_access')

      const toolMsg = conversation.find((m: any) => m.role === 'tool')
      expect(toolMsg.content).toBe('Error: Tool failed')

      const block = state.blocks.find((b) => b.type === 'tool_call')
      expect(block!.tool_call!.response).toBe('Error: Tool failed')
      expect(block!.status).toBe('error')
    })

    it('stops on abort', async () => {
      const abortController = new AbortController()
      const abortIo = createIo({ abortSignal: abortController.signal })
      const tools = [makeTool('tool_a'), makeTool('tool_b')]
      const toolPresenter = createMockToolPresenter()

      // Abort after first tool call
      ;(toolPresenter.callTool as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        abortController.abort()
        return { content: 'ok', rawData: { toolCallId: 'tc1', content: 'ok', isError: false } }
      })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'tool_a', params: '{}', response: '' }
      })
      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc2', name: 'tool_b', params: '{}', response: '' }
      })
      state.completedToolCalls = [
        { id: 'tc1', name: 'tool_a', arguments: '{}' },
        { id: 'tc2', name: 'tool_b', arguments: '{}' }
      ]

      const executed = await executeTools(
        state,
        [],
        0,
        tools,
        toolPresenter,
        'gpt-4',
        abortIo,
        'full_access'
      )

      // Only first tool should have been called
      expect(executed.executed).toBe(1)
      expect(toolPresenter.callTool).toHaveBeenCalledTimes(1)
    })

    it('flushes to renderer and DB after each tool execution', async () => {
      const tools = [makeTool('tool_a')]
      const toolPresenter = createMockToolPresenter({ tool_a: 'done' })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'tool_a', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'tool_a', arguments: '{}' }]

      await executeTools(state, [], 0, tools, toolPresenter, 'gpt-4', io, 'full_access')

      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        'stream:response',
        'all',
        expect.objectContaining({
          conversationId: 's1',
          messageId: 'm1',
          eventId: 'm1',
          blocks: expect.any(Array)
        })
      )
      expect(io.messageStore.updateAssistantContent).toHaveBeenCalled()
    })
  })

  describe('finalize', () => {
    it('marks pending blocks as success and computes metadata', () => {
      // Set startTime in the past so generationTime > 0
      state.startTime = Date.now() - 1000
      state.blocks.push({
        type: 'content',
        content: 'Hello',
        status: 'pending',
        timestamp: Date.now()
      })
      state.metadata.outputTokens = 100
      state.firstTokenTime = state.startTime + 50

      finalize(state, io)

      expect(state.blocks[0].status).toBe('success')
      expect(io.messageStore.finalizeAssistantMessage).toHaveBeenCalledWith(
        'm1',
        state.blocks,
        expect.any(String)
      )

      const metadata = JSON.parse(
        (io.messageStore.finalizeAssistantMessage as ReturnType<typeof vi.fn>).mock.calls[0][2]
      )
      expect(metadata.firstTokenTime).toBe(50)
      expect(metadata.generationTime).toBeGreaterThanOrEqual(1000)
      expect(metadata.tokensPerSecond).toBeDefined()
    })

    it('emits END event', () => {
      finalize(state, io)

      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        'stream:end',
        'all',
        expect.objectContaining({
          conversationId: 's1',
          messageId: 'm1',
          eventId: 'm1'
        })
      )
    })

    it('emits RESPONSE with blocks', () => {
      state.blocks.push({
        type: 'content',
        content: 'test',
        status: 'pending',
        timestamp: Date.now()
      })

      finalize(state, io)

      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        'stream:response',
        'all',
        expect.objectContaining({
          conversationId: 's1',
          messageId: 'm1',
          eventId: 'm1',
          blocks: expect.any(Array)
        })
      )
    })
  })

  describe('finalizeError', () => {
    it('pushes error block and marks pending blocks as error', () => {
      state.blocks.push({
        type: 'content',
        content: 'Partial',
        status: 'pending',
        timestamp: Date.now()
      })

      finalizeError(state, io, new Error('Connection lost'))

      expect(state.blocks).toHaveLength(2)
      expect(state.blocks[0].status).toBe('error')
      expect(state.blocks[1].type).toBe('error')
      expect(state.blocks[1].content).toBe('Connection lost')
    })

    it('calls setMessageError', () => {
      finalizeError(state, io, new Error('fail'))

      expect(io.messageStore.setMessageError).toHaveBeenCalledWith('m1', state.blocks)
    })

    it('emits ERROR event', () => {
      finalizeError(state, io, new Error('boom'))

      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        'stream:error',
        'all',
        expect.objectContaining({
          conversationId: 's1',
          messageId: 'm1',
          eventId: 'm1',
          error: 'boom'
        })
      )
    })

    it('handles non-Error objects', () => {
      finalizeError(state, io, 'string error')

      const errorBlock = state.blocks.find((b) => b.type === 'error')
      expect(errorBlock!.content).toBe('string error')
    })
  })
})
