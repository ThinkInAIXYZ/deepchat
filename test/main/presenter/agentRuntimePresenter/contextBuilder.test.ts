import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildContext,
  buildResumeContext,
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

  it('filters out error messages', () => {
    const messages = [
      makeUserRecord(1, 'msg1'),
      makeAssistantRecord(2, 'error reply', 'error'),
      makeUserRecord(3, 'msg2'),
      makeAssistantRecord(4, 'good reply')
    ]
    const store = createMockMessageStore(messages)
    const result = buildContext('s1', 'msg3', '', 10000, 4096, store)

    // Should only include msg1, msg2, good reply (skip error)
    expect(result).toEqual([
      { role: 'user', content: 'msg1' },
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
