import { describe, expect, it } from 'vitest'
import { approximateTokenSize } from 'tokenx'
import type { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import { buildUserMessageContext } from '@/presenter/agentPresenter/message/messageFormatter'
import { selectContextMessages } from '@/presenter/agentPresenter/message/messageTruncator'

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

function createAssistantBlocks(text: string, toolCall?: AssistantMessageBlock['tool_call']) {
  const blocks: AssistantMessageBlock[] = [
    {
      type: 'content',
      content: text,
      status: 'success',
      timestamp: Date.now()
    }
  ]

  if (toolCall) {
    blocks.push({
      type: 'tool_call',
      status: 'success',
      timestamp: Date.now(),
      tool_call: toolCall
    })
  }

  return blocks
}

function countUserTokens(content: UserMessageContent): number {
  return approximateTokenSize(buildUserMessageContext(content))
}

function countAssistantTokens(text: string): number {
  return approximateTokenSize(text)
}

function countToolCallTokens(name: string, params: string, response: string): number {
  return approximateTokenSize(name) + approximateTokenSize(params) + approximateTokenSize(response)
}

describe('selectContextMessages', () => {
  it('drops oldest pairs when no tool calls are present', () => {
    const user1 = createMessage('user-1', 'user', createUserContent('hello one'))
    const assistant1 = createMessage('assistant-1', 'assistant', createAssistantBlocks('reply one'))
    const user2 = createMessage('user-2', 'user', createUserContent('hello two'))
    const assistant2 = createMessage('assistant-2', 'assistant', createAssistantBlocks('reply two'))
    const currentUser = createMessage('user-3', 'user', createUserContent('new question'))

    const pair2Tokens =
      countUserTokens(user2.content as UserMessageContent) + countAssistantTokens('reply two')

    const selected = selectContextMessages(
      [user1, assistant1, user2, assistant2],
      currentUser,
      pair2Tokens,
      false,
      false
    )

    expect(selected.map((message) => message.id)).toEqual(['user-2', 'assistant-2'])
  })

  it('removes tool call blocks before deleting message pairs', () => {
    const toolCall = {
      id: 'tool-1',
      name: 'search',
      params: '{"q":"hi"}',
      response: 'tool response'
    }
    const user = createMessage('user-1', 'user', createUserContent('hello'))
    const assistant = createMessage(
      'assistant-1',
      'assistant',
      createAssistantBlocks('reply', toolCall)
    )
    const currentUser = createMessage('user-2', 'user', createUserContent('new question'))

    const totalTokens =
      countUserTokens(user.content as UserMessageContent) +
      countAssistantTokens('reply') +
      countToolCallTokens(toolCall.name, toolCall.params, toolCall.response)

    const remainingContextLength =
      totalTokens - countToolCallTokens(toolCall.name, toolCall.params, toolCall.response) + 1

    const selected = selectContextMessages(
      [user, assistant],
      currentUser,
      remainingContextLength,
      true,
      false
    )

    const assistantBlocks = selected.find((message) => message.role === 'assistant')
      ?.content as AssistantMessageBlock[]
    const hasToolCallBlock = assistantBlocks.some((block) => block.type === 'tool_call')

    expect(selected.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
    expect(hasToolCallBlock).toBe(false)
  })

  it('removes tool calls then drops oldest pairs when still over limit', () => {
    const toolCall = {
      id: 'tool-1',
      name: 'search',
      params: '{"q":"hi"}',
      response: 'tool response'
    }
    const user1 = createMessage('user-1', 'user', createUserContent('hello one'))
    const assistant1 = createMessage(
      'assistant-1',
      'assistant',
      createAssistantBlocks('reply one', toolCall)
    )
    const user2 = createMessage('user-2', 'user', createUserContent('hello two'))
    const assistant2 = createMessage('assistant-2', 'assistant', createAssistantBlocks('reply two'))
    const currentUser = createMessage('user-3', 'user', createUserContent('new question'))

    const pair2Tokens =
      countUserTokens(user2.content as UserMessageContent) + countAssistantTokens('reply two')

    const remainingContextLength = pair2Tokens - 1

    const selected = selectContextMessages(
      [user1, assistant1, user2, assistant2],
      currentUser,
      remainingContextLength,
      true,
      false
    )

    expect(selected.map((message) => message.id)).toEqual(['user-2', 'assistant-2'])
  })

  it('returns empty when remaining context length is non-positive', () => {
    const user = createMessage('user-1', 'user', createUserContent('hello'))
    const assistant = createMessage('assistant-1', 'assistant', createAssistantBlocks('reply'))

    const selected = selectContextMessages([user, assistant], user, 0, false, false)

    expect(selected).toEqual([])
  })

  it('returns empty when no sent context messages exist', () => {
    const user = createMessage('user-1', 'user', createUserContent('hello'))
    const assistant = createMessage('assistant-1', 'assistant', createAssistantBlocks('reply'))
    user.status = 'pending'
    assistant.status = 'pending'

    const selected = selectContextMessages([user, assistant], user, 100, false, false)

    expect(selected).toEqual([])
  })

  it('retains image user messages when vision is enabled', () => {
    const userWithImage = createMessage('user-1', 'user', createUserContent('hello'))
    const imageContent = userWithImage.content as UserMessageContent & { images?: string[] }
    imageContent.images = ['data:image/png;base64,abc']
    const assistant = createMessage('assistant-1', 'assistant', createAssistantBlocks('reply'))
    const currentUser = createMessage('user-2', 'user', createUserContent('new question'))

    const selected = selectContextMessages(
      [userWithImage, assistant],
      currentUser,
      1000,
      true,
      true
    )

    expect(selected.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
  })

  it('keeps context edge messages when within limits', () => {
    const user = createMessage('user-1', 'user', createUserContent('edge message'))
    const assistant = createMessage('assistant-1', 'assistant', createAssistantBlocks('reply'))
    const edgeUser = user as Message & { is_context_edge?: boolean }
    edgeUser.is_context_edge = true
    const currentUser = createMessage('user-2', 'user', createUserContent('new question'))

    const selected = selectContextMessages([user, assistant], currentUser, 1000, false, false)

    expect(selected.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
  })
})
