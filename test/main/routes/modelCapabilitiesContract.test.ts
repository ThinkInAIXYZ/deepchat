import { describe, expect, it } from 'vitest'

import { ModelCapabilitiesSchema } from '@shared/contracts/domainSchemas'

const createValidCapabilities = () => ({
  identity: {
    providerId: 'openai',
    requestModelId: 'gpt-5.4',
    catalogMatched: true as const,
    catalogModelId: 'gpt-5.4'
  },
  requestPolicy: {
    temperature: { mode: 'passthrough' as const },
    topP: { mode: 'passthrough' as const },
    reasoning: { mode: 'passthrough' as const },
    legacyThinking: { mode: 'passthrough' as const }
  },
  supportsAudioInput: false,
  supportsReasoning: true,
  reasoningPortrait: null,
  thinkingBudgetRange: {},
  supportsSearch: true,
  searchDefaults: {},
  supportsTemperatureControl: true,
  temperatureCapability: null,
  supportsReasoningEffort: true,
  reasoningEffortDefault: 'medium' as const,
  supportsVerbosity: true,
  verbosityDefault: 'medium' as const
})

describe('ModelCapabilitiesSchema', () => {
  it.each([
    'supportsAudioInput',
    'supportsReasoning',
    'supportsSearch',
    'supportsTemperatureControl',
    'thinkingBudgetRange',
    'searchDefaults'
  ] as const)('rejects null for resolved field %s', (field) => {
    expect(() =>
      ModelCapabilitiesSchema.parse({
        ...createValidCapabilities(),
        [field]: null
      })
    ).toThrow()
  })

  it('retains the documented nullable capability fields', () => {
    expect(
      ModelCapabilitiesSchema.parse({
        ...createValidCapabilities(),
        reasoningPortrait: null,
        temperatureCapability: null
      })
    ).toMatchObject({
      reasoningPortrait: null,
      temperatureCapability: null
    })
  })

  it('retains provider-native search execution metadata', () => {
    expect(
      ModelCapabilitiesSchema.parse({
        ...createValidCapabilities(),
        searchExecution: 'provider'
      })
    ).toMatchObject({
      supportsSearch: true,
      searchExecution: 'provider'
    })
  })
})
