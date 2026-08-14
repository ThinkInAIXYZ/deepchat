import { describe, expect, it } from 'vitest'
import {
  MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE,
  MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE,
  getMoonshotKimiTemperaturePolicy,
  resolveMoonshotKimiTemperaturePolicy
} from '../../../src/shared/modelRequestPolicy'
import {
  applyModelRequestPolicy,
  isKimiK3ModelId,
  isMiniMaxM3AdaptiveThinkingModel,
  resolveCapabilityAwareRequestParameterPolicy,
  resolveModelRequestPolicy
} from '../../../src/shared/modelRequestPolicy'

describe('moonshot Kimi temperature policy', () => {
  it('locks Kimi For Coding fixed-thinking model temperature', () => {
    expect(getMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-for-coding')).toMatchObject({
      modelId: 'kimi-for-coding',
      baseModelId: 'kimi-for-coding',
      lockTemperatureControl: true
    })

    expect(
      resolveMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-for-coding', true)
    ).toEqual(
      expect.objectContaining({
        reasoningEnabled: true,
        temperature: MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE,
        thinkingType: 'enabled'
      })
    )

    expect(
      resolveMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-for-coding', false)
    ).toEqual(
      expect.objectContaining({
        reasoningEnabled: false,
        temperature: MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE,
        thinkingType: 'disabled'
      })
    )
  })

  it('locks Kimi Code K2.7 model aliases', () => {
    expect(getMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-k2.7-code')).toMatchObject({
      baseModelId: 'kimi-k2.7-code'
    })
    expect(
      getMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-k2.7-code-highspeed')
    ).toMatchObject({
      baseModelId: 'kimi-k2.7-code-highspeed'
    })
  })

  it.each([
    ['moonshot', 'kimi-k3'],
    ['new-api', 'kimi-k3'],
    ['new-api', 'moonshot/kimi-k3'],
    ['new-api', 'moonshotai/kimi-k3'],
    ['new-api', 'models/moonshotai/kimi-k3'],
    ['new-api', 'MOONSHOTAI/KIMI-K3'],
    ['aihubmix', 'coding-kimi-k3'],
    ['aihubmix', 'coding-kimi-k3-free'],
    ['zenmux', 'moonshotai/kimi-k3-free'],
    ['new-api', 'kimi_k3']
  ])(
    'recognizes exact K3 identities for %s including qualified aliases: %s',
    (providerId, modelId) => {
      expect(isKimiK3ModelId(modelId)).toBe(true)
      expect(resolveModelRequestPolicy(providerId, modelId, false)).toEqual({
        temperature: { mode: 'omit' },
        topP: { mode: 'omit' },
        reasoning: { mode: 'fixed', value: true },
        legacyThinking: { mode: 'omit' }
      })
    }
  )

  it.each([
    'kimi-k3-preview',
    'kimi-k30',
    'not-kimi-k3-model',
    'kimi-k3:thinking',
    'coding-kimi-k3-preview'
  ])('does not apply K3 policy to substring or variant matches: %s', (modelId) => {
    expect(isKimiK3ModelId(modelId)).toBe(false)
    expect(resolveModelRequestPolicy('new-api', modelId, false)).toEqual({
      temperature: { mode: 'passthrough' },
      topP: { mode: 'passthrough' },
      reasoning: { mode: 'passthrough' },
      legacyThinking: { mode: 'passthrough' }
    })
  })

  it('applies K3 policy without mutating stored generation settings', () => {
    const stored = {
      reasoning: false,
      temperature: 0.6,
      topP: 0.8
    }
    const effective = applyModelRequestPolicy(
      stored,
      resolveModelRequestPolicy('new-api', 'kimi-k3', stored.reasoning)
    )

    expect(effective).toEqual({
      reasoning: true,
      temperature: undefined,
      topP: undefined
    })
    expect(stored).toEqual({
      reasoning: false,
      temperature: 0.6,
      topP: 0.8
    })
  })

  it('normalizes unsupported temperature into effective omit without overriding explicit policy', () => {
    const passthrough = resolveModelRequestPolicy('openai', 'gpt-5', false).temperature

    expect(resolveCapabilityAwareRequestParameterPolicy(passthrough, false)).toEqual({
      mode: 'omit'
    })
    expect(resolveCapabilityAwareRequestParameterPolicy(passthrough, undefined)).toEqual({
      mode: 'passthrough'
    })

    const fixed = resolveModelRequestPolicy('moonshot', 'kimi-k2.6', true).temperature
    expect(resolveCapabilityAwareRequestParameterPolicy(fixed, false)).toEqual({
      mode: 'fixed',
      value: 1
    })

    const miniMaxOmit = resolveModelRequestPolicy('minimax', 'MiniMax-M3', true).temperature
    expect(resolveCapabilityAwareRequestParameterPolicy(miniMaxOmit, true)).toEqual({
      mode: 'omit'
    })
  })
})

describe('MiniMax-M3 thinking temperature policy', () => {
  const omitTemperaturePolicy = {
    temperature: { mode: 'omit' },
    topP: { mode: 'passthrough' },
    reasoning: { mode: 'passthrough' },
    legacyThinking: { mode: 'passthrough' }
  }
  const passthroughPolicy = {
    temperature: { mode: 'passthrough' },
    topP: { mode: 'passthrough' },
    reasoning: { mode: 'passthrough' },
    legacyThinking: { mode: 'passthrough' }
  }

  it.each([
    ['minimax', 'MiniMax-M3'],
    ['minimax', 'minimax-m3'],
    ['minimax', 'MiniMaxAI/MiniMax-M3'],
    ['minimax-cn', 'MiniMax-M3'],
    ['minimax-global', 'minimax-m3']
  ])('omits temperature for %s/%s when thinking is enabled', (providerId, modelId) => {
    expect(isMiniMaxM3AdaptiveThinkingModel(providerId, modelId)).toBe(true)
    expect(resolveModelRequestPolicy(providerId, modelId, true)).toEqual(omitTemperaturePolicy)
  })

  it.each([
    ['minimax', 'MiniMax-M3'],
    ['minimax-cn', 'minimax-m3'],
    ['minimax-global', 'MiniMaxAI/MiniMax-M3']
  ])('keeps temperature for %s/%s when thinking is disabled', (providerId, modelId) => {
    expect(resolveModelRequestPolicy(providerId, modelId, false)).toEqual(passthroughPolicy)
    expect(resolveModelRequestPolicy(providerId, modelId, undefined)).toEqual(passthroughPolicy)
  })

  it.each([
    ['minimax', 'MiniMax-M2.5'],
    ['minimax', 'minimax-m2.7'],
    ['minimax', 'minimax-m3-free'],
    ['minimax', 'minimax-m3:thinking'],
    ['openrouter', 'minimax/minimax-m3'],
    ['openai', 'MiniMax-M3'],
    ['anthropic', 'claude-opus-4-7']
  ])('does not apply MiniMax-M3 thinking policy to %s/%s', (providerId, modelId) => {
    expect(isMiniMaxM3AdaptiveThinkingModel(providerId, modelId)).toBe(false)
    expect(resolveModelRequestPolicy(providerId, modelId, true)).toEqual(passthroughPolicy)
  })

  it('applies MiniMax-M3 omit without mutating stored generation settings', () => {
    const stored = {
      reasoning: true,
      temperature: 0.6,
      topP: 0.8
    }
    const effective = applyModelRequestPolicy(
      stored,
      resolveModelRequestPolicy('minimax', 'MiniMax-M3', stored.reasoning)
    )

    expect(effective).toEqual({
      reasoning: true,
      temperature: undefined,
      topP: 0.8
    })
    expect(stored).toEqual({
      reasoning: true,
      temperature: 0.6,
      topP: 0.8
    })
  })
})
