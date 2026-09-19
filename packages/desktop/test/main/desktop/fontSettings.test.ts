import fontList from 'font-list'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FontSettings } from '@/desktop/fontSettings'

vi.mock('font-list', () => ({ default: { getFonts: vi.fn() } }))

const getFontsMock = vi.mocked(fontList.getFonts)

const createSettings = () => {
  const values = new Map<string, unknown>()
  return {
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value))
  }
}

describe('FontSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('normalizes and caches system fonts', async () => {
    getFontsMock.mockResolvedValue(['Inter Regular', 'Inter Bold', 'Menlo'])
    const fonts = new FontSettings(createSettings() as never, vi.fn())

    const detected = await fonts.getSystemFonts()
    const cached = await fonts.getSystemFonts()

    expect(getFontsMock).toHaveBeenCalledTimes(1)
    expect(detected).toEqual(['Inter', 'Menlo'])
    expect(cached).toBe(detected)
  })

  it('returns an empty array when font detection fails', async () => {
    getFontsMock.mockRejectedValue(new Error('failed to load'))
    const fonts = new FontSettings(createSettings() as never, vi.fn())

    await expect(fonts.getSystemFonts()).resolves.toEqual([])
  })
})
