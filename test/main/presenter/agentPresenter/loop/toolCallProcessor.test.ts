import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { ToolCallProcessor } from '@/presenter/agentPresenter/loop/toolCallProcessor'
import type {
  ChatMessage,
  MCPToolDefinition,
  MCPToolResponse,
  ModelConfig
} from '@shared/presenter'

vi.mock('@/presenter', () => ({
  presenter: {
    hooksNotifications: {
      dispatchEvent: vi.fn()
    }
  }
}))

describe('ToolCallProcessor tool output offload', () => {
  let tempHome: string
  let getPathSpy: ReturnType<typeof vi.spyOn>

  const toolDefinition = {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'execute command',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    server: {
      name: 'mock',
      icons: '',
      description: ''
    }
  } as MCPToolDefinition

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-offload-'))
    getPathSpy = vi.spyOn(app, 'getPath').mockReturnValue(tempHome)
  })

  afterEach(async () => {
    getPathSpy.mockRestore()
    await fs.rm(tempHome, { recursive: true, force: true })
  })

  it('offloads large tool responses and returns stub content', async () => {
    const longOutput = 'x'.repeat(5001)
    const rawData = { content: longOutput } as MCPToolResponse
    const processor = new ToolCallProcessor({
      getAllToolDefinitions: async () => [toolDefinition],
      callTool: async () => ({ content: longOutput, rawData })
    })

    const conversationMessages: ChatMessage[] = [{ role: 'assistant', content: 'hello' }]
    const conversationId = 'conv-123'
    const modelConfig = { functionCall: true } as ModelConfig

    const events: any[] = []
    for await (const event of processor.process({
      eventId: 'event-1',
      toolCalls: [{ id: 'tool-1', name: 'execute_command', arguments: '{}' }],
      enabledMcpTools: [],
      conversationMessages,
      modelConfig,
      abortSignal: new AbortController().signal,
      currentToolCallCount: 0,
      maxToolCalls: 5,
      conversationId
    })) {
      events.push(event)
    }

    const endEvent = events.find(
      (event) => event.type === 'response' && event.data?.tool_call === 'end'
    )
    expect(endEvent).toBeDefined()

    const stub = endEvent.data.tool_call_response as string
    const expectedPath = path.join(
      tempHome,
      '.deepchat',
      'sessions',
      conversationId,
      'tool_tool-1.offload'
    )
    expect(stub).toContain('[Tool output offloaded]')
    expect(stub).toContain(`Total characters: ${longOutput.length}`)
    expect(stub).toContain(expectedPath)
    expect(endEvent.data.tool_call_response_raw).toBe(rawData)

    const saved = await fs.readFile(expectedPath, 'utf-8')
    expect(saved).toBe(longOutput)

    const toolMessage = conversationMessages.find((message) => message.role === 'tool')
    expect(toolMessage?.content).toContain('[Tool output offloaded]')
  })
})

describe('ToolCallProcessor question tool', () => {
  const questionToolDef = {
    type: 'function',
    function: {
      name: 'deepchat_question',
      description: 'question tool',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    server: {
      name: 'agent-core',
      icons: '❓',
      description: 'Agent core tools'
    }
  } as MCPToolDefinition

  const executeCommandDef = {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'execute command',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    server: {
      name: 'mock',
      icons: '',
      description: ''
    }
  } as MCPToolDefinition

  const basicQuestionArgs = JSON.stringify({
    question: 'Choose one',
    options: [{ label: 'A' }, { label: 'B' }]
  })

  it('emits question-required and pauses the loop', async () => {
    const callTool = vi.fn()
    const processor = new ToolCallProcessor({
      getAllToolDefinitions: async () => [questionToolDef],
      callTool
    })

    const conversationMessages: ChatMessage[] = [{ role: 'assistant', content: 'hello' }]
    const iterator = processor.process({
      eventId: 'event-question-1',
      toolCalls: [{ id: 'tool-q1', name: 'deepchat_question', arguments: basicQuestionArgs }],
      enabledMcpTools: [],
      conversationMessages,
      modelConfig: { functionCall: true } as ModelConfig,
      abortSignal: new AbortController().signal,
      currentToolCallCount: 0,
      maxToolCalls: 5,
      conversationId: 'conv-question'
    })

    const events: any[] = []
    let result: any = null
    while (true) {
      const { value, done } = await iterator.next()
      if (done) {
        result = value
        break
      }
      events.push(value)
    }

    const questionEvent = events.find(
      (event) => event.type === 'response' && event.data?.tool_call === 'question-required'
    )
    expect(questionEvent).toBeDefined()
    expect(questionEvent.data.question_request?.question).toBe('Choose one')
    expect(result.needContinueConversation).toBe(false)
    expect(callTool).not.toHaveBeenCalled()
  })

  it('rejects non-standalone question tool calls', async () => {
    const callTool = vi.fn(async () => ({
      content: 'ok',
      rawData: { content: 'ok' } as MCPToolResponse
    }))
    const processor = new ToolCallProcessor({
      getAllToolDefinitions: async () => [questionToolDef, executeCommandDef],
      callTool
    })

    const conversationMessages: ChatMessage[] = [{ role: 'assistant', content: 'hello' }]
    const iterator = processor.process({
      eventId: 'event-question-2',
      toolCalls: [
        { id: 'tool-q1', name: 'deepchat_question', arguments: basicQuestionArgs },
        { id: 'tool-2', name: 'execute_command', arguments: '{}' }
      ],
      enabledMcpTools: [],
      conversationMessages,
      modelConfig: { functionCall: true } as ModelConfig,
      abortSignal: new AbortController().signal,
      currentToolCallCount: 0,
      maxToolCalls: 5,
      conversationId: 'conv-question'
    })

    const events: any[] = []
    let result: any = null
    while (true) {
      const { value, done } = await iterator.next()
      if (done) {
        result = value
        break
      }
      events.push(value)
    }

    const errorEvent = events.find(
      (event) => event.type === 'response' && event.data?.question_error
    )
    expect(errorEvent).toBeDefined()
    expect(result.needContinueConversation).toBe(true)
    expect(callTool).toHaveBeenCalled()
  })
})

describe('ToolCallProcessor batch permission pre-check', () => {
  it('preserves extended permission payload fields for batch permission requests', async () => {
    const toolDefinition = {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'edit file',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      server: {
        name: 'agent-filesystem',
        icons: '📁',
        description: 'Agent filesystem'
      }
    } as MCPToolDefinition

    const callTool = vi.fn(async () => ({
      content: 'ok',
      rawData: { content: 'ok' } as MCPToolResponse
    }))
    const preCheckToolPermission = vi.fn(async () => ({
      needsPermission: true as const,
      toolName: 'edit_file',
      serverName: 'agent-filesystem',
      permissionType: 'write' as const,
      description: 'Write access requires approval',
      paths: ['src/main.ts'],
      customMeta: {
        source: 'batch-precheck'
      }
    }))

    const processor = new ToolCallProcessor({
      getAllToolDefinitions: async () => [toolDefinition],
      callTool,
      preCheckToolPermission
    })

    const conversationMessages: ChatMessage[] = [{ role: 'assistant', content: 'hello' }]
    const iterator = processor.process({
      eventId: 'event-batch-permission',
      toolCalls: [{ id: 'tool-1', name: 'edit_file', arguments: '{"path":"src/main.ts"}' }],
      enabledMcpTools: [],
      conversationMessages,
      modelConfig: { functionCall: true } as ModelConfig,
      abortSignal: new AbortController().signal,
      currentToolCallCount: 0,
      maxToolCalls: 5,
      conversationId: 'conv-batch-permission'
    })

    const events: any[] = []
    let result: any = null
    while (true) {
      const { value, done } = await iterator.next()
      if (done) {
        result = value
        break
      }
      events.push(value)
    }

    const permissionEvent = events.find(
      (event) => event.type === 'response' && event.data?.tool_call === 'permission-required'
    )
    expect(permissionEvent).toBeDefined()
    expect(permissionEvent.data.permission_request.paths).toEqual(['src/main.ts'])
    expect(permissionEvent.data.permission_request.customMeta).toEqual({
      source: 'batch-precheck'
    })
    expect(permissionEvent.data.permission_request.isBatchPermission).toBe(true)
    expect(permissionEvent.data.permission_request.totalInBatch).toBe(1)
    expect(callTool).not.toHaveBeenCalled()
    expect(result.needContinueConversation).toBe(false)
  })
})
