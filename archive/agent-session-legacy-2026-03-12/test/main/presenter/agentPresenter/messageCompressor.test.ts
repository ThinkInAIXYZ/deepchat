import { describe, expect, it } from 'vitest'
import type { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import { compressToolCallsFromContext } from '@/presenter/agentPresenter/message/messageCompressor'

const baseUsage = {
  context_usage: 0,
  tokens_per_second: 0,
  total_tokens: 0,
  generation_time: 0,
  first_token_time: 0,
  reasoning_start_time: 0,
  reasoning_end_time: 0,
  input_tokens: 0,
  output_tokens: 0
}

function createMessage(id: string, role: Message['role'], content: Message['content']): Message {
  return {
    id,
    role,
    content,
    timestamp: Date.now(),
    avatar: '',
    name: '',
    model_name: '',
    model_id: '',
    model_provider: '',
    status: 'sent',
    error: '',
    usage: baseUsage,
    conversationId: 'conversation',
    is_variant: 0
  }
}

function createUserContent(text: string): UserMessageContent {
  return {
    files: [],
    links: [],
    think: false,
    search: false,
    text,
    content: [{ type: 'text', content: text }]
  }
}

function createAssistantWithToolCall(id: string): Message {
  const toolCallBlock: AssistantMessageBlock = {
    type: 'tool_call',
    status: 'success',
    timestamp: Date.now(),
    tool_call: {
      id: 'tool-1',
      name: 'search',
      params: '{"q":"hi"}',
      response: 'ok'
    }
  }

  return createMessage(id, 'assistant', [toolCallBlock])
}

describe('messageCompressor', () => {
  it('removes tool calls before the last user message when over budget', () => {
    const assistant = createAssistantWithToolCall('assistant-1')
    const user = createMessage('user-1', 'user', createUserContent('hello'))

    const { compressedMessages, removedTokens } = compressToolCallsFromContext(
      [assistant, user],
      1,
      true
    )

    const assistantBlocks = compressedMessages[0].content as AssistantMessageBlock[]
    const hasToolCall = assistantBlocks.some((block) => block.type === 'tool_call')

    expect(hasToolCall).toBe(false)
    expect(removedTokens).toBeGreaterThan(0)
  })

  it('keeps tool calls when function calling is disabled', () => {
    const assistant = createAssistantWithToolCall('assistant-1')
    const user = createMessage('user-1', 'user', createUserContent('hello'))

    const { compressedMessages, removedTokens } = compressToolCallsFromContext(
      [assistant, user],
      1,
      false
    )

    const assistantBlocks = compressedMessages[0].content as AssistantMessageBlock[]
    const hasToolCall = assistantBlocks.some((block) => block.type === 'tool_call')

    expect(hasToolCall).toBe(true)
    expect(removedTokens).toBe(0)
  })

  it('does not remove tool calls after the last user message', () => {
    const user = createMessage('user-1', 'user', createUserContent('hello'))
    const assistant = createAssistantWithToolCall('assistant-1')

    const { compressedMessages } = compressToolCallsFromContext([user, assistant], 1, true)

    const assistantBlocks = compressedMessages[1].content as AssistantMessageBlock[]
    const hasToolCall = assistantBlocks.some((block) => block.type === 'tool_call')

    expect(hasToolCall).toBe(true)
  })
})
