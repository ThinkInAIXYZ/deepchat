import fontList from 'font-list'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UiSettingsHelper } from '@/presenter/configPresenter/uiSettingsHelper'

vi.mock('font-list', () => {
  const getFonts = vi.fn()
  return { default: { getFonts } }
})

const getFontsMock = vi.mocked(fontList.getFonts)

const createHelper = () =>
  new UiSettingsHelper({
    getSetting: () => undefined,
    setSetting: () => undefined
  })

describe('UiSettingsHelper.getSystemFonts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes and caches fonts from font-list', async () => {
    getFontsMock.mockResolvedValue(['Inter Regular', 'Inter Bold', 'Menlo'])
    const helper = createHelper()

    const fonts = await helper.getSystemFonts()
    const cachedFonts = await helper.getSystemFonts()

    expect(getFontsMock).toHaveBeenCalledTimes(1)
    expect(fonts).toEqual(['Inter', 'Menlo'])
    expect(cachedFonts).toBe(fonts)
  })

  it('returns an empty array when font detection fails', async () => {
    getFontsMock.mockRejectedValue(new Error('failed to load'))
    const helper = createHelper()

    const fonts = await helper.getSystemFonts()

    expect(fonts).toEqual([])
  })
})
