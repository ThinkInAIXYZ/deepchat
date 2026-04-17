import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  mockDb: null as unknown
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn()
  }
}))

vi.mock('../../../../src/main/presenter/configPresenter/providerDbLoader', () => ({
  providerDbLoader: {
    getDb: () => state.mockDb
  }
}))

import { ModelCapabilities } from '../../../../src/main/presenter/configPresenter/modelCapabilities'

describe('ModelCapabilities reasoning portraits', () => {
  beforeEach(() => {
    state.mockDb = {
      providers: {
        openai: {
          id: 'openai',
          models: [
            { id: 'gpt-5', reasoning: { supported: true, default: true } },
            { id: 'o3', reasoning: { supported: true, default: true } }
          ]
        },
        openrouter: {
          id: 'openrouter',
          models: [
            {
              id: 'anthropic/claude-4-sonnet',
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: false,
                  mode: 'budget',
                  budget: { min: 1024, default: 2048 },
                  summaries: true,
                  visibility: 'summary'
                }
              }
            },
            {
              id: 'google/gemini-2.5-pro',
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
              id: 'google/gemini-3-flash-preview',
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
              id: 'xai/grok-4',
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: true,
                  mode: 'effort',
                  effort: 'minimal',
                  effort_options: ['minimal', 'low', 'medium', 'high']
                }
              }
            },
            {
              id: 'openai/gpt-5.2',
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: false,
                  mode: 'effort',
                  effort: 'none',
                  effort_options: ['none', 'low', 'medium', 'high', 'xhigh']
                }
              }
            },
            {
              id: 'openai/gpt-5.4-pro',
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: true,
                  mode: 'effort',
                  effort: 'xhigh'
                }
              }
            }
          ]
        },
        anthropic: {
          id: 'anthropic',
          models: [
            { id: 'claude-4-sonnet', reasoning: { supported: true } },
            { id: 'claude-sonnet-4-5', reasoning: { supported: true } },
            {
              id: 'claude-opus-4-7',
              reasoning: { supported: true, default: false },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  default_enabled: false,
                  mode: 'effort',
                  effort: 'high',
                  effort_options: ['low', 'medium', 'high', 'xhigh', 'max'],
                  visibility: 'omitted'
                }
              }
            }
          ]
        },
        xai: {
          id: 'xai',
          models: [
            { id: 'grok-4', reasoning: { supported: true, default: true } },
            { id: 'grok-3-mini-fast-beta', reasoning: { supported: true, default: true } }
          ]
        },
        '302ai': {
          id: '302ai',
          models: [{ id: 'gpt-5-thinking', reasoning: { supported: true, default: true } }]
        }
      }
    }
  })

  it('fills legacy OpenAI fallbacks with effort and verbosity options', () => {
    const capabilities = new ModelCapabilities()
    const portrait = capabilities.getReasoningPortrait('openai', 'gpt-5')

    expect(portrait).toMatchObject({
      supported: true,
      defaultEnabled: true,
      mode: 'effort',
      effort: 'medium',
      effortOptions: ['minimal', 'low', 'medium', 'high'],
      verbosity: 'medium',
      verbosityOptions: ['low', 'medium', 'high']
    })
    expect(capabilities.supportsReasoningEffort('openai', 'o3')).toBe(true)
    expect(capabilities.supportsVerbosity('openai', 'o3')).toBe(false)
  })

  it('uses cross-provider portrait registry before legacy defaults', () => {
    const capabilities = new ModelCapabilities()
    const portrait = capabilities.getReasoningPortrait('anthropic', 'claude-4-sonnet')

    expect(portrait).toMatchObject({
      supported: true,
      defaultEnabled: false,
      mode: 'budget',
      budget: { min: 1024, default: 2048 },
      summaries: true,
      visibility: 'summary'
    })
    expect(capabilities.supportsReasoning('anthropic', 'claude-4-sonnet')).toBe(true)
    expect(capabilities.supportsReasoningEffort('anthropic', 'claude-4-sonnet')).toBe(false)
    expect(capabilities.getThinkingBudgetRange('anthropic', 'claude-4-sonnet')).toEqual({
      min: 1024,
      default: 2048
    })
  })

  it('preserves budget sentinel values from the portrait registry', () => {
    const capabilities = new ModelCapabilities()
    const portrait = capabilities.getReasoningPortrait('gemini', 'gemini-2.5-pro')

    expect(portrait?.budget).toMatchObject({
      min: 0,
      max: 24576,
      default: -1,
      auto: -1,
      off: 0,
      unit: 'tokens'
    })
    expect(capabilities.getThinkingBudgetRange('gemini', 'gemini-2.5-pro')).toEqual({
      min: 0,
      max: 24576,
      default: -1
    })
  })

  it('keeps level portraits from pretending to support effort or budget controls', () => {
    const capabilities = new ModelCapabilities()
    const portrait = capabilities.getReasoningPortrait('vertex', 'gemini-3-flash-preview')

    expect(portrait).toMatchObject({
      supported: true,
      defaultEnabled: true,
      mode: 'level',
      level: 'high',
      levelOptions: ['minimal', 'low', 'medium', 'high']
    })
    expect(capabilities.supportsReasoningEffort('vertex', 'gemini-3-flash-preview')).toBe(false)
    expect(capabilities.getThinkingBudgetRange('vertex', 'gemini-3-flash-preview')).toEqual({})
  })

  it('shares grok portraits across providers but keeps grok-3-mini binary fallback', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.getReasoningPortrait('xai', 'grok-4')).toMatchObject({
      supported: true,
      effort: 'minimal',
      effortOptions: ['minimal', 'low', 'medium', 'high']
    })
    expect(capabilities.getReasoningPortrait('xai', 'grok-3-mini-fast-beta')).toMatchObject({
      supported: true,
      effort: 'low',
      effortOptions: ['low', 'high']
    })
  })

  it('does not synthesize OpenAI-only defaults for non-OpenAI providers', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.supportsReasoning('302ai', 'gpt-5-thinking')).toBe(true)
    expect(capabilities.supportsReasoningEffort('302ai', 'gpt-5-thinking')).toBe(false)
    expect(capabilities.getReasoningEffortDefault('302ai', 'gpt-5-thinking')).toBeUndefined()
    expect(capabilities.supportsVerbosity('302ai', 'gpt-5-thinking')).toBe(false)
    expect(capabilities.getVerbosityDefault('302ai', 'gpt-5-thinking')).toBeUndefined()
  })

  it('preserves official anthropic adaptive reasoning portraits', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.getReasoningPortrait('anthropic', 'claude-opus-4-7')).toMatchObject({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      visibility: 'omitted'
    })
    expect(capabilities.supportsReasoningEffort('anthropic', 'claude-opus-4-7')).toBe(true)
  })

  it('keeps explicit none and xhigh effort portraits without synthesizing extra options', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.getReasoningPortrait('openai', 'gpt-5.2')).toMatchObject({
      supported: true,
      defaultEnabled: false,
      effort: 'none',
      effortOptions: ['none', 'low', 'medium', 'high', 'xhigh']
    })
    expect(capabilities.getReasoningEffortDefault('openai', 'gpt-5.2')).toBe('none')

    const xhighPortrait = capabilities.getReasoningPortrait('openai', 'gpt-5.4-pro')
    expect(xhighPortrait).toMatchObject({
      supported: true,
      defaultEnabled: true,
      effort: 'xhigh'
    })
    expect(xhighPortrait?.effortOptions).toBeUndefined()
  })

  it('disables temperature control for claude-opus-4-7 family fallback ids only', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.supportsTemperatureControl('anthropic', 'claude-opus-4-7')).toBe(false)
    expect(capabilities.supportsTemperatureControl('anthropic', 'anthropic/claude-opus-4-7')).toBe(
      false
    )
    expect(capabilities.supportsTemperatureControl('anthropic', 'claude-opus-4-6')).toBe(true)
    expect(capabilities.supportsTemperatureControl('anthropic', 'claude-sonnet-4-5')).toBe(true)
  })
})
