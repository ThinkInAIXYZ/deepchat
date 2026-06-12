import { describe, expect, it } from 'vitest'
import { applyLegacyFunctionCallPrompt } from '@/presenter/llmProviderPresenter/aiSdk/middlewares/legacyFunctionCallMiddleware'

describe('legacyFunctionCallMiddleware', () => {
  it('preserves message fields when converting non-array user content', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'hello',
        providerMetadata: {
          vertex: {
            cachedContent: 'cache-key'
          }
        }
      } as any
    ]

    const result = applyLegacyFunctionCallPrompt(
      messages,
      [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search',
            parameters: { type: 'object', properties: {} }
          }
        } as any
      ],
      () => 'tool prompt'
    )

    expect(result).toEqual([
      {
        role: 'user',
        providerMetadata: {
          vertex: {
            cachedContent: 'cache-key'
          }
        },
        content: [
          {
            type: 'text',
            text: 'hello\n\ntool prompt'
          }
        ]
      }
    ])
  })
})
