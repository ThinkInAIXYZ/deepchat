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
  it('strips catalog projections from catalog-backed provider rows', () => {
    const stored = createModel('openai-codex')

    expect(hasPersistedDerivedProviderModelFields(stored, 'openai-codex')).toBe(true)
    expect(stripDerivedProviderModelFields(stored, 'openai-codex')).toEqual({
      id: 'model-id',
      name: 'Model',
      group: 'default',
      providerId: 'openai-codex',
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

  it('retains explicit custom-model facts on catalog-backed providers', () => {
    const stored = { ...createModel('openai-codex'), isCustom: true }
    const facts = stripDerivedProviderModelFields(stored, 'openai-codex')

    expect(facts).toMatchObject({
      contextLength: 128_000,
      maxTokens: 16_000,
      vision: true,
      type: ModelType.Chat
    })
    expect(facts).not.toHaveProperty('selectableEndpointTypes')
  })
})
