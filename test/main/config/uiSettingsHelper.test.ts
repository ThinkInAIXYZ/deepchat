import { describe, expect, it, vi } from 'vitest'

import { UiSettingsHelper } from '@/config/uiSettingsHelper'

const createHelper = (initialSettings: Record<string, unknown> = {}) => {
  const settings = { ...initialSettings }
  const setSetting = vi.fn(<T>(key: string, value: T) => {
    settings[key] = value
  })

  return {
    helper: new UiSettingsHelper({
      getSetting: <T>(key: string) => settings[key] as T | undefined,
      setSetting
    }),
    settings,
    setSetting
  }
}

describe('UiSettingsHelper auto compaction settings', () => {
  it('returns defaults when settings are missing', () => {
    const { helper } = createHelper()

    expect(helper.getAutoCompactionEnabled()).toBe(true)
    expect(helper.getAutoCompactionTriggerThreshold()).toBe(80)
    expect(helper.getAutoCompactionRetainRecentPairs()).toBe(2)
  })

  it('clamps persisted invalid values on read', () => {
    const { helper } = createHelper({
      autoCompactionTriggerThreshold: 2,
      autoCompactionRetainRecentPairs: 99
    })

    expect(helper.getAutoCompactionTriggerThreshold()).toBe(5)
    expect(helper.getAutoCompactionRetainRecentPairs()).toBe(10)
  })

  it('normalizes values before persisting', () => {
    const { helper, setSetting } = createHelper()

    helper.setAutoCompactionEnabled(false)
    helper.setAutoCompactionTriggerThreshold(83)
    helper.setAutoCompactionRetainRecentPairs(0)

    expect(setSetting).toHaveBeenNthCalledWith(1, 'autoCompactionEnabled', false)
    expect(setSetting).toHaveBeenNthCalledWith(2, 'autoCompactionTriggerThreshold', 85)
    expect(setSetting).toHaveBeenNthCalledWith(3, 'autoCompactionRetainRecentPairs', 1)
  })
})

describe('UiSettingsHelper privacy mode settings', () => {
  it('returns false by default and persists normalized values', () => {
    const { helper, setSetting } = createHelper()

    expect(helper.getPrivacyModeEnabled()).toBe(false)

    helper.setPrivacyModeEnabled(true)

    expect(setSetting).toHaveBeenCalledWith('privacyModeEnabled', true)
  })
})
