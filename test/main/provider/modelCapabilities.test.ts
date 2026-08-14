import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  mockDb: null as unknown
}))

vi.mock('../../../src/main/provider/providerDbLoader', () => ({
  providerDbLoader: {
    getDb: () => state.mockDb,
    subscribeCatalogChanges: vi.fn()
  }
}))

import { ModelCapabilities } from '../../../src/main/provider/modelCapabilities'

describe('ModelCapabilities reasoning portraits', () => {
  beforeEach(() => {
    state.mockDb = {
      providers: {
        openai: {
          id: 'openai',
          models: [
            { id: 'gpt-5', reasoning: { supported: true, default: true } },
            { id: 'o3', reasoning: { supported: true, default: true } },
            { id: 'gpt-5.6-sol', tool_call: true },
            { id: 'gpt-5.6-sol-preview', tool_call: true },
            { id: 'legacy-reasoning-only', reasoning: { supported: true, default: false } },
            { id: 'plain-model' }
          ]
        },
        google: {
          id: 'google',
          models: [
            {
              id: 'gemini-3.5-flash',
              default_tool_mode: 'minimal',
              reasoning: { supported: true, default: true }
            }
          ]
        },
        'alibaba-cn': {
          id: 'alibaba-cn',
          models: [
            {
              id: 'qwen3.7-max',
              reasoning: { supported: true, default: true },
              tool_call: true
            }
          ]
        },
        deepseek: {
          id: 'deepseek',
          models: [
            {
              id: 'deepseek-v4-pro',
              tool_call: true,
              reasoning: { supported: true, default: true }
            },
            { id: 'deepseek-v4-chat', tool_call: false }
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
              temperature: false,
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
            },
            {
              id: 'claude-opus-4-8',
              temperature: false,
              reasoning: { supported: true, default: true },
              extra_capabilities: {
                reasoning: {
                  supported: true
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
        moonshot: {
          id: 'moonshot',
          models: [
            {
              id: 'kimi-k3',
              reasoning: { supported: true, default: true },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  interleaved: true,
                  summaries: true,
                  visibility: 'summary',
                  continuation: ['thinking_blocks']
                }
              }
            }
          ]
        },
        'moonshot-ai': {
          id: 'moonshot-ai',
          models: [
            {
              id: 'kimi-k3',
              reasoning: { supported: true, default: true },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  mode: 'effort',
                  effort: 'high',
                  effort_options: ['low', 'high']
                }
              }
            }
          ]
        },
        'moonshot-budget': {
          id: 'moonshot-budget',
          models: [
            {
              id: 'kimi-k3',
              reasoning: { supported: true, default: true },
              extra_capabilities: {
                reasoning: {
                  supported: true,
                  mode: 'budget',
                  budget: { min: 1024, default: 4096 }
                }
              }
            }
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

  it('fills missing K3 effort metadata without overriding explicit catalog values', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.getCatalogCapabilitySnapshot('moonshot', 'kimi-k3')).toMatchObject({
      supportsReasoning: true,
      supportsReasoningEffort: true,
      reasoningEffortDefault: 'max',
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'max',
        effortOptions: ['low', 'high', 'max'],
        interleaved: true,
        summaries: true,
        visibility: 'summary',
        continuation: ['thinking_blocks']
      }
    })
    expect(
      capabilities.getCatalogCapabilitySnapshot('moonshot', 'coding-kimi_k3-free')
    ).toMatchObject({
      modelMatched: true,
      supportsReasoningEffort: true,
      reasoningEffortDefault: 'max',
      reasoningPortrait: {
        interleaved: true,
        visibility: 'summary'
      }
    })
    expect(capabilities.getCatalogCapabilitySnapshot('moonshot-ai', 'kimi-k3')).toMatchObject({
      supportsReasoningEffort: true,
      reasoningEffortDefault: 'high',
      reasoningPortrait: {
        mode: 'effort',
        effort: 'high',
        effortOptions: ['low', 'high']
      }
    })
    expect(capabilities.getCatalogCapabilitySnapshot('moonshot-budget', 'kimi-k3')).toMatchObject({
      supportsReasoningEffort: false,
      reasoningEffortDefault: undefined,
      reasoningPortrait: {
        mode: 'budget',
        budget: { min: 1024, default: 4096 }
      }
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

  it('keeps GPT-OSS reasoning without inventing sampling or effort capabilities', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.getCatalogCapabilitySnapshot('openai', 'gpt-oss-120b')).toMatchObject({
      modelMatched: false,
      supportsReasoning: true,
      supportsReasoningEffort: false,
      reasoningEffortDefault: undefined,
      temperatureCapability: undefined,
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true
      }
    })
  })

  it('prefilters both legacy and extended reasoning metadata without false positives', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.hasReasoningCandidate('legacy-reasoning-only')).toBe(true)
    expect(capabilities.hasReasoningCandidate('plain-model')).toBe(false)
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

  it('looks up provider DB capabilities with canonical model ids', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.getCapabilityModel('anthropic', 'claude-opus-4-8')?.id).toBe(
      'claude-opus-4-8'
    )
    expect(capabilities.getCapabilityModel('anthropic', 'anthropic/claude-opus-4.8')?.id).toBe(
      'claude-opus-4-8'
    )
    expect(capabilities.getCapabilityModel('anthropic', 'anthropic.claude-opus-4.8')?.id).toBe(
      'claude-opus-4-8'
    )
    expect(capabilities.supportsTemperatureControl('anthropic', 'anthropic/claude-opus-4.8')).toBe(
      false
    )
    expect(capabilities.supportsTemperatureControl('anthropic', 'anthropic.claude-opus-4.8')).toBe(
      false
    )
  })

  it('returns provider ids from canonical capability model matches', () => {
    const capabilities = new ModelCapabilities()
    const match = capabilities.getCapabilityModelMatch('anthropic', 'anthropic/claude-opus-4.8')

    expect(match).toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      model: expect.objectContaining({
        id: 'claude-opus-4-8'
      })
    })
  })

  it('finds best capability model matches across provider and model id variants', () => {
    const capabilities = new ModelCapabilities()

    expect(
      capabilities.findCapabilityModelMatch('google/gemini-3.5-flash', ['gemini'])
    ).toMatchObject({
      providerId: 'google',
      model: expect.objectContaining({
        id: 'gemini-3.5-flash'
      })
    })
    expect(capabilities.findCapabilityModelMatch('qwen3.7-max', ['alibaba-cn'])).toMatchObject({
      providerId: 'alibaba-cn',
      model: expect.objectContaining({
        id: 'qwen3.7-max'
      })
    })
    expect(capabilities.findCapabilityModelMatch('deepseek-v4-pro', ['deepseek'])).toMatchObject({
      providerId: 'deepseek',
      model: expect.objectContaining({
        id: 'deepseek-v4-pro'
      })
    })
  })

  it('reads temperature support from provider DB without model-id fallbacks', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.supportsTemperatureControl('anthropic', 'claude-opus-4-7')).toBe(false)
    expect(capabilities.supportsTemperatureControl('anthropic', 'anthropic/claude-opus-4-7')).toBe(
      false
    )
    expect(capabilities.supportsTemperatureControl('anthropic', 'claude-opus-4-8')).toBe(false)
    expect(capabilities.supportsTemperatureControl('anthropic', 'anthropic/claude-opus-4.8')).toBe(
      false
    )
    expect(capabilities.supportsTemperatureControl('anthropic', 'claude-opus-4-6')).toBe(true)
    expect(capabilities.supportsTemperatureControl('anthropic', 'claude-sonnet-4-5')).toBe(true)
    expect(capabilities.supportsTemperatureControl('anthropic', 'claude-opus-4-9')).toBe(true)
  })

  it('recommends Tool Mode only from explicit catalog identities', () => {
    const capabilities = new ModelCapabilities()

    expect(
      capabilities.getCatalogCapabilitySnapshot('openai-codex', 'gpt-5.6-sol').defaultToolMode
    ).toBe('code')
    expect(
      capabilities.getCatalogCapabilitySnapshot('openai', 'gpt-5.6-sol-preview').defaultToolMode
    ).toBeUndefined()
    expect(
      capabilities.getCatalogCapabilitySnapshot('deepseek', 'deepseek-v4-pro').defaultToolMode
    ).toBe('code')
    expect(
      capabilities.getCatalogCapabilitySnapshot('deepseek', 'deepseek-v4-chat').defaultToolMode
    ).toBeUndefined()
    expect(
      capabilities.getCatalogCapabilitySnapshot('google', 'gemini-3.5-flash').defaultToolMode
    ).toBe('minimal')
  })
})
