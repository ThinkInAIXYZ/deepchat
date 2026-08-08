import { describe, expect, it, vi } from 'vitest'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition
} from '@shared/types/core/mcp'
import { getUsableContextLength } from '@/agent/deepchat/runtime/contextBudget'
import { estimateToolDefinitionTokens } from '@/agent/deepchat/runtime/contextBuilder'
import { ToolOutputGuard } from '@/agent/deepchat/runtime/toolOutputGuard'

vi.mock('tokenx', () => ({
  approximateTokenSize: vi.fn((text: string) => text.length)
}))

describe('ToolOutputGuard', () => {
  it('checks tool continuation budget against the safety-adjusted context window', () => {
    const guard = new ToolOutputGuard()
    const toolDefinitions: MCPToolDefinition[] = [
      {
        execution: TOOL_EXECUTION.read.sequential,
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Read current project state.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            },
            required: ['query']
          }
        },
        server: {
          name: 'test',
          icons: '',
          description: 'Test server'
        }
      }
    ]
    const toolDefinitionTokens = estimateToolDefinitionTokens(toolDefinitions)
    const maxMessageTokens = getUsableContextLength(5000) - 1000 - toolDefinitionTokens

    expect(
      guard.hasContextBudget({
        conversationMessages: [{ role: 'user', content: 'x'.repeat(maxMessageTokens) }],
        toolDefinitions,
        contextLength: 5000,
        maxTokens: 1000
      })
    ).toBe(true)
    expect(
      guard.hasContextBudget({
        conversationMessages: [
          {
            role: 'user',
            content: 'x'.repeat(getUsableContextLength(5000) - toolDefinitionTokens)
          }
        ],
        toolDefinitions,
        contextLength: 5000,
        maxTokens: 1000
      })
    ).toBe(false)
  })

  it('allows tool continuations when the next provider request can be refitted', async () => {
    const guard = new ToolOutputGuard()

    const result = await guard.fitToolBatchOutputs({
      sessionId: 's1',
      conversationMessages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'x'.repeat(4500) },
        { role: 'user', content: 'run tool' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'exec', arguments: '{}' }
            }
          ]
        }
      ],
      results: [
        {
          toolCallId: 'call-1',
          toolName: 'exec',
          responseText: 'ok',
          isError: false
        }
      ],
      toolDefinitions: [],
      contextLength: 5000,
      maxTokens: 1000
    })

    expect(result.kind).toBe('ok')
    expect(result.results[0]).toMatchObject({
      contextResponseText: 'ok',
      downgraded: false
    })
  })

  it('uses the resolved Agent threshold for guarded tool output', async () => {
    const guard = new ToolOutputGuard(() => ({
      readFileAutoTruncateChars: 4_500,
      toolOutputInlineChars: 6_000,
      commandOutputInlineChars: 12_000
    }))
    const rawContent = 'x'.repeat(5_500)

    await expect(
      guard.prepareToolOutput({
        sessionId: 's1',
        toolCallId: 'call-1',
        toolName: 'cdp_send',
        rawContent
      })
    ).resolves.toEqual({
      kind: 'ok',
      content: rawContent,
      offloaded: false,
      offloadPath: undefined
    })
  })

  it('reuses an existing command log when context fitting needs a smaller stub', async () => {
    const guard = new ToolOutputGuard()
    const existingOffloadPath = '/session/exec_bg_1.log'

    const result = await guard.fitToolBatchOutputs({
      sessionId: 's1',
      conversationMessages: [
        { role: 'user', content: 'x'.repeat(2_200) },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'exec', arguments: '{}' }
            }
          ]
        }
      ],
      results: [
        {
          toolCallId: 'call-1',
          toolName: 'exec',
          responseText: 'y'.repeat(5_000),
          isError: false,
          existingOffloadPath
        }
      ],
      toolDefinitions: [],
      contextLength: 5_000,
      maxTokens: 1_000
    })

    expect(result.kind).toBe('ok')
    expect(result.results[0].responseText).toContain('[Tool output offloaded]')
    expect(result.results[0].responseText).toContain(existingOffloadPath)
    expect(result.results[0].offloadPath).toBeUndefined()
    expect(result.results[0].downgraded).toBe(false)
  })

  it('reuses an existing command log while fitting a deferred tool result', async () => {
    const guard = new ToolOutputGuard()
    const existingOffloadPath = '/session/exec_bg_2.log'

    const result = await guard.fitExistingToolOutput({
      sessionId: 's1',
      conversationMessages: [
        { role: 'user', content: 'run command' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-2',
              type: 'function',
              function: { name: 'exec', arguments: '{}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call-2', content: 'z'.repeat(5_000) }
      ],
      toolDefinitions: [],
      contextLength: 5_000,
      maxTokens: 1_000,
      toolCallId: 'call-2',
      toolName: 'exec',
      rawContent: 'z'.repeat(5_000),
      existingOffloadPath
    })

    expect(result).toMatchObject({
      kind: 'ok',
      offloaded: true,
      offloadPath: undefined
    })
    expect(result?.kind === 'ok' ? result.content : '').toContain(existingOffloadPath)
  })

  it('stops fitting deferred tool output when the resume is already cancelled', async () => {
    const guard = new ToolOutputGuard()
    const controller = new AbortController()
    controller.abort()

    await expect(
      guard.fitExistingToolOutput({
        sessionId: 's1',
        conversationMessages: [],
        toolDefinitions: [],
        contextLength: 5_000,
        maxTokens: 1_000,
        toolCallId: 'call-3',
        toolName: 'exec',
        rawContent: 'output',
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
