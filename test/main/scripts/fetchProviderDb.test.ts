import { describe, expect, it } from 'vitest'

import { sanitizeAggregate } from '../../../src/shared/types/model-db'
import { sanitizeAggregateJson } from '../../../scripts/fetch-provider-db.mjs'

describe('fetch-provider-db', () => {
  it('corrects known Aihubmix limits and rerank input capabilities', () => {
    const models = [
      {
        id: 'gpt-5.3-codex',
        limit: { context: 400000, output: 400000 },
        modalities: { input: ['text', 'image'] }
      },
      ...['cohere-rerank-v4.0-fast', 'cohere-rerank-v4.0-pro'].map((id) => ({
        id,
        type: 'rerank',
        limit: { context: 8192, output: 8192 },
        modalities: { input: ['text', 'image'] }
      }))
    ]
    const originalModels = structuredClone(models)
    const sanitized = sanitizeAggregateJson({
      providers: {
        aihubmix: { id: 'aihubmix', models },
        other: { id: 'other', models }
      }
    })

    expect(sanitized?.providers.aihubmix.models).toMatchObject([
      { limit: { context: 400000, output: 128000 }, modalities: { input: ['text', 'image'] } },
      { type: 'rerank', limit: { context: 32768 }, modalities: { input: ['text'] } },
      { type: 'rerank', limit: { context: 32768 }, modalities: { input: ['text'] } }
    ])
    expect(sanitized?.providers.other.models).toMatchObject(originalModels)
    expect(models).toEqual(originalModels)
  })

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

// Both ingestion paths must consume the same public catalog contract.
describe.each([
  ['build', sanitizeAggregateJson],
  ['runtime', sanitizeAggregate]
] as const)('%s reasoning option ingestion', (_name, sanitize) => {
  it.each([
    ['glm-5.2', ['high', 'max']],
    ['glm-5.3', ['low', 'high', 'max']],
    ['glm-5.3-flash', ['low', 'high', 'max']],
    ['deepseek-flash', ['low', 'high', 'max']],
    ['grok-4.5', ['low', 'medium', 'high']],
    ['grok-4.6', ['low', 'medium', 'high', 'xhigh']]
  ])('preserves the public effort tiers for %s across cache reloads', (id, values) => {
    const result = sanitize({
      providers: {
        demo: {
          id: 'demo',
          models: [
            {
              id,
              reasoning: { supported: true, default: true },
              reasoning_options: [{ type: 'toggle' }, { type: 'effort', values }],
              extra_capabilities: {
                reasoning: { supported: true, continuation: ['thinking_blocks'] }
              }
            }
          ]
        }
      }
    })
    const model = result!.providers.demo.models[0]
    expect(model.extra_capabilities?.reasoning).toMatchObject({
      supported: true,
      effort_options: values,
      continuation: ['thinking_blocks']
    })
    expect(model.extra_capabilities?.reasoning?.mode).toBeUndefined()
    expect(
      sanitizeAggregate(JSON.parse(JSON.stringify(result)))!.providers.demo.models[0]
    ).toMatchObject({ extra_capabilities: { reasoning: { effort_options: values } } })
  })

  it('respects explicit portraits and rejects fictitious or invalid tiers', () => {
    const result = sanitize({
      providers: {
        demo: {
          id: 'demo',
          models: [
            {
              id: 'explicit',
              extra_capabilities: { reasoning: { mode: 'effort', effort_options: ['high'] } }
            },
            {
              id: 'level',
              extra_capabilities: {
                reasoning: { mode: 'level', level: 'high', level_options: ['low', 'high'] }
              }
            },
            {
              id: 'budget',
              extra_capabilities: { reasoning: { mode: 'budget', budget: { default: 1024 } } }
            },
            { id: 'fixed', extra_capabilities: { reasoning: { mode: 'fixed' } } },
            { id: 'filtered' }
          ]
            .map((model) => ({
              ...model,
              reasoning_options: [{ type: 'effort', values: ['low', 'invalid', 1, 'low'] }]
            }))
            .concat([
              { id: 'toggle', reasoning_options: [{ type: 'toggle' }] } as any,
              {
                id: 'invalid',
                reasoning_options: [{ type: 'effort', values: ['invalid', null] }]
              } as any
            ])
        }
      }
    })
    const models = result!.providers.demo.models
    expect(models[0].extra_capabilities?.reasoning?.effort_options).toEqual(['high'])
    expect(models[1].extra_capabilities?.reasoning).toMatchObject({
      mode: 'level',
      level_options: ['low', 'high']
    })
    for (const index of [1, 2, 3, 5, 6]) {
      expect(models[index].extra_capabilities?.reasoning?.effort_options).toBeUndefined()
    }
    expect(models[4].extra_capabilities?.reasoning?.effort_options).toEqual(['low'])
  })
})
