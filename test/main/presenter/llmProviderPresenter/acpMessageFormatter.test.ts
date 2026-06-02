import { describe, expect, it } from 'vitest'
import { AcpMessageFormatter } from '@/presenter/llmProviderPresenter/acp'
import type { ChatMessage } from '@shared/presenter'

describe('AcpMessageFormatter', () => {
  it('formats only the latest user message by default', () => {
    const formatter = new AcpMessageFormatter()
    const result = formatter.format([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' }
    ] as ChatMessage[])

    expect(result.blocks).toEqual([{ type: 'text', text: 'second question' }])
    expect(result.includedSystemPrompt).toBe(false)
  })

  it('includes system prompt only when requested', () => {
    const formatter = new AcpMessageFormatter()
    const messages = [
      { role: 'system', content: 'Be precise.' },
      { role: 'user', content: 'What changed?' }
    ] as ChatMessage[]

    expect(formatter.format(messages).blocks).toEqual([{ type: 'text', text: 'What changed?' }])

    const result = formatter.format(messages, { includeSystemPrompt: true })
    expect(result.includedSystemPrompt).toBe(true)
    expect(result.blocks).toEqual([
      { type: 'text', text: 'System instructions:\nBe precise.' },
      { type: 'text', text: 'What changed?' }
    ])
  })

  it('sends image data blocks only when the agent supports images', () => {
    const formatter = new AcpMessageFormatter()
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,abc123'
            }
          }
        ]
      }
    ] as ChatMessage[]

    expect(formatter.format(messages, { promptCapabilities: { image: true } }).blocks).toEqual([
      {
        type: 'image',
        data: 'abc123',
        mimeType: 'image/png',
        uri: 'data:image/png;base64,abc123'
      }
    ])

    expect(formatter.format(messages, { promptCapabilities: { image: false } }).blocks).toEqual([
      {
        type: 'resource_link',
        uri: 'data:image/png;base64,abc123',
        name: 'image',
        mimeType: 'image/png'
      }
    ])
  })

  it('accepts input_image data from source and top-level fields', () => {
    const formatter = new AcpMessageFormatter()
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            source: {
              data: 'data:image/jpeg;base64,fromSource'
            }
          },
          {
            type: 'input_image',
            data: 'data:image/png;base64,fromData'
          }
        ]
      }
    ] as ChatMessage[]

    expect(formatter.format(messages, { promptCapabilities: { image: true } }).blocks).toEqual([
      {
        type: 'image',
        data: 'fromSource',
        mimeType: 'image/jpeg',
        uri: 'data:image/jpeg;base64,fromSource'
      },
      {
        type: 'image',
        data: 'fromData',
        mimeType: 'image/png',
        uri: 'data:image/png;base64,fromData'
      }
    ])
  })
})
