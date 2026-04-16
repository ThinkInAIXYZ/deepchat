import { describe, expect, it } from 'vitest'
import {
  getReasoningControlMode,
  getReasoningEffectiveEnabled,
  normalizeReasoningEffortValue,
  sanitizeAggregate,
  type ReasoningPortrait
} from '../../../src/shared/types/model-db'

describe('sanitizeAggregate', () => {
  it('keeps extra_capabilities.reasoning portraits alongside legacy reasoning', () => {
    const aggregate = sanitizeAggregate({
      providers: {
        openai: {
          id: 'openai',
          models: [
            {
              id: 'gpt-5',
              reasoning: {
                supported: true,
                default: true,
                effort: 'medium'
              },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: true,
                  mode: 'effort',
                  effort: 'medium',
                  effort_options: ['minimal', 'low', 'medium', 'high'],
                  verbosity: 'medium',
                  verbosity_options: ['low', 'medium', 'high'],
                  visibility: 'hidden',
                  continuation: ['thought_signatures'],
                  notes: ['portrait note']
                }
              }
            }
          ]
        }
      }
    })

    const model = aggregate?.providers.openai.models[0]
    expect(model?.reasoning).toEqual({
      supported: true,
      default: true,
      effort: 'medium'
    })
    expect(model?.extra_capabilities?.reasoning).toEqual({
      supported: true,
      default_enabled: true,
      mode: 'effort',
      effort: 'medium',
      effort_options: ['minimal', 'low', 'medium', 'high'],
      verbosity: 'medium',
      verbosity_options: ['low', 'medium', 'high'],
      visibility: 'hidden',
      continuation: ['thought_signatures'],
      notes: ['portrait note']
    })
  })

  it('preserves budget, level and fixed portrait variants', () => {
    const aggregate = sanitizeAggregate({
      providers: {
        demo: {
          id: 'demo',
          models: [
            {
              id: 'gemini-2.5-pro',
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: true,
                  mode: 'budget',
                  budget: { min: 0, max: 24576, default: -1, auto: -1, off: 0, unit: 'tokens' }
                }
              }
            },
            {
              id: 'gemini-3-flash-preview',
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: true,
                  mode: 'level',
                  level: 'high',
                  level_options: ['minimal', 'low', 'medium', 'high']
                }
              }
            },
            {
              id: 'gpt-5-pro',
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: true,
                  mode: 'fixed',
                  effort: 'high',
                  verbosity: 'medium',
                  verbosity_options: ['low', 'medium', 'high']
                }
              }
            }
          ]
        }
      }
    })

    expect(aggregate?.providers.demo.models[0].extra_capabilities?.reasoning?.budget).toEqual({
      min: 0,
      max: 24576,
      default: -1,
      auto: -1,
      off: 0,
      unit: 'tokens'
    })
    expect(aggregate?.providers.demo.models[1].extra_capabilities?.reasoning).toMatchObject({
      mode: 'level',
      level: 'high',
      level_options: ['minimal', 'low', 'medium', 'high']
    })
    expect(aggregate?.providers.demo.models[2].extra_capabilities?.reasoning).toMatchObject({
      mode: 'fixed',
      effort: 'high',
      verbosity: 'medium',
      verbosity_options: ['low', 'medium', 'high']
    })
  })

  it('preserves extended effort values from provider portraits', () => {
    const aggregate = sanitizeAggregate({
      providers: {
        openai: {
          id: 'openai',
          models: [
            {
              id: 'gpt-5.2',
              reasoning: {
                supported: true,
                effort: 'none'
              },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: false,
                  mode: 'effort',
                  effort: 'none',
                  effort_options: ['none', 'low', 'medium', 'high', 'xhigh']
                }
              }
            }
          ]
        }
      }
    })

    expect(aggregate?.providers.openai.models[0].reasoning).toMatchObject({
      supported: true,
      effort: 'none'
    })
    expect(aggregate?.providers.openai.models[0].extra_capabilities?.reasoning).toMatchObject({
      supported: true,
      default_enabled: false,
      mode: 'effort',
      effort: 'none',
      effort_options: ['none', 'low', 'medium', 'high', 'xhigh']
    })
  })

  it('treats supported reasoning separately from default-enabled effort portraits', () => {
    const portrait: ReasoningPortrait = {
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'none',
      effortOptions: ['none', 'low', 'medium', 'high', 'xhigh']
    }

    expect(getReasoningControlMode(portrait)).toBe('indicator')
    expect(
      getReasoningEffectiveEnabled(portrait, {
        reasoning: false,
        reasoningEffort: 'none'
      })
    ).toBe(false)
    expect(
      getReasoningEffectiveEnabled(portrait, {
        reasoning: false,
        reasoningEffort: 'xhigh'
      })
    ).toBe(true)
  })

  it('normalizes stale effort values to the portrait default when options are omitted', () => {
    const portrait: ReasoningPortrait = {
      supported: true,
      defaultEnabled: true,
      mode: 'effort',
      effort: 'xhigh'
    }

    expect(normalizeReasoningEffortValue(portrait, 'low')).toBe('xhigh')
    expect(
      getReasoningEffectiveEnabled(portrait, {
        reasoningEffort: 'low'
      })
    ).toBe(true)
  })
})
