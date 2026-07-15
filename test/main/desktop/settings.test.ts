import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
  }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

import { DesktopSettings } from '@/desktop/settings'

describe('DesktopSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishes the font size change after persisting it', () => {
    const settings = { set: vi.fn() }
    const desktopSettings = new DesktopSettings(settings as never)

    desktopSettings.setFontSizeLevel(4)

    expect(settings.set).toHaveBeenCalledWith('fontSizeLevel', 4)
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('settings.changed', {
      changedKeys: ['fontSizeLevel'],
      version: expect.any(Number),
      values: { fontSizeLevel: 4 }
    })
  })
})
