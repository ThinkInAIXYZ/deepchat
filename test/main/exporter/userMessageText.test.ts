import { describe, expect, it } from 'vitest'
import { formatUserMessageContent } from '@/exporter/formats/userMessageText'

describe('formatUserMessageContent', () => {
  it('formats prompt mentions', () => {
    const content = formatUserMessageContent([
      {
        type: 'mention',
        id: 'prompt-1',
        category: 'prompts',
        content: JSON.stringify({
          messages: [{ content: 'Hello' }, { content: { type: 'text', text: 'World' } }]
        })
      }
    ])

    expect(content).toBe('@prompt-1 <prompts>Hello\nWorld</prompts>')
  })
})
