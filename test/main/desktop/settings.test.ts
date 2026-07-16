import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
  }
}))

import { DesktopSettings } from '@/desktop/settings'

describe('DesktopSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  const effects = {
    refreshLanguage: vi.fn(),
    refreshTheme: vi.fn(async () => undefined)
  }

  it('publishes the font size change after persisting it', () => {
    const settings = { set: vi.fn() }
    const desktopSettings = new DesktopSettings(
      settings as never,
      effects,
      publishDeepchatEventMock
    )

    desktopSettings.setFontSizeLevel(4)

    expect(settings.set).toHaveBeenCalledWith('fontSizeLevel', 4)
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('settings.changed', {
      changedKeys: ['fontSizeLevel'],
      version: expect.any(Number),
      values: { fontSizeLevel: 4 }
    })
  })

  it('owns copy with reasoning settings', () => {
    const settings = {
      get: vi.fn(() => undefined),
      set: vi.fn()
    }
    const desktopSettings = new DesktopSettings(
      settings as never,
      effects,
      publishDeepchatEventMock
    )

    expect(desktopSettings.getCopyWithCotEnabled()).toBe(true)

    desktopSettings.setCopyWithCotEnabled(false)

    expect(settings.set).toHaveBeenCalledWith('copyWithCotEnabled', false)
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('settings.changed', {
      changedKeys: ['copyWithCotEnabled'],
      version: expect.any(Number),
      values: { copyWithCotEnabled: false }
    })
  })
})
