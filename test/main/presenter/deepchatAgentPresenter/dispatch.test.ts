import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import type { StreamState, IoParams } from '@/presenter/deepchatAgentPresenter/types'
import { createState } from '@/presenter/deepchatAgentPresenter/types'
import type { MCPToolDefinition } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import { ToolOutputGuard } from '@/presenter/deepchatAgentPresenter/toolOutputGuard'
import { QUESTION_TOOL_NAME } from '@/lib/agentRuntime/questionTool'

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
  let tempHome: string | null = null
  let getPathSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    state = createState()
    io = createIo()
  })

  afterEach(async () => {
    getPathSpy?.mockRestore()
    getPathSpy = null
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true })
      tempHome = null
    }
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
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
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

    it('does not emit PreToolUse for question interactions that pause execution', async () => {
      const hooks = {
        onPreToolUse: vi.fn(),
        onPermissionRequest: vi.fn(),
        onPostToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn()
      }
      const toolPresenter = createMockToolPresenter()

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: QUESTION_TOOL_NAME, params: '', response: '' }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: QUESTION_TOOL_NAME,
          arguments: JSON.stringify({
            question: 'Continue?',
            options: [{ label: 'Yes' }]
          })
        }
      ]

      const result = await executeTools(
        state,
        [],
        0,
        [makeTool(QUESTION_TOOL_NAME)],
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks
      )

      expect(result.pendingInteractions).toHaveLength(1)
      expect(hooks.onPreToolUse).not.toHaveBeenCalled()
      expect(toolPresenter.callTool).not.toHaveBeenCalled()
    })

    it('does not emit PreToolUse before a pre-checked permission pause', async () => {
      const hooks = {
        onPreToolUse: vi.fn(),
        onPermissionRequest: vi.fn(),
        onPostToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn()
      }
      const toolPresenter = createMockToolPresenter() as IToolPresenter & {
        preCheckToolPermission: ReturnType<typeof vi.fn>
      }
      toolPresenter.preCheckToolPermission = vi.fn().mockResolvedValue({
        needsPermission: true,
        permissionType: 'write',
        description: 'Need permission'
      })

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'write_file', params: '{"path":"a.txt"}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'write_file', arguments: '{"path":"a.txt"}' }]

      const result = await executeTools(
        state,
        [],
        0,
        [makeTool('write_file')],
        toolPresenter,
        'gpt-4',
        io,
        'default',
        new ToolOutputGuard(),
        32000,
        1024,
        hooks
      )

      expect(result.pendingInteractions).toHaveLength(1)
      expect(hooks.onPreToolUse).not.toHaveBeenCalled()
      expect(hooks.onPermissionRequest).toHaveBeenCalledTimes(1)
      expect(toolPresenter.callTool).not.toHaveBeenCalled()
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

      await executeTools(
        state,
        [],
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

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
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
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

      await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

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

      await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      const toolMsg = conversation.find((m: any) => m.role === 'tool')
      expect(toolMsg.content).toBe('Error: Tool failed')

      const block = state.blocks.find((b) => b.type === 'tool_call')
      expect(block!.tool_call!.response).toBe('Error: Tool failed')
      expect(block!.status).toBe('error')
    })

    it('preserves raw tool error status when guard returns ok', async () => {
      const tools = [makeTool('bad_tool')]
      const toolPresenter = createMockToolPresenter()
      ;(toolPresenter.callTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Upstream failure',
        rawData: {
          toolCallId: 'tc1',
          content: 'Upstream failure',
          isError: true
        }
      })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: { id: 'tc1', name: 'bad_tool', params: '{}', response: '' }
      })
      state.completedToolCalls = [{ id: 'tc1', name: 'bad_tool', arguments: '{}' }]

      await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      const toolMsg = conversation.find((message: any) => message.role === 'tool')
      expect(toolMsg.content).toBe('Upstream failure')

      const block = state.blocks.find((b) => b.type === 'tool_call')
      expect(block!.tool_call!.response).toBe('Upstream failure')
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
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
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

      await executeTools(
        state,
        [],
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

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

    it('offloads large yo_browser responses into a stub', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-offload-'))
      getPathSpy = vi.spyOn(app, 'getPath').mockReturnValue(tempHome)

      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolPresenter = createMockToolPresenter({ cdp_send: longScreenshot })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'function.cdp_send:11',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'function.cdp_send:11',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      const executed = await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      expect(executed.terminalError).toBeUndefined()
      const toolMessage = conversation.find((message: any) => message.role === 'tool')
      expect(toolMessage.content).toContain('[Tool output offloaded]')
      expect(toolMessage.content).toContain('tool_function.cdp_send_11.offload')
      expect(toolMessage.content).not.toContain(':11.offload')
      expect(toolMessage.content).not.toContain(tempHome!)
      expect(state.blocks[0].tool_call?.response).toContain('[Tool output offloaded]')
      expect(state.blocks[0].status).toBe('success')
    })

    it('turns offload write failures into tool errors instead of falling back to raw content', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-offload-fail-'))
      getPathSpy = vi.spyOn(app, 'getPath').mockReturnValue(tempHome)
      const writeFileSpy = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'))

      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolPresenter = createMockToolPresenter({ cdp_send: longScreenshot })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        32000,
        1024
      )

      writeFileSpy.mockRestore()
      const toolMessage = conversation.find((message: any) => message.role === 'tool')
      expect(toolMessage.content).toContain('offloading that result to disk failed')
      expect(toolMessage.content).not.toContain(longScreenshot)
      expect(state.blocks[0].status).toBe('error')
    })

    it('marks the tool as error when offload succeeds but context budget cannot fit the stub', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-offload-clean-'))
      getPathSpy = vi.spyOn(app, 'getPath').mockReturnValue(tempHome)

      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolPresenter = createMockToolPresenter({ cdp_send: longScreenshot })
      const conversation: any[] = []

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        200,
        32
      )

      const toolMessage = conversation.find((message: any) => message.role === 'tool')
      expect(toolMessage.content).toContain('remaining context window is insufficient')
      expect(state.blocks[0].status).toBe('error')
      await expect(
        fs.access(path.join(tempHome, '.deepchat', 'sessions', 's1', 'tool_tc1.offload'))
      ).rejects.toThrow()
    })

    it('returns terminalError when even the minimal tool failure stub cannot fit', async () => {
      tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-dispatch-terminal-clean-'))
      getPathSpy = vi.spyOn(app, 'getPath').mockReturnValue(tempHome)

      const tools = [makeTool('cdp_send')]
      const longScreenshot = JSON.stringify({ data: 'x'.repeat(7000) })
      const toolPresenter = createMockToolPresenter({ cdp_send: longScreenshot })
      const conversation: any[] = []
      const hooks = {
        onPreToolUse: vi.fn(),
        onPermissionRequest: vi.fn(),
        onPostToolUse: vi.fn(),
        onPostToolUseFailure: vi.fn()
      }

      state.blocks.push({
        type: 'tool_call',
        content: '',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tc1',
          name: 'cdp_send',
          params: '{"method":"Page.captureScreenshot"}',
          response: ''
        }
      })
      state.completedToolCalls = [
        {
          id: 'tc1',
          name: 'cdp_send',
          arguments: '{"method":"Page.captureScreenshot"}'
        }
      ]

      const executed = await executeTools(
        state,
        conversation,
        0,
        tools,
        toolPresenter,
        'gpt-4',
        io,
        'full_access',
        new ToolOutputGuard(),
        1,
        1,
        hooks
      )

      expect(executed.terminalError).toContain('remaining context window is too small')
      expect(conversation.find((message: any) => message.role === 'tool')).toBeUndefined()
      expect(state.blocks[0].status).toBe('error')
      expect(hooks.onPostToolUseFailure).toHaveBeenCalledWith({
        callId: 'tc1',
        name: 'cdp_send',
        params: '{"method":"Page.captureScreenshot"}',
        error: expect.stringContaining('remaining context window is too small')
      })
      await expect(
        fs.access(path.join(tempHome, '.deepchat', 'sessions', 's1', 'tool_tc1.offload'))
      ).rejects.toThrow()
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
      state.metadata.provider = 'openai'
      state.metadata.model = 'gpt-4'
      finalizeError(state, io, new Error('fail'))

      expect(io.messageStore.setMessageError).toHaveBeenCalledWith(
        'm1',
        state.blocks,
        expect.any(String)
      )
      const metadata = JSON.parse(
        (io.messageStore.setMessageError as ReturnType<typeof vi.fn>).mock.calls[0][2]
      )
      expect(metadata.provider).toBe('openai')
      expect(metadata.model).toBe('gpt-4')
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
