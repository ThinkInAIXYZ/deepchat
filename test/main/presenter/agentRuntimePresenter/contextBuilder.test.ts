import { describe, it, expect, vi } from 'vitest'
import {
  buildContext,
  buildContextWithMetadata,
  buildResumeContext,
  buildResumeContextWithMetadata,
  fitMessagesToContextWindow,
  truncateContext
} from '@/presenter/agentRuntimePresenter/contextBuilder'

vi.mock('tokenx', () => ({
  approximateTokenSize: vi.fn((text: string) => {
    // Simple mock: 1 token per 4 characters
    return Math.ceil(text.length / 4)
  })
}))

function createMockMessageStore(messages: any[] = []) {
  return {
    getMessages: vi.fn().mockReturnValue(messages)
  } as any
}

function makeUserRecord(
  orderSeq: number,
  text: string,
  status: 'sent' | 'pending' | 'error' = 'sent'
) {
  return {
    id: `user-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'user' as const,
    content: JSON.stringify({ text, files: [], links: [], search: false, think: false }),
    status,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function makeUserRecordWithFiles(
  orderSeq: number,
  text: string,
  files: Array<Record<string, unknown>>
) {
  return {
    id: `user-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'user' as const,
    content: JSON.stringify({ text, files, links: [], search: false, think: false }),
    status: 'sent' as const,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function makeAssistantRecord(
  orderSeq: number,
  text: string,
  status: 'sent' | 'pending' | 'error' = 'sent'
) {
  return {
    id: `asst-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'assistant' as const,
    content: JSON.stringify([
      { type: 'content', content: text, status: 'success', timestamp: Date.now() }
    ]),
    status,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function makeAssistantErrorRecord(
  orderSeq: number,
  errorMessage: string,
  partialText: string = ''
) {
  return {
    id: `asst-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'assistant' as const,
    content: JSON.stringify([
      ...(partialText
        ? [{ type: 'content', content: partialText, status: 'success', timestamp: Date.now() }]
        : []),
      { type: 'error', content: errorMessage, status: 'error', timestamp: Date.now() }
    ]),
    status: 'error' as const,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function makeAssistantErrorWithToolRecord(
  orderSeq: number,
  text: string,
  toolResponse: string,
  errorMessage: string
) {
  return {
    id: `asst-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'assistant' as const,
    content: JSON.stringify([
      { type: 'content', content: text, status: 'success', timestamp: Date.now() },
      {
        type: 'tool_call',
        status: 'success',
        timestamp: Date.now(),
        tool_call: {
          id: `tc-${orderSeq}`,
          name: 'example_tool',
          params: '{"foo":"bar"}',
          response: toolResponse
        }
      },
      { type: 'error', content: errorMessage, status: 'error', timestamp: Date.now() }
    ]),
    status: 'error' as const,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function makeAssistantWithReasoningRecord(orderSeq: number, text: string, reasoning: string) {
  return {
    id: `asst-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'assistant' as const,
    content: JSON.stringify([
      { type: 'reasoning_content', content: reasoning, status: 'success', timestamp: Date.now() },
      { type: 'content', content: text, status: 'success', timestamp: Date.now() }
    ]),
    status: 'sent' as const,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function makeAssistantWithToolRecord(
  orderSeq: number,
  text: string,
  toolResponse: string,
  status: 'sent' | 'pending' | 'error' = 'sent'
) {
  return {
    id: `asst-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'assistant' as const,
    content: JSON.stringify([
      { type: 'content', content: text, status: 'success', timestamp: Date.now() },
      {
        type: 'tool_call',
        status: 'success',
        timestamp: Date.now(),
        tool_call: {
          id: `tc-${orderSeq}`,
          name: 'example_tool',
          params: '{"foo":"bar"}',
          response: toolResponse
        }
      }
    ]),
    status,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function makeAssistantWithReasoningAndToolRecord(
  orderSeq: number,
  text: string,
  reasoning: string,
  toolResponse: string
) {
  return {
    id: `asst-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'assistant' as const,
    content: JSON.stringify([
      { type: 'reasoning_content', content: reasoning, status: 'success', timestamp: Date.now() },
      { type: 'content', content: text, status: 'success', timestamp: Date.now() },
      {
        type: 'tool_call',
        status: 'success',
        timestamp: Date.now(),
        tool_call: {
          id: `tc-${orderSeq}`,
          name: 'example_tool',
          params: '{"foo":"bar"}',
          response: toolResponse
        }
      }
    ]),
    status: 'sent' as const,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function makeAssistantWithToolProviderOptionsRecord(
  orderSeq: number,
  text: string,
  toolResponse: string
) {
  return {
    id: `asst-${orderSeq}`,
    sessionId: 's1',
    orderSeq,
    role: 'assistant' as const,
    content: JSON.stringify([
      { type: 'content', content: text, status: 'success', timestamp: Date.now() },
      {
        type: 'tool_call',
        status: 'success',
        timestamp: Date.now(),
        extra: {
          providerOptionsJson: JSON.stringify({
            vertex: {
              thoughtSignature: 'tool-thought-signature'
            }
          })
        },
        tool_call: {
          id: `tc-${orderSeq}`,
          name: 'example_tool',
          params: '{"foo":"bar"}',
          response: toolResponse
        }
      }
    ]),
    status: 'sent' as const,
    isContextEdge: 0,
    metadata: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

describe('truncateContext', () => {
  it('returns all messages when within budget', () => {
    const history = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there' }
    ]
    const result = truncateContext(history, 1000)
    expect(result).toEqual(history)
  })

  it('drops oldest messages when over budget', () => {
    // Each message ~2-3 tokens with our mock (1 token per 4 chars)
    // "Hello" = 2 tokens, "Hi" = 1 token, "What?" = 2 tokens, "Nothing" = 2 tokens
    const history = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' },
      { role: 'user' as const, content: 'What?' },
      { role: 'assistant' as const, content: 'Nothing' }
    ]
    // Total = 2+1+2+2 = 7 tokens. Budget = 4 tokens.
    const result = truncateContext(history, 4)
    // Should drop "Hello"(2) and "Hi"(1) → remaining = 4, fits
    expect(result).toEqual([
      { role: 'user', content: 'What?' },
      { role: 'assistant', content: 'Nothing' }
    ])
  })

  it('returns empty array when nothing fits', () => {
    const history = [{ role: 'user' as const, content: 'Hello world this is a long message' }]
    const result = truncateContext(history, 0)
    expect(result).toEqual([])
  })

  it('drops assistant+tool_call messages as a group', () => {
    // assistant with tool_calls followed by tool results — should be dropped together
    const history = [
      {
        role: 'assistant' as const,
        content: 'Let me check',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function' as const,
            function: { name: 'get_weather', arguments: '{}' }
          }
        ]
      },
      { role: 'tool' as const, tool_call_id: 'tc1', content: 'Sunny' },
      { role: 'assistant' as const, content: 'The weather is sunny.' },
      { role: 'user' as const, content: 'Thanks' },
      { role: 'assistant' as const, content: 'You are welcome' }
    ]
    // Total tokens: 4+2+6+2+4 = 18. Budget = 6.
    // Drop assistant+tool (4+2=6), drop next assistant (6) → remaining = 6, fits
    const result = truncateContext(history, 6)
    expect(result).toEqual([
      { role: 'user', content: 'Thanks' },
      { role: 'assistant', content: 'You are welcome' }
    ])
  })

  it('drops orphaned tool messages at the start', () => {
    // If somehow tool messages appear at the start after truncation, drop them
    const history = [
      { role: 'tool' as const, tool_call_id: 'tc1', content: 'result' },
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' }
    ]
    const result = truncateContext(history, 1000)
    // No truncation needed — but if we started with orphaned tool, it should remain
    // since total fits. The orphan guard only kicks in after truncation.
    expect(result).toEqual(history)
  })
})

describe('buildContext', () => {
  it('returns [system, user] when no history', () => {
    const store = createMockMessageStore([])
    const result = buildContext('s1', 'Hello', 'You are helpful', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' }
    ])
  })

  it('omits system message when system prompt is empty', () => {
    const store = createMockMessageStore([])
    const result = buildContext('s1', 'Hello', '', 10000, 4096, store)

    expect(result).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('omits blank text-only user messages from prompts', () => {
    const store = createMockMessageStore([makeUserRecord(1, '   ')])
    const result = buildContext('s1', '   ', '', 10000, 4096, store)

    expect(result).toEqual([])
  })

  it('keeps attachment-only user messages valid when text is blank', () => {
    const store = createMockMessageStore([])
    const result = buildContext(
      's1',
      {
        text: '   ',
        files: [
          {
            name: 'notes.txt',
            path: '/tmp/notes.txt',
            mimeType: 'text/plain',
            content: 'important attachment content'
          } as any
        ]
      },
      '',
      10000,
      4096,
      store
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('important attachment content')
      }
    ])
  })

  it('includes single prior exchange', () => {
    const messages = [makeUserRecord(1, 'First message'), makeAssistantRecord(2, 'First reply')]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'Second message', 'System', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First reply' },
      { role: 'user', content: 'Second message' }
    ])
  })

  it('includes multiple prior exchanges in order', () => {
    const messages = [
      makeUserRecord(1, 'msg1'),
      makeAssistantRecord(2, 'reply1'),
      makeUserRecord(3, 'msg2'),
      makeAssistantRecord(4, 'reply2')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'msg3', 'System', 10000, 4096, store)

    expect(result).toHaveLength(6) // system + 4 history + new user
    expect(result[0]).toEqual({ role: 'system', content: 'System' })
    expect(result[1]).toEqual({ role: 'user', content: 'msg1' })
    expect(result[2]).toEqual({ role: 'assistant', content: 'reply1' })
    expect(result[3]).toEqual({ role: 'user', content: 'msg2' })
    expect(result[4]).toEqual({ role: 'assistant', content: 'reply2' })
    expect(result[5]).toEqual({ role: 'user', content: 'msg3' })
  })

  it('includes assistant error messages with readable failure reasons', () => {
    const messages = [
      makeUserRecord(1, 'msg1'),
      makeAssistantErrorRecord(2, 'provider exploded'),
      makeUserRecord(3, 'msg2'),
      makeAssistantRecord(4, 'good reply')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'msg3', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'msg1' },
      { role: 'assistant', content: '[Generation failed]\nReason: provider exploded' },
      { role: 'user', content: 'msg2' },
      { role: 'assistant', content: 'good reply' },
      { role: 'user', content: 'msg3' }
    ])
  })

  it('filters out pending messages', () => {
    const messages = [makeUserRecord(1, 'msg1'), makeAssistantRecord(2, 'pending reply', 'pending')]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'msg2', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'msg1' },
      { role: 'user', content: 'msg2' }
    ])
  })

  it('filters out errored user messages', () => {
    const messages = [makeUserRecord(1, 'failed submit', 'error'), makeUserRecord(2, 'msg2')]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'msg3', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'msg2' },
      { role: 'user', content: 'msg3' }
    ])
  })

  it('converts canceled assistant messages to a readable cancel summary', () => {
    const messages = [
      makeUserRecord(1, 'stop this'),
      makeAssistantErrorRecord(2, 'common.error.userCanceledGeneration')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'continue', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'stop this' },
      {
        role: 'assistant',
        content: '[Generation canceled]\nReason: User canceled generation'
      },
      { role: 'user', content: 'continue' }
    ])
  })

  it('preserves partial assistant content before the failure reason', () => {
    const messages = [
      makeUserRecord(1, 'do work'),
      makeAssistantErrorRecord(2, 'timeout', 'Partial answer')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'continue', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'do work' },
      {
        role: 'assistant',
        content: 'Partial answer\n\n[Generation failed]\nReason: timeout'
      },
      { role: 'user', content: 'continue' }
    ])
  })

  it('replays settled tool calls before appending terminal failure context', () => {
    const messages = [
      makeUserRecord(1, 'use a tool'),
      makeAssistantErrorWithToolRecord(2, 'Checking...', 'tool result', 'terminal failure')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'continue', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'use a tool' },
      {
        role: 'assistant',
        content: 'Checking...',
        tool_calls: [
          {
            id: 'tc-2',
            type: 'function',
            function: { name: 'example_tool', arguments: '{"foo":"bar"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc-2', content: 'tool result' },
      { role: 'assistant', content: '[Generation failed]\nReason: terminal failure' },
      { role: 'user', content: 'continue' }
    ])
  })

  it('concatenates assistant content and reasoning blocks', () => {
    const messages = [
      makeUserRecord(1, 'Think about this'),
      makeAssistantWithReasoningRecord(2, 'The answer is 42', 'Let me think...')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'Follow up', '', 10000, 4096, store)

    expect(result[1]).toEqual({
      role: 'assistant',
      content: 'Let me think...The answer is 42'
    })
  })

  it('preserves reasoning_content separately for non-tool assistant history when enabled', () => {
    const messages = [
      makeUserRecord(1, 'Think about this'),
      makeAssistantWithReasoningRecord(2, 'The answer is 42', 'Let me think...')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'Follow up', '', 10000, 4096, store, false, {
      preserveInterleavedReasoning: true
    })

    expect(result[1]).toEqual({
      role: 'assistant',
      content: 'The answer is 42',
      reasoning_content: 'Let me think...'
    })
  })

  it('does not add empty reasoning_content for non-tool assistant history', () => {
    const messages = [makeUserRecord(1, 'Think about this'), makeAssistantRecord(2, 'Answer only')]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'Follow up', '', 10000, 4096, store, false, {
      preserveInterleavedReasoning: true,
      preserveEmptyInterleavedReasoning: true
    })

    expect(result[1]).toEqual({
      role: 'assistant',
      content: 'Answer only'
    })
  })

  it('preserves reasoning_content separately for settled tool calls when enabled', () => {
    const messages = [
      makeUserRecord(1, 'Use a tool'),
      makeAssistantWithReasoningAndToolRecord(2, 'Tool finished', 'Let me think...', 'All good')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'next', '', 10000, 4096, store, false, {
      preserveInterleavedReasoning: true
    })

    expect(result).toEqual([
      { role: 'user', content: 'Use a tool' },
      {
        role: 'assistant',
        content: 'Tool finished',
        reasoning_content: 'Let me think...',
        tool_calls: [
          {
            id: 'tc-2',
            type: 'function',
            function: { name: 'example_tool', arguments: '{"foo":"bar"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc-2', content: 'All good' },
      { role: 'user', content: 'next' }
    ])
  })

  it('adds empty reasoning_content for settled tool calls when empty interleaved preservation is enabled', () => {
    const messages = [
      makeUserRecord(1, 'Use a tool'),
      makeAssistantWithToolRecord(2, '', 'All good')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'next', '', 10000, 4096, store, false, {
      preserveInterleavedReasoning: true,
      preserveEmptyInterleavedReasoning: true
    })

    expect(result).toEqual([
      { role: 'user', content: 'Use a tool' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: '',
        tool_calls: [
          {
            id: 'tc-2',
            type: 'function',
            function: { name: 'example_tool', arguments: '{"foo":"bar"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc-2', content: 'All good' },
      { role: 'user', content: 'next' }
    ])
  })

  it('does not add empty reasoning_content when empty interleaved preservation is disabled', () => {
    const messages = [
      makeUserRecord(1, 'Use a tool'),
      makeAssistantWithToolRecord(2, '', 'All good')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'next', '', 10000, 4096, store, false, {
      preserveInterleavedReasoning: true
    })

    expect(result[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'tc-2',
          type: 'function',
          function: { name: 'example_tool', arguments: '{"foo":"bar"}' }
        }
      ]
    })
  })

  it('does not preserve reasoning_content separately for settled tool calls when disabled', () => {
    const messages = [
      makeUserRecord(1, 'Use a tool'),
      makeAssistantWithReasoningAndToolRecord(2, 'Tool finished', 'Let me think...', 'All good')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'next', '', 10000, 4096, store, false, {
      preserveInterleavedReasoning: false
    })

    expect(result).toEqual([
      { role: 'user', content: 'Use a tool' },
      {
        role: 'assistant',
        content: 'Tool finished',
        tool_calls: [
          {
            id: 'tc-2',
            type: 'function',
            function: { name: 'example_tool', arguments: '{"foo":"bar"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc-2', content: 'All good' },
      { role: 'user', content: 'next' }
    ])
  })

  it('truncates oldest history when over context limit', () => {
    // Use a very small context to trigger truncation
    // With our mock: 1 token per 4 chars
    const messages = [
      makeUserRecord(1, 'A'.repeat(400)), // 100 tokens
      makeAssistantRecord(2, 'B'.repeat(400)), // 100 tokens
      makeUserRecord(3, 'C'.repeat(40)), // 10 tokens
      makeAssistantRecord(4, 'D'.repeat(40)) // 10 tokens
    ]
    const store = createMockMessageStore(messages)

    // contextLength=300, maxTokens=100, systemPrompt ~4 tokens, newUser ~3 tokens
    // available = 300 - 4 - 3 - 100 = 193 tokens
    // total history = 100+100+10+10 = 220 tokens > 193
    // Drop first (100) → 120 > 193? No, 120 < 193 → fits
    const result = buildContext('s1', 'New message', 'Sys', 300, 100, store)

    // Should include: system + (msg3, reply3, msg4, reply4 — minus oldest) + new user
    // First pair (100+100=200) dropped, remaining (10+10=20) fits
    expect(result[0]).toEqual({ role: 'system', content: 'Sys' })
    // After truncation, the 100-token messages should be dropped
    expect(result.length).toBeGreaterThanOrEqual(3) // system + some history + new user
    expect(result[result.length - 1]).toEqual({ role: 'user', content: 'New message' })
  })

  it('returns only system + new user when all history is too large', () => {
    const messages = [
      makeUserRecord(1, 'A'.repeat(4000)), // 1000 tokens
      makeAssistantRecord(2, 'B'.repeat(4000)) // 1000 tokens
    ]
    const store = createMockMessageStore(messages)

    // contextLength=100, maxTokens=50 → available very small
    const result = buildContext('s1', 'Hi', 'Sys', 100, 50, store)

    expect(result).toEqual([
      { role: 'system', content: 'Sys' },
      { role: 'user', content: 'Hi' }
    ])
  })

  it('calls getMessages with correct sessionId', () => {
    const store = createMockMessageStore([])
    buildContext('my-session', 'Hello', '', 10000, 4096, store)
    expect(store.getMessages).toHaveBeenCalledWith('my-session')
  })

  it('starts history from summary cursor', () => {
    const messages = [
      makeUserRecord(1, 'old user'),
      makeAssistantRecord(2, 'old reply'),
      makeUserRecord(3, 'recent user'),
      makeAssistantRecord(4, 'recent reply')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'next', 'System', 10000, 4096, store, false, {
      summaryCursorOrderSeq: 3
    })

    expect(result).toEqual([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'recent user' },
      { role: 'assistant', content: 'recent reply' },
      { role: 'user', content: 'next' }
    ])
  })

  it('emits summary cursor metadata instead of per-record before_summary_cursor refs', () => {
    const messages = [
      makeUserRecord(1, 'old user'),
      makeAssistantRecord(2, 'old reply'),
      makeUserRecord(3, 'recent user'),
      makeAssistantRecord(4, 'recent reply')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContextWithMetadata('s1', 'next', 'System', 10000, 4096, store, false, {
      summaryCursorOrderSeq: 3
    })

    expect(result.metadata.summaryCursor).toEqual({
      summaryCursorOrderSeq: 3,
      preCursorOrderSeqMin: 1,
      preCursorOrderSeqMax: 2,
      preCursorCount: 2
    })
    expect(
      result.metadata.excludedRecords.some(
        (item) => (item.reason as string) === 'before_summary_cursor'
      )
    ).toBe(false)
  })

  it('reports zero pre-cursor records when the cursor is at the start', () => {
    const messages = [makeUserRecord(1, 'a'), makeAssistantRecord(2, 'b')]
    const store = createMockMessageStore(messages)
    const result = buildContextWithMetadata('s1', 'next', 'System', 10000, 4096, store)

    expect(result.metadata.summaryCursor).toEqual({
      summaryCursorOrderSeq: 1,
      preCursorOrderSeqMin: null,
      preCursorOrderSeqMax: null,
      preCursorCount: 0
    })
  })

  it('builds from provided history records without rereading newer persisted messages', () => {
    const messages = [
      makeUserRecord(1, 'old user'),
      makeAssistantRecord(2, 'old reply'),
      makeUserRecord(3, 'new user already persisted')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext(
      's1',
      'new user already persisted',
      'System',
      10000,
      4096,
      store,
      false,
      {
        historyRecords: messages.slice(0, 2)
      }
    )

    expect(result).toEqual([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'old user' },
      { role: 'assistant', content: 'old reply' },
      { role: 'user', content: 'new user already persisted' }
    ])
  })

  it('only replays settled tool calls with non-empty responses', () => {
    const messages = [
      makeUserRecord(1, 'check this'),
      makeAssistantWithToolRecord(2, 'Done', ''),
      makeAssistantWithToolRecord(3, 'Tool finished', 'All good')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'next', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'check this' },
      { role: 'assistant', content: 'Done' },
      {
        role: 'assistant',
        content: 'Tool finished',
        tool_calls: [
          {
            id: 'tc-3',
            type: 'function',
            function: { name: 'example_tool', arguments: '{"foo":"bar"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc-3', content: 'All good' },
      { role: 'user', content: 'next' }
    ])
  })

  it('replays settled tool call provider options for follow-up turns', () => {
    const messages = [
      makeUserRecord(1, 'check this'),
      makeAssistantWithToolProviderOptionsRecord(2, 'Tool finished', 'All good')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'next', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'check this' },
      {
        role: 'assistant',
        content: 'Tool finished',
        tool_calls: [
          {
            id: 'tc-2',
            type: 'function',
            function: { name: 'example_tool', arguments: '{"foo":"bar"}' },
            provider_options: {
              vertex: {
                thoughtSignature: 'tool-thought-signature'
              }
            }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc-2', content: 'All good' },
      { role: 'user', content: 'next' }
    ])
  })

  it('includes non-image file context in user content', () => {
    const store = createMockMessageStore([])
    const result = buildContext(
      's1',
      {
        text: 'Please review',
        files: [
          {
            name: 'README.md',
            path: '/tmp/README.md',
            mimeType: 'text/markdown',
            content: '# Title'
          } as any
        ]
      },
      '',
      10000,
      4096,
      store
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('[Attached File 1]')
      }
    ])
    expect(result[0].content).toEqual(expect.stringContaining('# Title'))
  })

  it('converts image files to image_url when vision is enabled', () => {
    const store = createMockMessageStore([
      makeUserRecordWithFiles(1, 'Look at this', [
        {
          name: 'img.png',
          path: '/tmp/img.png',
          mimeType: 'image/png',
          content: 'data:image/png;base64,AAA='
        }
      ])
    ])

    const result = buildContext('s1', 'next', '', 10000, 4096, store, true)
    const userHistory = result[0]
    expect(Array.isArray(userHistory.content)).toBe(true)
    expect((userHistory.content as any[]).some((part) => part.type === 'image_url')).toBe(true)
  })

  it('converts audio files to input_audio when audio input is enabled', () => {
    const store = createMockMessageStore([])
    const result = buildContext(
      's1',
      {
        text: 'Please transcribe this clip',
        files: [
          {
            name: 'clip.wav',
            path: '/tmp/clip.wav',
            mimeType: 'audio/wav',
            content: 'data:audio/wav;base64,YXVkaW8tYnl0ZXM='
          } as any
        ]
      },
      '',
      10000,
      4096,
      store,
      false,
      {
        supportsAudioInput: true
      }
    )

    const userMessageParts = result[0].content as any[]
    expect(Array.isArray(userMessageParts)).toBe(true)
    expect(userMessageParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input_audio',
          input_audio: expect.objectContaining({
            data: 'YXVkaW8tYnl0ZXM=',
            media_type: 'audio/wav',
            filename: 'clip.wav'
          })
        }),
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('[Attached Audio 1]')
        })
      ])
    )
    expect(
      userMessageParts.some(
        (part) =>
          part.type === 'text' &&
          typeof part.text === 'string' &&
          part.text.includes('Audio file path:')
      )
    ).toBe(false)
  })

  it('falls back to text-only audio context when audio input is disabled', () => {
    const store = createMockMessageStore([])
    const result = buildContext(
      's1',
      {
        text: 'Please review this clip',
        files: [
          {
            name: 'clip.wav',
            path: '/tmp/clip.wav',
            mimeType: 'audio/wav',
            content: 'Audio file path: /tmp/clip.wav'
          } as any
        ]
      },
      '',
      10000,
      4096,
      store
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('Audio file path:')
      }
    ])
    expect(result[0].content).not.toEqual(expect.stringContaining('[Attached Audio 1]'))
  })
})

describe('buildResumeContext', () => {
  it('keeps the final turn when fallback pruning older turns', () => {
    const messages = [
      makeUserRecord(1, 'A'.repeat(300)),
      makeAssistantRecord(2, 'B'.repeat(300)),
      makeUserRecord(3, 'recent user'),
      {
        id: 'resume-target',
        sessionId: 's1',
        orderSeq: 4,
        role: 'assistant' as const,
        content: JSON.stringify([
          { type: 'content', content: 'partial answer', status: 'success', timestamp: Date.now() }
        ]),
        status: 'pending' as const,
        isContextEdge: 0,
        metadata: '{}',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
    const store = createMockMessageStore(messages)
    const result = buildResumeContext('s1', 'resume-target', 'Sys', 220, 100, store, false, {
      fallbackProtectedTurnCount: 1
    })

    expect(result[0]).toEqual({ role: 'system', content: 'Sys' })
    expect(result.slice(-2)).toEqual([
      { role: 'user', content: 'recent user' },
      { role: 'assistant', content: 'partial answer' }
    ])
  })

  it('keeps the protected resume turn even when no token budget remains', () => {
    const messages = [
      makeUserRecord(1, 'recent user'),
      {
        id: 'resume-target',
        sessionId: 's1',
        orderSeq: 2,
        role: 'assistant' as const,
        content: JSON.stringify([
          { type: 'content', content: 'partial answer', status: 'success', timestamp: Date.now() }
        ]),
        status: 'pending' as const,
        isContextEdge: 0,
        metadata: '{}',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
    const store = createMockMessageStore(messages)
    const result = buildResumeContext('s1', 'resume-target', '', 1, 100, store, false, {
      fallbackProtectedTurnCount: 1
    })

    expect(result).toEqual([
      { role: 'user', content: 'recent user' },
      { role: 'assistant', content: 'partial answer' }
    ])
  })

  it('keeps an oversized protected ask-user resume turn when a small positive budget remains', () => {
    const oversizedAnswer = `selected option\n${'A'.repeat(400)}`
    const messages = [
      makeUserRecord(1, 'recent user'),
      {
        id: 'resume-target',
        sessionId: 's1',
        orderSeq: 2,
        role: 'assistant' as const,
        content: JSON.stringify([
          { type: 'content', content: 'Need a choice.', status: 'success', timestamp: Date.now() },
          {
            type: 'tool_call',
            status: 'success',
            timestamp: Date.now(),
            tool_call: {
              id: 'tc-question',
              name: 'deepchat_question',
              params: '{"question":"Pick one"}',
              response: oversizedAnswer
            }
          },
          {
            type: 'action',
            action_type: 'question_request',
            status: 'success',
            timestamp: Date.now(),
            content: '',
            tool_call: {
              id: 'tc-question',
              name: 'deepchat_question',
              params: '{"question":"Pick one"}'
            },
            extra: { needsUserAction: false, answerText: 'selected option' }
          }
        ]),
        status: 'pending' as const,
        isContextEdge: 0,
        metadata: '{}',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
    const store = createMockMessageStore(messages)
    const result = buildResumeContext('s1', 'resume-target', 'Sys', 20, 10, store, false, {
      fallbackProtectedTurnCount: 1
    })

    expect(result).toEqual([
      { role: 'system', content: 'Sys' },
      { role: 'user', content: 'recent user' },
      {
        role: 'assistant',
        content: 'Need a choice.',
        tool_calls: [
          {
            id: 'tc-question',
            type: 'function',
            function: { name: 'deepchat_question', arguments: '{"question":"Pick one"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc-question', content: oversizedAnswer }
    ])
  })

  it('preserves reasoning_content for pending resume targets with resolved tool calls', () => {
    const messages = [
      makeUserRecord(1, 'recent user'),
      {
        id: 'resume-target',
        sessionId: 's1',
        orderSeq: 2,
        role: 'assistant' as const,
        content: JSON.stringify([
          {
            type: 'reasoning_content',
            content: 'Need a tool first.',
            status: 'success',
            timestamp: Date.now()
          },
          { type: 'content', content: 'Running tool...', status: 'success', timestamp: Date.now() },
          {
            type: 'tool_call',
            status: 'success',
            timestamp: Date.now(),
            tool_call: {
              id: 'tc-resume',
              name: 'example_tool',
              params: '{"foo":"bar"}',
              response: 'tool result'
            }
          },
          {
            type: 'action',
            action_type: 'question_request',
            status: 'success',
            timestamp: Date.now(),
            content: 'Pick one',
            tool_call: { id: 'tc-resume', name: 'example_tool', params: '{"foo":"bar"}' },
            extra: { needsUserAction: false, answerText: 'A' }
          }
        ]),
        status: 'pending' as const,
        isContextEdge: 0,
        metadata: '{}',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
    const store = createMockMessageStore(messages)
    const result = buildResumeContext('s1', 'resume-target', '', 10000, 4096, store, false, {
      preserveInterleavedReasoning: true
    })

    expect(result).toEqual([
      { role: 'user', content: 'recent user' },
      {
        role: 'assistant',
        content: 'Running tool...',
        reasoning_content: 'Need a tool first.',
        tool_calls: [
          {
            id: 'tc-resume',
            type: 'function',
            function: { name: 'example_tool', arguments: '{"foo":"bar"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc-resume', content: 'tool result' }
    ])
  })

  it('does not duplicate empty formatted resume records as out of budget exclusions', () => {
    const emptyRecord = {
      id: 'empty-user',
      sessionId: 's1',
      orderSeq: 1,
      role: 'user' as const,
      content: JSON.stringify({ text: '', files: [], links: [], search: false, think: false }),
      status: 'sent' as const,
      isContextEdge: 0,
      metadata: '{}',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const messages = [
      emptyRecord,
      makeUserRecord(2, 'recent user'),
      {
        id: 'resume-target',
        sessionId: 's1',
        orderSeq: 3,
        role: 'assistant' as const,
        content: JSON.stringify([
          { type: 'content', content: 'partial answer', status: 'success', timestamp: Date.now() }
        ]),
        status: 'pending' as const,
        isContextEdge: 0,
        metadata: '{}',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
    const store = createMockMessageStore(messages)

    const result = buildResumeContextWithMetadata(
      's1',
      'resume-target',
      '',
      10000,
      4096,
      store,
      false,
      {
        fallbackProtectedTurnCount: 1
      }
    )

    expect(
      result.metadata.excludedRecords.filter((item) => item.record.id === 'empty-user')
    ).toEqual([
      {
        record: emptyRecord,
        reason: 'empty_after_formatting'
      }
    ])
  })

  it('emits resume summary cursor metadata without before_summary_cursor refs', () => {
    const messages = [
      makeUserRecord(1, 'old user'),
      makeAssistantRecord(2, 'old reply'),
      makeUserRecord(3, 'recent user'),
      {
        id: 'resume-target',
        sessionId: 's1',
        orderSeq: 4,
        role: 'assistant' as const,
        content: JSON.stringify([
          { type: 'content', content: 'partial', status: 'success', timestamp: 100 }
        ]),
        status: 'pending' as const,
        isContextEdge: 0,
        metadata: '{}',
        createdAt: 100,
        updatedAt: 100
      }
    ]
    const store = createMockMessageStore(messages)
    const result = buildResumeContextWithMetadata(
      's1',
      'resume-target',
      '',
      10000,
      4096,
      store,
      false,
      { summaryCursorOrderSeq: 3, fallbackProtectedTurnCount: 1 }
    )

    expect(result.metadata.summaryCursor).toEqual({
      summaryCursorOrderSeq: 3,
      preCursorOrderSeqMin: 1,
      preCursorOrderSeqMax: 2,
      preCursorCount: 2
    })
    expect(
      result.metadata.excludedRecords.some(
        (item) => (item.reason as string) === 'before_summary_cursor'
      )
    ).toBe(false)
  })

  it('includes prior assistant error records when building resume context', () => {
    const messages = [
      makeUserRecord(1, 'previous user'),
      makeAssistantErrorRecord(2, 'previous failure'),
      makeUserRecord(3, 'recent user'),
      {
        id: 'resume-target',
        sessionId: 's1',
        orderSeq: 4,
        role: 'assistant' as const,
        content: JSON.stringify([
          { type: 'content', content: 'partial answer', status: 'success', timestamp: Date.now() }
        ]),
        status: 'pending' as const,
        isContextEdge: 0,
        metadata: '{}',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
    const store = createMockMessageStore(messages)
    const result = buildResumeContext('s1', 'resume-target', '', 10000, 4096, store)

    expect(result).toEqual([
      { role: 'user', content: 'previous user' },
      { role: 'assistant', content: '[Generation failed]\nReason: previous failure' },
      { role: 'user', content: 'recent user' },
      { role: 'assistant', content: 'partial answer' }
    ])
  })
})

describe('fitMessagesToContextWindow', () => {
  it('drops older history before protected steer and queued user tail', () => {
    const result = fitMessagesToContextWindow(
      [
        { role: 'system', content: 'Sys' },
        { role: 'user', content: 'A'.repeat(40) },
        { role: 'assistant', content: 'B'.repeat(40) },
        { role: 'user', content: 'Steer instruction' },
        { role: 'user', content: 'Queued target' }
      ],
      14,
      4,
      2
    )

    expect(result).toEqual([
      { role: 'system', content: 'Sys' },
      { role: 'user', content: 'Steer instruction' },
      { role: 'user', content: 'Queued target' }
    ])
  })
})
