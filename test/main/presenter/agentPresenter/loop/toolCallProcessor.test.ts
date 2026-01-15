import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { ToolCallProcessor } from '@/presenter/agentPresenter/loop'
import type {
  ChatMessage,
  MCPToolDefinition,
  MCPToolResponse,
  ModelConfig
} from '@shared/presenter'

describe('ToolCallProcessor tool output offload', () => {
  let tempHome: string
  let getPathSpy: ReturnType<typeof vi.spyOn>

  const toolDefinition = {
    type: 'function',
    function: {
      name: 'mock_tool',
      description: 'mock tool',
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
    const longOutput = 'x'.repeat(3001)
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
      toolCalls: [{ id: 'tool-1', name: 'mock_tool', arguments: '{}' }],
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
