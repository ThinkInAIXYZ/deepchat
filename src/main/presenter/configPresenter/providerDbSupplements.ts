import type { ProviderAggregate } from '@shared/types/model-db'

const DOUBAO_THINKING_NOTE = 'doubao-thinking-parameter'

const createDoubaoThinkingOverride = (id: string) => ({
  id,
  extra_capabilities: {
    reasoning: {
      notes: [DOUBAO_THINKING_NOTE]
    }
  }
})

// Source notes:
// - https://www.volcengine.com/docs/6492/1544808?lang=zh
// - https://developer.volcengine.com/articles/7622677873391829033
export const PROVIDER_DB_SUPPLEMENTS: ProviderAggregate = {
  providers: {
    doubao: {
      id: 'doubao',
      models: [
        createDoubaoThinkingOverride('doubao-seed-1-6-vision-250815'),
        createDoubaoThinkingOverride('doubao-seed-1-6-250615'),
        createDoubaoThinkingOverride('doubao-seed-1-6-flash-250715'),
        createDoubaoThinkingOverride('doubao-seed-1-6-flash-250615'),
        createDoubaoThinkingOverride('doubao-seed-1-6-thinking-250715'),
        createDoubaoThinkingOverride('doubao-seed-1-6-thinking-250615'),
        {
          id: 'doubao-seed-1.8',
          name: 'Doubao-Seed 1.8',
          display_name: 'Doubao-Seed 1.8',
          type: 'chat',
          attachment: true,
          reasoning: {
            supported: true,
            default: true
          },
          tool_call: true,
          temperature: true,
          modalities: {
            input: ['text', 'image', 'video'],
            output: ['text']
          },
          limit: {
            context: 256000,
            output: 64000
          },
          extra_capabilities: {
            reasoning: {
              notes: [DOUBAO_THINKING_NOTE]
            }
          }
        },
        {
          id: 'doubao-seed-2.0-code',
          name: 'Doubao-Seed 2.0 Code',
          display_name: 'Doubao-Seed 2.0 Code',
          type: 'chat',
          attachment: true,
          reasoning: {
            supported: false
          },
          tool_call: true,
          temperature: true,
          modalities: {
            input: ['text', 'image'],
            output: ['text']
          },
          limit: {
            context: 256000,
            output: 32000
          }
        },
        {
          id: 'doubao-seed-2.0-lite',
          name: 'Doubao-Seed 2.0 Lite',
          display_name: 'Doubao-Seed 2.0 Lite',
          type: 'chat',
          attachment: true,
          reasoning: {
            supported: true,
            default: true
          },
          tool_call: true,
          temperature: true,
          modalities: {
            input: ['text', 'image', 'video'],
            output: ['text']
          },
          limit: {
            context: 256000,
            output: 64000
          },
          extra_capabilities: {
            reasoning: {
              notes: [DOUBAO_THINKING_NOTE]
            }
          }
        },
        {
          id: 'doubao-seed-2.0-mini',
          name: 'Doubao-Seed 2.0 Mini',
          display_name: 'Doubao-Seed 2.0 Mini',
          type: 'chat',
          attachment: true,
          reasoning: {
            supported: true,
            default: true
          },
          tool_call: true,
          temperature: true,
          modalities: {
            input: ['text', 'image', 'video'],
            output: ['text']
          },
          limit: {
            context: 256000,
            output: 64000
          },
          extra_capabilities: {
            reasoning: {
              notes: [DOUBAO_THINKING_NOTE]
            }
          }
        },
        {
          id: 'doubao-seed-2.0-pro',
          name: 'Doubao-Seed 2.0 Pro',
          display_name: 'Doubao-Seed 2.0 Pro',
          type: 'chat',
          attachment: true,
          reasoning: {
            supported: true,
            default: true
          },
          tool_call: true,
          temperature: true,
          modalities: {
            input: ['text', 'image', 'video'],
            output: ['text']
          },
          limit: {
            context: 256000,
            output: 64000
          },
          extra_capabilities: {
            reasoning: {
              notes: [DOUBAO_THINKING_NOTE]
            }
          }
        }
      ]
    }
  }
}

export const PROVIDER_DB_SUPPLEMENT_NOTES = {
  doubaoThinking: DOUBAO_THINKING_NOTE
} as const
