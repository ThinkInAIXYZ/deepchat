import { describe, expect, it } from 'vitest'
import type { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import {
  addContextMessages,
  buildUserMessageContext,
  formatUserMessageContent
} from '@/presenter/agentPresenter/message/messageFormatter'

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

describe('messageFormatter', () => {
  it('formats prompt mentions into prompt tags', () => {
    const promptPayload = JSON.stringify({
      messages: [{ content: 'Hello' }, { content: { type: 'text', text: 'World' } }]
    })

    const formatted = formatUserMessageContent([
      {
        type: 'mention',
        id: 'prompt-1',
        category: 'prompts',
        content: promptPayload
      }
    ])

    expect(formatted).toContain('@prompt-1 <prompts>')
    expect(formatted).toContain('Hello')
    expect(formatted).toContain('World')
  })

  it('builds file context with truncation when content is long', () => {
    const longContent = 'a'.repeat(8005)
    const content: UserMessageContent = {
      files: [
        {
          name: 'file.txt',
          content: longContent,
          mimeType: 'text/plain',
          metadata: {
            fileName: 'file.txt',
            fileSize: longContent.length,
            fileCreated: new Date(),
            fileModified: new Date()
          },
          token: 0,
          path: '/tmp/file.txt'
        }
      ],
      links: [],
      think: false,
      search: false,
      text: 'Hi',
      content: [{ type: 'text', content: 'Hi' }]
    }

    const context = buildUserMessageContext(content)

    expect(context).toContain('<files>')
    expect(context).toContain('…(truncated)')
  })

  it('writes legacy function_call records for tool calls when function calling is disabled', () => {
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

    const assistantMessage = createMessage('assistant-1', 'assistant', [toolCallBlock])
    const messages = addContextMessages([assistantMessage], false, false)

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(String(messages[0].content)).toContain('<function_call>')
    expect(String(messages[0].content)).toContain('function_call_record')
    expect(String(messages[0].content)).toContain('search')
  })
})
