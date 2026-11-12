import { expect, it } from 'vitest'
import { dimModelParameters } from '@/agent/dim/modelCatalog'
import type { ReasoningPortrait } from '@shared/types/model-db'

const base = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9
}
const baseParameters = { temperature: 0.7, maxTokens: 1024, topP: 0.9 }

it('keeps the legacy interleaved flag out of native reasoning parameters', () => {
  expect(
    dimModelParameters(
      { ...base, ...{ forceInterleavedThinkingCompat: true } },
      {
        providerKind: 'openai-compatible',
        providerId: 'local',
        modelId: 'm'
      }
    )
  ).toEqual({ temperature: 0.7, topP: 0.9, maxTokens: 1024 })
})

it.each(['openai-compatible', 'openai-responses', 'deepseek-open-responses'])(
  'does not leak budget or visibility fields into %s',
  (providerKind) => {
    expect(
      dimModelParameters(
        { ...base, reasoningEffort: 'high', thinkingBudget: 2048, reasoningVisibility: 'full' },
        { providerKind }
      )
    ).toEqual({ ...baseParameters, reasoning: { effort: 'high' } })
  }
)

it('maps Gemini visibility and budget to Gemini-only reasoning fields', () => {
  expect(
    dimModelParameters(
      { ...base, reasoningVisibility: 'hidden', thinkingBudget: 0 },
      { providerKind: 'gemini', providerId: 'google', modelId: 'gemini-2.5-flash' }
    )
  ).toEqual({
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    reasoning: { includeThoughts: false, budgetTokens: 0 }
  })

  expect(
    dimModelParameters(
      { ...base, reasoningVisibility: 'full', thinkingBudget: 1024 },
      { providerKind: 'gemini', providerId: 'google', modelId: 'gemini-2.5-flash' }
    )
  ).toEqual({
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    reasoning: { includeThoughts: true, budgetTokens: 1024 }
  })
})

it('never combines Gemini effort and budget, including disabled reasoning', () => {
  const context = { providerKind: 'gemini', modelId: 'gemini-3-flash' }
  expect(
    dimModelParameters({ ...base, reasoningEffort: 'high', thinkingBudget: 1024 }, context)
  ).toEqual({ ...baseParameters, reasoning: { effort: 'high' } })
  expect(
    dimModelParameters({ ...base, reasoningEffort: 'none', thinkingBudget: 1024 }, context)
  ).toEqual({ ...baseParameters, reasoning: { budgetTokens: 0 } })
})

it('uses Gemini controls for Vertex and preserves supported Bedrock budgets without effort', () => {
  expect(
    dimModelParameters(
      { ...base, thinkingBudget: 2048, reasoningVisibility: 'hidden' },
      { providerKind: 'vertex' }
    )
  ).toEqual({ ...baseParameters, reasoning: { budgetTokens: 2048, includeThoughts: false } })
  for (const providerKind of ['aws-bedrock', 'amazon-bedrock']) {
    expect(
      dimModelParameters(
        { ...base, thinkingBudget: 2048, reasoningEffort: 'high' },
        { providerKind }
      )
    ).toEqual({ ...baseParameters, reasoning: { budgetTokens: 2048 } })
    expect(dimModelParameters({ ...base, thinkingBudget: 0 }, { providerKind })).toEqual(
      baseParameters
    )
  }
})

it('maps Anthropic reasoning with explicit disabled precedence and adaptive effort', () => {
  expect(
    dimModelParameters(
      { ...base, reasoningEffort: 'none', thinkingBudget: 1024 },
      { providerKind: 'anthropic', providerId: 'anthropic', modelId: 'claude-sonnet-4' }
    )
  ).toEqual({
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    providerOptions: { anthropic: { thinking: { type: 'disabled' } } }
  })

  expect(
    dimModelParameters(
      { ...base, reasoningEffort: 'high' },
      {
        providerKind: 'anthropic',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        reasoningPortrait: { mode: 'effort', effort: 'high' }
      }
    )
  ).toEqual({
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    reasoning: { effort: 'high' },
    providerOptions: { anthropic: { thinking: { type: 'adaptive' } } }
  })
})

it.each(['claude-fable-5', 'claude-mythos-5'])(
  'never sends disabled thinking or manual budget for always-on %s portraits',
  (modelId) => {
    const reasoningPortrait: ReasoningPortrait = {
      mode: 'effort',
      defaultEnabled: true,
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max']
    }
    const context = { providerKind: 'anthropic', modelId, reasoningPortrait }
    expect(dimModelParameters(base, context)).toEqual({
      ...baseParameters,
      providerOptions: { anthropic: { thinking: { type: 'adaptive' } } }
    })
    expect(
      dimModelParameters({ ...base, reasoningEffort: 'none', thinkingBudget: 2048 }, context)
    ).toEqual({
      ...baseParameters,
      reasoning: { effort: 'high' },
      providerOptions: { anthropic: { thinking: { type: 'adaptive' } } }
    })
    expect(dimModelParameters({ ...base, thinkingBudget: 0 }, context)).toEqual({
      ...baseParameters,
      providerOptions: { anthropic: { thinking: { type: 'adaptive' } } }
    })
  }
)

it.each(['claude-opus-4-7', 'claude-opus-4-8'])(
  'preserves explicit off but never sends manual budget for adaptive-only %s',
  (modelId) => {
    const reasoningPortrait: ReasoningPortrait = {
      mode: 'effort',
      defaultEnabled: false,
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max']
    }
    const context = { providerKind: 'anthropic', modelId, reasoningPortrait }
    expect(dimModelParameters(base, context)).toEqual(baseParameters)
    for (const settings of [{ reasoningEffort: 'none' as const }, { thinkingBudget: 0 }]) {
      expect(dimModelParameters({ ...base, ...settings }, context)).toEqual({
        ...baseParameters,
        providerOptions: { anthropic: { thinking: { type: 'disabled' } } }
      })
    }
    expect(dimModelParameters({ ...base, thinkingBudget: 2048 }, context)).toEqual({
      ...baseParameters,
      providerOptions: { anthropic: { thinking: { type: 'adaptive' } } }
    })
    expect(dimModelParameters({ ...base, reasoningEffort: 'high' }, context)).toEqual({
      ...baseParameters,
      reasoning: { effort: 'high' },
      providerOptions: { anthropic: { thinking: { type: 'adaptive' } } }
    })
  }
)

it.each(['MiniMax-M3', 'vendor/minimax-m3-preview', 'minimax-m3.1-flash'])(
  'enables adaptive thinking for qualified/case-insensitive MiniMax family %s',
  (modelId) => {
    expect(
      dimModelParameters(base, { providerKind: 'anthropic', providerId: 'custom', modelId })
    ).toEqual({
      ...baseParameters,
      providerOptions: { anthropic: { thinking: { type: 'adaptive' } } }
    })
  }
)

it('does not apply MiniMax adaptive defaults to a different model or protocol', () => {
  expect(dimModelParameters(base, { providerKind: 'anthropic', modelId: 'minimax-m30' })).toEqual(
    baseParameters
  )
  expect(
    dimModelParameters(base, { providerKind: 'openai-compatible', modelId: 'MiniMax-M3' })
  ).toEqual(baseParameters)
})

it('enables Anthropic thinking for budget-only and MiniMax M3 sessions', () => {
  expect(
    dimModelParameters(
      { ...base, thinkingBudget: 2048 },
      { providerKind: 'anthropic', providerId: 'anthropic', modelId: 'claude-sonnet-4' }
    )
  ).toEqual({
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } } }
  })

  expect(
    dimModelParameters(
      { ...base },
      { providerKind: 'anthropic', providerId: 'minimax', modelId: 'MiniMax-M3' }
    )
  ).toEqual({
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    providerOptions: { anthropic: { thinking: { type: 'adaptive' } } }
  })
})
