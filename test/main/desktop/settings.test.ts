import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const getLocaleMock = vi.hoisted(() => vi.fn(() => 'en-US'))

vi.mock('electron', () => ({
  app: {
    getLocale: getLocaleMock,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
  }
}))

import { DesktopSettings } from '@/desktop/settings'

describe('DesktopSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLocaleMock.mockReturnValue('en-US')
  })

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

  it('resolves system and explicit languages through the shared locale manifest', () => {
    const settings = {
      get: vi.fn(() => 'system'),
      set: vi.fn()
    }
    getLocaleMock.mockReturnValue('zh-Hant-HK')
    const desktopSettings = new DesktopSettings(
      settings as never,
      effects,
      publishDeepchatEventMock
    )

    expect(desktopSettings.getLanguage()).toBe('zh-HK')

    settings.get.mockReturnValue('fr-CA')
    expect(desktopSettings.getRequestedLanguage()).toBe('fr-FR')
    expect(desktopSettings.getLanguage()).toBe('fr-FR')
  })

  it('publishes a normalized locale and direction once when changing language', () => {
    const settings = {
      get: vi.fn(() => 'fa-IR'),
      set: vi.fn()
    }
    const desktopSettings = new DesktopSettings(
      settings as never,
      effects,
      publishDeepchatEventMock
    )

    desktopSettings.setLanguage('fa')

    expect(settings.set).toHaveBeenCalledWith('language', 'fa-IR')
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('config.language.changed', {
      requestedLanguage: 'fa-IR',
      locale: 'fa-IR',
      direction: 'rtl',
      version: expect.any(Number)
    })
  })
})
