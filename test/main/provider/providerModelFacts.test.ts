import { describe, expect, it } from 'vitest'
import { ModelType } from '@shared/model'
import {
  hasPersistedDerivedProviderModelFields,
  stripDerivedProviderModelFields
} from '@/provider/providerModelFacts'
import type { MODEL_META } from '@shared/types/provider'

const createModel = (providerId: string): MODEL_META => ({
  id: 'model-id',
  name: 'Model',
  group: 'default',
  providerId,
  isCustom: false,
  contextLength: 128_000,
  maxTokens: 16_000,
  vision: true,
  functionCall: true,
  reasoning: true,
  enableSearch: true,
  type: ModelType.Chat,
  supportedEndpointTypes: ['openai'],
  selectableEndpointTypes: ['openai', 'openai-response']
})

describe('provider model facts', () => {
  it.each([
    'openai-codex',
    'kimi-for-coding',
    'xiaomi-token-plan-cn',
    'xiaomi-token-plan-sgp',
    'xiaomi-token-plan-ams'
  ])('strips catalog projections from %s rows', (providerId) => {
    const stored = createModel(providerId)

    expect(hasPersistedDerivedProviderModelFields(stored, providerId)).toBe(true)
    expect(stripDerivedProviderModelFields(stored, providerId)).toEqual({
      id: 'model-id',
      name: 'Model',
      group: 'default',
      providerId,
      isCustom: false,
      supportedEndpointTypes: ['openai']
    })
    expect(stored).toHaveProperty('contextLength', 128_000)
  })

  it('retains upstream facts for remotely discovered provider rows', () => {
    const stored = createModel('new-api')
    const facts = stripDerivedProviderModelFields(stored, 'new-api')

    expect(facts).toMatchObject({
      contextLength: 128_000,
      maxTokens: 16_000,
      vision: true,
      functionCall: true,
      reasoning: true,
      enableSearch: true,
      type: ModelType.Chat
    })
    expect(facts).not.toHaveProperty('selectableEndpointTypes')
    expect(hasPersistedDerivedProviderModelFields(facts, 'new-api')).toBe(false)
    expect(
      hasPersistedDerivedProviderModelFields(
        { ...facts, selectableEndpointTypes: ['openai'] },
        'new-api'
      )
    ).toBe(true)
  })

  it.each(['openai-codex', 'xiaomi-token-plan-cn'])(
    'retains explicit custom-model facts on %s',
    (providerId) => {
      const stored = { ...createModel(providerId), isCustom: true }
      const facts = stripDerivedProviderModelFields(stored, providerId)

      expect(facts).toMatchObject({
        contextLength: 128_000,
        maxTokens: 16_000,
        vision: true,
        type: ModelType.Chat
      })
      expect(facts).not.toHaveProperty('selectableEndpointTypes')
    }
  )
})
