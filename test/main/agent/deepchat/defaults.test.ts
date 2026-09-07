import { describe, expect, it, vi } from 'vitest'

import { DeepChatDefaults } from '@/agent/deepchat/defaults'

const createDefaults = (initialSettings: Record<string, unknown> = {}) => {
  const values = new Map(Object.entries(initialSettings))
  const settings = {
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value))
  }
  const publishSettingChanged = vi.fn()
  const defaults = new DeepChatDefaults({
    settings: settings as never,
    publishSettingChanged
  })

  return { defaults, settings, publishSettingChanged }
}

describe('DeepChatDefaults', () => {
  it('returns defaults when values are missing', () => {
    const { defaults } = createDefaults()

    expect(defaults.getAutoCompactionEnabled()).toBe(true)
    expect(defaults.getAutoCompactionTriggerThreshold()).toBe(80)
    expect(defaults.getAutoCompactionRetainRecentPairs()).toBe(2)
  })

  it('normalizes values read from app settings', () => {
    const { defaults } = createDefaults({
      autoCompactionTriggerThreshold: 2,
      autoCompactionRetainRecentPairs: 99
    })

    expect(defaults.getAutoCompactionTriggerThreshold()).toBe(5)
    expect(defaults.getAutoCompactionRetainRecentPairs()).toBe(10)
  })

  it('updates app settings and publishes the changed setting', () => {
    const { defaults, settings, publishSettingChanged } = createDefaults()

    defaults.setAutoCompactionEnabled(false)
    defaults.setAutoCompactionTriggerThreshold(83)
    defaults.setAutoCompactionRetainRecentPairs(0)

    expect(settings.set).toHaveBeenNthCalledWith(1, 'autoCompactionEnabled', false)
    expect(settings.set).toHaveBeenNthCalledWith(2, 'autoCompactionTriggerThreshold', 85)
    expect(settings.set).toHaveBeenNthCalledWith(3, 'autoCompactionRetainRecentPairs', 1)
    expect(publishSettingChanged).toHaveBeenNthCalledWith(1, 'autoCompactionEnabled', false)
    expect(publishSettingChanged).toHaveBeenNthCalledWith(2, 'autoCompactionTriggerThreshold', 85)
    expect(publishSettingChanged).toHaveBeenNthCalledWith(3, 'autoCompactionRetainRecentPairs', 1)
  })
})
