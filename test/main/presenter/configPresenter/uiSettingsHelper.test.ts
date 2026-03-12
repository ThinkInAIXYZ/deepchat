import fontList from 'font-list'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UiSettingsHelper } from '@/presenter/configPresenter/uiSettingsHelper'

vi.mock('font-list', () => {
  const getFonts = vi.fn()
  return { default: { getFonts } }
})

const getFontsMock = vi.mocked(fontList.getFonts)

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

describe('UiSettingsHelper.getSystemFonts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes and caches fonts from font-list', async () => {
    getFontsMock.mockResolvedValue(['Inter Regular', 'Inter Bold', 'Menlo'])
    const { helper } = createHelper()

    const fonts = await helper.getSystemFonts()
    const cachedFonts = await helper.getSystemFonts()

    expect(getFontsMock).toHaveBeenCalledTimes(1)
    expect(fonts).toEqual(['Inter', 'Menlo'])
    expect(cachedFonts).toBe(fonts)
  })

  it('returns an empty array when font detection fails', async () => {
    getFontsMock.mockRejectedValue(new Error('failed to load'))
    const { helper } = createHelper()

    const fonts = await helper.getSystemFonts()

    expect(fonts).toEqual([])
  })
})

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
