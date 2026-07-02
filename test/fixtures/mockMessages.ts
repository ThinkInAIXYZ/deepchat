import type { DisplayMessage } from '@/components/chat/messageListItems'

type MockMessageKind = 'text' | 'long-markdown' | 'code' | 'tool' | 'image' | 'thinking'

type GenerateMockMessagesOptions = {
  count: number
  seed?: number
  types?: MockMessageKind[]
}

const DEFAULT_TYPES: MockMessageKind[] = [
  'text',
  'long-markdown',
  'code',
  'tool',
  'image',
  'thinking'
]

function createRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const usage = {
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

function createAssistantContent(kind: MockMessageKind, index: number) {
  if (kind === 'long-markdown') {
    return [
      {
        type: 'content',
        content: `# Long answer ${index}\n\n${'A paragraph with search terms and markdown. '.repeat(80)}`,
        status: 'success',
        timestamp: index
      }
    ]
  }
  if (kind === 'code') {
    return [
      {
        type: 'content',
        content: `\`\`\`ts\n${Array.from({ length: 80 }, (_, line) => `const value${line} = ${line}`).join('\n')}\n\`\`\``,
        status: 'success',
        timestamp: index
      }
    ]
  }
  if (kind === 'tool') {
    return [
      {
        type: 'tool_call',
        status: 'success',
        timestamp: index,
        tool_call: {
          id: `tool-${index}`,
          name: 'read_file',
          params: { path: `/tmp/example-${index}.ts` },
          response: 'file content result'
        }
      }
    ]
  }
  if (kind === 'image') {
    return [
      {
        type: 'image',
        status: 'success',
        timestamp: index,
        image_data: {
          data: 'data:image/png;base64,iVBORw0KGgo=',
          mimeType: 'image/png'
        }
      }
    ]
  }
  if (kind === 'thinking') {
    return [
      {
        type: 'reasoning_content',
        content: 'Reasoning through the problem. '.repeat(40),
        status: 'success',
        timestamp: index
      }
    ]
  }
  return [
    {
      type: 'content',
      content: `Short assistant message ${index} with alpha search text.`,
      status: 'success',
      timestamp: index
    }
  ]
}

export function generateMockMessages(options: GenerateMockMessagesOptions): DisplayMessage[] {
  const random = createRandom(options.seed ?? 1)
  const types = options.types?.length ? options.types : DEFAULT_TYPES

  return Array.from({ length: options.count }, (_, index): DisplayMessage => {
    const role = index % 2 === 0 ? 'user' : 'assistant'
    const kind = types[Math.floor(random() * types.length)] ?? 'text'
    const base = {
      id: `mock-message-${index}`,
      role,
      timestamp: index,
      updatedAt: index,
      avatar: '',
      name: role === 'user' ? 'You' : 'Assistant',
      model_name: role === 'assistant' ? 'Mock model' : '',
      model_id: role === 'assistant' ? 'mock-model' : '',
      model_provider: role === 'assistant' ? 'mock-provider' : '',
      status: 'sent',
      error: '',
      usage,
      conversationId: 'mock-session',
      is_variant: 0,
      orderSeq: index + 1,
      messageType: 'normal',
      summaryUpdatedAt: null
    } as const

    if (role === 'user') {
      return {
        ...base,
        role,
        content: {
          text: `User request ${index} with alpha content`,
          files:
            kind === 'image'
              ? [
                  {
                    name: `image-${index}.png`,
                    path: `/tmp/image-${index}.png`,
                    mimeType: 'image/png'
                  }
                ]
              : [],
          links: [],
          search: false,
          think: kind === 'thinking'
        }
      } as DisplayMessage
    }

    return {
      ...base,
      role,
      content: createAssistantContent(kind, index)
    } as DisplayMessage
  })
}
