import { describe, expect, it, vi } from 'vitest'

import { DeepChatDefaults } from '@/agent/deepchat/defaults'

const createDefaults = (initialConfig: Record<string, unknown> = {}) => {
  const config = { ...initialConfig }
  const repository = {
    resolveDeepChatAgentConfig: vi.fn(() => ({ ...config })),
    updateDeepChatAgent: vi.fn((_agentId: string, updates: { config: Record<string, unknown> }) => {
      Object.assign(config, updates.config)
      return { id: 'deepchat' }
    })
  }
  const onAgentChanged = vi.fn()
  const publishSettingChanged = vi.fn()
  const defaults = new DeepChatDefaults({
    repository: repository as never,
    onAgentChanged,
    publishSettingChanged
  })

  return { defaults, repository, onAgentChanged, publishSettingChanged }
}

describe('DeepChatDefaults', () => {
  it('returns defaults when values are missing', () => {
    const { defaults } = createDefaults()

    expect(defaults.getAutoCompactionEnabled()).toBe(true)
    expect(defaults.getAutoCompactionTriggerThreshold()).toBe(80)
    expect(defaults.getAutoCompactionRetainRecentPairs()).toBe(2)
  })

  it('normalizes values read from the built-in agent', () => {
    const { defaults } = createDefaults({
      autoCompactionTriggerThreshold: 2,
      autoCompactionRetainRecentPairs: 99
    })

    expect(defaults.getAutoCompactionTriggerThreshold()).toBe(5)
    expect(defaults.getAutoCompactionRetainRecentPairs()).toBe(10)
  })

  it('updates the built-in agent and publishes the changed setting', () => {
    const { defaults, repository, onAgentChanged, publishSettingChanged } = createDefaults()

    defaults.setAutoCompactionEnabled(false)
    defaults.setAutoCompactionTriggerThreshold(83)
    defaults.setAutoCompactionRetainRecentPairs(0)

    expect(repository.updateDeepChatAgent).toHaveBeenNthCalledWith(1, 'deepchat', {
      config: { autoCompactionEnabled: false }
    })
    expect(repository.updateDeepChatAgent).toHaveBeenNthCalledWith(2, 'deepchat', {
      config: { autoCompactionTriggerThreshold: 85 }
    })
    expect(repository.updateDeepChatAgent).toHaveBeenNthCalledWith(3, 'deepchat', {
      config: { autoCompactionRetainRecentPairs: 1 }
    })
    expect(onAgentChanged).toHaveBeenCalledTimes(3)
    expect(publishSettingChanged).toHaveBeenNthCalledWith(1, 'autoCompactionEnabled', false)
    expect(publishSettingChanged).toHaveBeenNthCalledWith(2, 'autoCompactionTriggerThreshold', 85)
    expect(publishSettingChanged).toHaveBeenNthCalledWith(3, 'autoCompactionRetainRecentPairs', 1)
  })
})
