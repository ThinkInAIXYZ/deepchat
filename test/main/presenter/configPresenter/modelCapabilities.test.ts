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

describe('ModelCapabilities reasoning fallbacks', () => {
  beforeEach(() => {
    state.mockDb = {
      providers: {
        openai: {
          id: 'openai',
          models: [
            { id: 'gpt-5', reasoning: { supported: true, default: true } },
            { id: 'gpt-5.4', reasoning: { supported: true, default: true } },
            { id: 'gpt-5.3-codex', reasoning: { supported: true, default: true } },
            { id: 'o3', reasoning: { supported: true, default: true } }
          ]
        },
        'cloudflare-ai-gateway': {
          id: 'cloudflare-ai-gateway',
          models: [
            { id: 'openai/gpt-5', reasoning: { supported: true, default: true } },
            { id: 'openai/gpt-5.4', reasoning: { supported: true, default: true } }
          ]
        },
        xai: {
          id: 'xai',
          models: [{ id: 'grok-3-mini-fast-beta', reasoning: { supported: true, default: true } }]
        }
      }
    }
  })

  it('fills missing OpenAI reasoning effort and verbosity defaults', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.supportsReasoningEffort('openai', 'gpt-5')).toBe(true)
    expect(capabilities.getReasoningEffortDefault('openai', 'gpt-5')).toBe('medium')
    expect(capabilities.supportsVerbosity('openai', 'gpt-5')).toBe(true)
    expect(capabilities.getVerbosityDefault('openai', 'gpt-5')).toBe('medium')

    expect(capabilities.supportsReasoningEffort('openai', 'gpt-5.4')).toBe(true)
    expect(capabilities.getReasoningEffortDefault('openai', 'gpt-5.4')).toBe('medium')
    expect(capabilities.supportsVerbosity('openai', 'gpt-5.4')).toBe(true)
    expect(capabilities.getVerbosityDefault('openai', 'gpt-5.4')).toBe('medium')

    expect(capabilities.supportsReasoningEffort('openai', 'gpt-5.3-codex')).toBe(true)
    expect(capabilities.getReasoningEffortDefault('openai', 'gpt-5.3-codex')).toBe('medium')
    expect(capabilities.supportsVerbosity('openai', 'gpt-5.3-codex')).toBe(true)
    expect(capabilities.getVerbosityDefault('openai', 'gpt-5.3-codex')).toBe('medium')

    expect(capabilities.supportsReasoningEffort('openai', 'o3')).toBe(true)
    expect(capabilities.getReasoningEffortDefault('openai', 'o3')).toBe('medium')
    expect(capabilities.supportsVerbosity('openai', 'o3')).toBe(false)
  })

  it('supports prefixed OpenAI model ids and xAI Grok defaults', () => {
    const capabilities = new ModelCapabilities()

    expect(capabilities.supportsReasoningEffort('cloudflare-ai-gateway', 'openai/gpt-5')).toBe(true)
    expect(capabilities.getReasoningEffortDefault('cloudflare-ai-gateway', 'openai/gpt-5')).toBe(
      'medium'
    )
    expect(capabilities.supportsReasoningEffort('cloudflare-ai-gateway', 'openai/gpt-5.4')).toBe(
      true
    )
    expect(capabilities.getReasoningEffortDefault('cloudflare-ai-gateway', 'openai/gpt-5.4')).toBe(
      'medium'
    )

    expect(capabilities.supportsReasoningEffort('xai', 'grok-3-mini-fast-beta')).toBe(true)
    expect(capabilities.getReasoningEffortDefault('xai', 'grok-3-mini-fast-beta')).toBe('low')
  })
})
