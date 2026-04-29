import { describe, expect, it } from 'vitest'
import { mapMessagesToModelMessages } from '@/presenter/llmProviderPresenter/aiSdk/messageMapper'

function convertToOpenAICompatibleChatMessagesForTest(messages: any[]) {
  return messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      return message
    }

    const text = message.content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('')
    const toolCalls = message.content
      .filter((part: any) => part.type === 'tool-call')
      .map((part: any) => ({
        id: part.toolCallId,
        type: 'function',
        function: {
          name: part.toolName,
          arguments: JSON.stringify(part.input)
        }
      }))
    const reasoningContent = message.providerOptions?.openaiCompatible?.reasoning_content

    return {
      role: 'assistant',
      content: text,
      ...(reasoningContent !== undefined ? { reasoning_content: reasoningContent } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    }
  })
}

describe('AI SDK message mapper', () => {
  it('skips malformed non-text user content parts instead of throwing', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
            { type: 'image_url' },
            { type: 'unknown', value: 'ignored' }
          ] as any
        }
      ],
      {
        tools: [],
        supportsNativeTools: true
      }
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          {
            type: 'image',
            image: new URL('https://example.com/a.png'),
            mediaType: 'image/png'
          }
        ]
      }
    ])
  })

  it('maps interleaved reasoning and native tool calls into assistant parts', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'assistant',
          content: 'I need current data.',
          reasoning_content: 'Plan the lookup first.',
          tool_calls: [
            {
              id: 'tc1',
              type: 'function',
              function: { name: 'search', arguments: '{"query":"weather"}' }
            }
          ]
        }
      ],
      {
        tools: [],
        supportsNativeTools: true
      }
    )

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Plan the lookup first.' },
          { type: 'text', text: 'I need current data.' },
          {
            type: 'tool-call',
            toolCallId: 'tc1',
            toolName: 'search',
            input: { query: 'weather' }
          }
        ]
      }
    ])
  })

  it('preserves empty interleaved reasoning for openai-compatible native tool calls', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'assistant',
          content: '',
          reasoning_content: '',
          tool_calls: [
            {
              id: 'tc1',
              type: 'function',
              function: { name: 'search', arguments: '{"query":"weather"}' }
            }
          ]
        }
      ],
      {
        tools: [],
        supportsNativeTools: true,
        preserveOpenAICompatibleReasoningContent: true
      }
    )

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '' },
          {
            type: 'tool-call',
            toolCallId: 'tc1',
            toolName: 'search',
            input: { query: 'weather' }
          }
        ],
        providerOptions: {
          openaiCompatible: {
            reasoning_content: ''
          }
        }
      }
    ])
    expect(convertToOpenAICompatibleChatMessagesForTest(result as any)).toEqual([
      {
        role: 'assistant',
        content: '',
        reasoning_content: '',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"weather"}' }
          }
        ]
      }
    ])
  })

  it('skips assistant messages with no content or reasoning', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'assistant',
          content: ''
        }
      ],
      {
        tools: [],
        supportsNativeTools: true
      }
    )

    expect(result).toEqual([])
  })

  it('keeps assistant messages that only contain reasoning', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'assistant',
          content: '',
          reasoning_content: 'Think before answering.'
        }
      ],
      {
        tools: [],
        supportsNativeTools: true
      }
    )

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'Think before answering.' }]
      }
    ])
  })
})
