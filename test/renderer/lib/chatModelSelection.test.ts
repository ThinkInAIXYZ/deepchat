import { describe, expect, it } from 'vitest'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import {
  resolveChatModelByQuery,
  resolvePreferredChatModel,
  resolveSamplingChatModel
} from '@/lib/chatModelSelection'

const makeModel = (
  id: string,
  providerId: string,
  options?: { vision?: boolean }
): RENDERER_MODEL_META => ({
  id,
  name: id,
  group: 'default',
  providerId,
  vision: options?.vision ?? false
})

describe('chatModelSelection', () => {
  it('resolves preferred chat models by exact candidate priority', () => {
    const result = resolvePreferredChatModel({
      modelGroups: [
        { providerId: 'openai', models: [makeModel('gpt-4o', 'openai')] },
        { providerId: 'anthropic', models: [makeModel('claude-sonnet', 'anthropic')] }
      ],
      selections: [
        { providerId: 'openai', modelId: 'missing-model' },
        { providerId: 'anthropic', modelId: 'claude-sonnet' }
      ]
    })

    expect(result?.providerId).toBe('anthropic')
    expect(result?.model.id).toBe('claude-sonnet')
  })

  it('falls back to the first available chat model when no preferred candidate matches', () => {
    const result = resolvePreferredChatModel({
      modelGroups: [
        { providerId: 'openai', models: [makeModel('gpt-4o', 'openai')] },
        { providerId: 'anthropic', models: [makeModel('claude-sonnet', 'anthropic')] }
      ],
      selections: [{ providerId: 'openai', modelId: 'missing-model' }]
    })

    expect(result?.providerId).toBe('openai')
    expect(result?.model.id).toBe('gpt-4o')
  })

  it('keeps sampling on the same provider when vision is required but the preferred model is ineligible', () => {
    const result = resolveSamplingChatModel({
      modelGroups: [
        {
          providerId: 'openai',
          models: [
            makeModel('gpt-4.1', 'openai', { vision: false }),
            makeModel('gpt-4o', 'openai', { vision: true })
          ]
        },
        {
          providerId: 'anthropic',
          models: [makeModel('claude-sonnet', 'anthropic', { vision: true })]
        }
      ],
      requiresVision: true,
      selections: [{ providerId: 'openai', modelId: 'gpt-4.1' }]
    })

    expect(result?.providerId).toBe('openai')
    expect(result?.model.id).toBe('gpt-4o')
  })

  it('matches deeplink model queries by exact id before fuzzy id', () => {
    const result = resolveChatModelByQuery(
      [
        {
          providerId: 'openai',
          models: [makeModel('gpt-4o-mini', 'openai'), makeModel('gpt-4o', 'openai')]
        }
      ],
      'gpt-4o'
    )

    expect(result?.providerId).toBe('openai')
    expect(result?.model.id).toBe('gpt-4o')
  })
})
