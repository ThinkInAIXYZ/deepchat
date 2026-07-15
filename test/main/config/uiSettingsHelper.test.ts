import { describe, expect, it, vi } from 'vitest'

import { UiSettingsHelper } from '@/config/uiSettingsHelper'

describe('UiSettingsHelper privacy mode settings', () => {
  it('returns false by default and persists normalized values', () => {
    const settings: Record<string, unknown> = {}
    const setSetting = vi.fn(<T>(key: string, value: T) => {
      settings[key] = value
    })
    const helper = new UiSettingsHelper({
      getSetting: <T>(key: string) => settings[key] as T | undefined,
      setSetting
    })

    expect(helper.getPrivacyModeEnabled()).toBe(false)

    helper.setPrivacyModeEnabled(true)

    expect(setSetting).toHaveBeenCalledWith('privacyModeEnabled', true)
  })
})
