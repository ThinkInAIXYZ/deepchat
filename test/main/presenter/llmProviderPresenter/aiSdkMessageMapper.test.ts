import { describe, expect, it } from 'vitest'
import { mapMessagesToModelMessages } from '@/presenter/llmProviderPresenter/aiSdk/messageMapper'

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
})
