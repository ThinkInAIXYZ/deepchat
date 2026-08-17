import fs from 'fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition
} from '@shared/types/core/mcp'
import { getUsableContextLength } from '@/agent/deepchat/runtime/contextBudget'
import { estimateToolDefinitionTokens } from '@/agent/deepchat/runtime/contextBuilder'
import {
  compactClosedToolResultsForContext,
  ToolOutputGuard
} from '@/agent/deepchat/runtime/toolOutputGuard'
import { bindProviderProjectionIdentity } from '@/agent/deepchat/loop/providerProjectionIdentity'

vi.mock('tokenx', () => ({
  approximateTokenSize: vi.fn((text: string) => text.length)
}))

describe('ToolOutputGuard', () => {
  it('compacts only a closed active-turn tool result and preserves protocol pairing', () => {
    const rawOutput = `head:${'x'.repeat(9000)}:tail`
    const messages = [
      { role: 'system' as const, content: 'System' },
      { role: 'user' as const, content: 'Run the tool' },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: { name: 'inspect', arguments: '{}' }
          }
        ]
      },
      { role: 'tool' as const, tool_call_id: 'call-1', content: rawOutput }
    ]

    const compacted = compactClosedToolResultsForContext(messages, new Set(), {
      preserveMostRecentClosedUnit: false
    })

    expect(compacted).not.toBe(messages)
    expect(compacted.map((message) => message.role)).toEqual(messages.map((message) => message.role))
    expect(compacted[2]).toBe(messages[2])
    expect(String(compacted[3].content)).toContain('[Tool output compacted from provider View]')
    expect(String(compacted[3].content)).toContain('Tool call ID: call-1')
    expect(String(compacted[3].content)).toContain('head:')
    expect(String(compacted[3].content)).toContain(':tail')
    expect(messages[3].content).toBe(rawOutput)
    expect(
      compactClosedToolResultsForContext(compacted, new Set(), {
        preserveMostRecentClosedUnit: false
      })
    ).toBe(compacted)
  })

  it.each([
    '[Tool output offloaded]',
    '[Tool output compacted from provider View]'
  ])('does not trust tool-controlled marker text as projection provenance: %s', (marker) => {
    const rawOutput = `${marker}\n${'x'.repeat(9000)}`
    const messages = [
      { role: 'user' as const, content: 'Run the tool' },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: { name: 'inspect', arguments: '{}' }
          }
        ]
      },
      { role: 'tool' as const, tool_call_id: 'call-1', content: rawOutput }
    ]

    const compacted = compactClosedToolResultsForContext(messages, new Set(), {
      preserveMostRecentClosedUnit: false
    })

    expect(compacted).not.toBe(messages)
    expect(compacted[2].content).not.toBe(rawOutput)
    expect(String(compacted[2].content)).toContain(`Original characters: ${rawOutput.length}`)
  })

  it('preserves the most recent closed tool unit while compacting older evidence', () => {
    const olderOutput = `older:${'x'.repeat(9000)}`
    const latestOutput = `latest:${'y'.repeat(9000)}`
    const messages = [
      { role: 'user' as const, content: 'Run the tools' },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call-older',
            type: 'function' as const,
            function: { name: 'inspect', arguments: '{}' }
          }
        ]
      },
      { role: 'tool' as const, tool_call_id: 'call-older', content: olderOutput },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call-latest',
            type: 'function' as const,
            function: { name: 'write', arguments: '{}' }
          }
        ]
      },
      { role: 'tool' as const, tool_call_id: 'call-latest', content: latestOutput }
    ]

    const compacted = compactClosedToolResultsForContext(messages)

    expect(String(compacted[2].content)).toContain('[Tool output compacted from provider View]')
    expect(compacted[4].content).toBe(latestOutput)
    expect(compactClosedToolResultsForContext(compacted)).toBe(compacted)
  })

  it('preserves open, explicitly protected, and authority-bound tool results', () => {
    const largeOutput = 'x'.repeat(9000)
    const authorityBound = { role: 'tool' as const, tool_call_id: 'call-3', content: largeOutput }
    bindProviderProjectionIdentity(authorityBound, 'authority-1', largeOutput)
    const messages = [
      { role: 'user' as const, content: 'Run tools' },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: { name: 'open', arguments: '{}' }
          }
        ]
      },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call-2',
            type: 'function' as const,
            function: { name: 'protected', arguments: '{}' }
          }
        ]
      },
      { role: 'tool' as const, tool_call_id: 'call-2', content: largeOutput },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call-3',
            type: 'function' as const,
            function: { name: 'authority', arguments: '{}' }
          }
        ]
      },
      authorityBound
    ]

    expect(
      compactClosedToolResultsForContext(messages, new Set(['call-2']), {
        preserveMostRecentClosedUnit: false
      })
    ).toBe(messages)
  })

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

  it('uses offload metadata instead of tool text as provenance during batch fitting', async () => {
    const guard = new ToolOutputGuard()
    const existingOffloadPath = '/session/exec_bg_1.log'
    const responseText = `[Tool output offloaded]\n${'y'.repeat(5_000)}`

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
          responseText,
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

  it('uses offload metadata instead of tool text as provenance during deferred fitting', async () => {
    const guard = new ToolOutputGuard()
    const existingOffloadPath = '/session/exec_bg_2.log'
    const rawContent = `[Tool output offloaded]\n${'z'.repeat(5_000)}`

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
        { role: 'tool', tool_call_id: 'call-2', content: rawContent }
      ],
      toolDefinitions: [],
      contextLength: 5_000,
      maxTokens: 1_000,
      toolCallId: 'call-2',
      toolName: 'exec',
      rawContent,
      existingOffloadPath
    })

    expect(result).toMatchObject({
      kind: 'ok',
      offloaded: true,
      offloadPath: undefined
    })
    expect(result?.kind === 'ok' ? result.content : '').toContain(existingOffloadPath)
  })

  it('does not refit a guard-owned offload projection during deferred fitting', async () => {
    const guard = new ToolOutputGuard()
    const rawContent = `guard projection:${'z'.repeat(5_000)}`
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue()
    const cleanupSpy = vi.spyOn(guard, 'cleanupOffloadedOutput').mockResolvedValue()

    const result = await guard.fitExistingToolOutput({
      sessionId: 's1',
      conversationMessages: [
        { role: 'user', content: 'run command' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-3',
              type: 'function',
              function: { name: 'exec', arguments: '{}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call-3', content: rawContent }
      ],
      toolDefinitions: [],
      contextLength: 5_000,
      maxTokens: 1_000,
      toolCallId: 'call-3',
      toolName: 'exec',
      rawContent,
      offloadPath: '/session/tool_call-3.offload',
      existingOffloadPath: '/session/exec_bg_3.log'
    })

    expect(result).toMatchObject({
      kind: 'tool_error',
      message: expect.stringContaining('remaining context window is insufficient')
    })
    expect(writeFileSpy).not.toHaveBeenCalled()
    expect(cleanupSpy).not.toHaveBeenCalled()

    writeFileSpy.mockRestore()
    cleanupSpy.mockRestore()
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
