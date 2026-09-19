import { describe, expect, it } from 'vitest'
import { generateText, modelMessageSchema } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { mapMessagesToModelMessages } from '@/provider/aiSdk/messageMapper'

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
  class ProviderOptionInstance {
    value = true
  }

  it('maps images to canonical file parts and skips malformed user content', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/a.png' }
            },
            {
              type: 'image_url',
              image_url: { url: 'data:image/webp;base64,UklGRg==' }
            },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/a.png?format=webp' }
            },
            { type: 'image_url' },
            null,
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
            type: 'file',
            data: new URL('https://example.com/a.png'),
            mediaType: 'image/png'
          },
          {
            type: 'file',
            data: 'data:image/webp;base64,UklGRg==',
            mediaType: 'image/webp'
          },
          {
            type: 'file',
            data: new URL('https://example.com/a.png?format=webp'),
            mediaType: 'image'
          }
        ]
      }
    ])
    expect(result.every((message) => modelMessageSchema.safeParse(message).success)).toBe(true)
  })

  it('passes mapped image files through AI SDK without deprecation warnings', async () => {
    const messages = mapMessagesToModelMessages(
      [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,QUJD' }
            }
          ]
        }
      ],
      {
        tools: [],
        supportsNativeTools: true
      }
    )
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined
          },
          outputTokens: {
            total: 1,
            text: 1,
            reasoning: undefined
          }
        },
        warnings: []
      })
    })
    const previousWarningLogger = globalThis.AI_SDK_LOG_WARNINGS
    const loggedWarnings: unknown[] = []
    globalThis.AI_SDK_LOG_WARNINGS = ({ warnings }) => loggedWarnings.push(...warnings)

    try {
      await generateText({ model, messages })
    } finally {
      globalThis.AI_SDK_LOG_WARNINGS = previousWarningLogger
    }

    expect(loggedWarnings).not.toContainEqual(
      expect.objectContaining({
        type: 'deprecated',
        setting: '"image" content part'
      })
    )
    expect(model.doGenerateCalls[0]?.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          data: { type: 'data', data: 'QUJD' },
          mediaType: 'image/png'
        }
      ]
    })
  })

  it('maps input_audio parts to AI SDK file parts for supported audio media types', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'listen' },
            {
              type: 'input_audio',
              input_audio: {
                data: 'QUJD',
                media_type: 'audio/wav',
                filename: 'clip.wav'
              }
            }
          ]
        } as any
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
          { type: 'text', text: 'listen' },
          {
            type: 'file',
            data: 'QUJD',
            mediaType: 'audio/wav',
            filename: 'clip.wav'
          }
        ]
      }
    ])
  })

  it('adds openai-compatible audio data url overrides for unsupported audio media types', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'listen' },
            {
              type: 'input_audio',
              input_audio: {
                data: 'QUJD',
                media_type: 'audio/flac',
                filename: 'clip.flac'
              }
            }
          ]
        } as any
      ],
      {
        tools: [],
        supportsNativeTools: true,
        preferOpenAICompatibleAudioDataUrl: true
      }
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'listen' },
          {
            type: 'file',
            data: 'QUJD',
            mediaType: 'audio/mpeg',
            filename: 'clip.flac',
            providerOptions: {
              openaiCompatible: {
                input_audio: {
                  data: 'data:audio/mpeg;base64,QUJD'
                }
              }
            }
          }
        ]
      }
    ])
    expect(result.every((message) => modelMessageSchema.safeParse(message).success)).toBe(true)
  })

  it('keeps non-openai-compatible audio/* media types for standard runtimes', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'metadata fallback' },
            {
              type: 'input_audio',
              input_audio: {
                data: 'QUJD',
                media_type: 'audio/flac'
              }
            }
          ]
        } as any
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
          { type: 'text', text: 'metadata fallback' },
          {
            type: 'file',
            data: 'QUJD',
            mediaType: 'audio/flac'
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

  it('preserves plain-text tool results containing URLs', () => {
    const response = 'Success. Image URL(s): https://example.com/image.jpeg?Expires=1&Signature=abc'
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc1',
              type: 'function',
              function: { name: 'text_to_image', arguments: '{}' }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'tc1',
          content: response
        }
      ],
      {
        tools: [],
        supportsNativeTools: true
      }
    )

    expect((result[1] as any).content[0].output).toEqual({
      type: 'text',
      value: response
    })
  })

  it('drops invalid provider options before returning AI SDK messages', () => {
    const result = mapMessagesToModelMessages(
      [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'hello',
              provider_options: {
                anthropic: { cacheControl: { type: 'ephemeral' } },
                broken: undefined,
                dated: new Date('2026-05-09T00:00:00Z'),
                linked: new URL('https://example.com'),
                custom: new ProviderOptionInstance()
              }
            }
          ]
        } as any,
        {
          role: 'assistant',
          content: 'thinking',
          reasoning_content: 'plan',
          reasoning_provider_options: {
            broken: undefined,
            dated: new Date('2026-05-09T00:00:00Z'),
            linked: new URL('https://example.com')
          }
        } as any
      ],
      {
        tools: [],
        supportsNativeTools: true,
        preserveOpenAICompatibleReasoningContent: true
      }
    )

    expect(result.every((message) => modelMessageSchema.safeParse(message).success)).toBe(true)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'hello',
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } }
          }
        }
      ]
    })
    expect(result[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: 'plan'
        },
        {
          type: 'text',
          text: 'thinking'
        }
      ],
      providerOptions: {
        openaiCompatible: {
          reasoning_content: 'plan'
        }
      }
    })
  })
})
