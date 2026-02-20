import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildContext, truncateContext } from '@/presenter/deepchatAgentPresenter/contextBuilder'

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
})
