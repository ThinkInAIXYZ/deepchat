import { describe, expect, it } from 'vitest'

import { sanitizeAggregateJson } from '../../../scripts/fetch-provider-db.mjs'

describe('fetch-provider-db', () => {
  it('preserves media types, omits pricing, and classifies pinned OpenAI speech model IDs', () => {
    const sanitized = sanitizeAggregateJson({
      providers: {
        openai: {
          id: 'openai',
          models: [
            { id: 'tts-1', type: undefined, cost: { input: 1, output: 2 } },
            { id: 'tts-1-hd-1106' },
            { id: 'gpt-4o-mini-tts' },
            { id: 'openai/tts-1-hd' },
            { id: 'openai/tts-1', type: 'chat' },
            { id: 'future-speech', type: 'tts', default_tool_mode: 'code' },
            { id: 'future-video', type: 'video_generation', default_tool_mode: 'unsupported' }
          ]
        }
      }
    })

    expect(sanitized?.providers.openai.models[0]).not.toHaveProperty('cost')
    expect(sanitized?.providers.openai.models).toEqual([
      expect.objectContaining({ id: 'tts-1', type: 'tts' }),
      expect.objectContaining({ id: 'tts-1-hd-1106', type: 'tts' }),
      expect.objectContaining({ id: 'gpt-4o-mini-tts', type: 'tts' }),
      expect.objectContaining({ id: 'openai/tts-1-hd', type: 'tts' }),
      expect.objectContaining({ id: 'openai/tts-1', type: 'chat' }),
      expect.objectContaining({ id: 'future-speech', type: 'tts', default_tool_mode: 'code' }),
      expect.objectContaining({ id: 'future-video', type: 'videoGeneration' })
    ])
    expect(sanitized?.providers.openai.models[6].default_tool_mode).toBeUndefined()
  })
})
