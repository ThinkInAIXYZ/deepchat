import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { SETTINGS_EVENTS } from '@/events'

vi.mock('electron-window-state', () => ({
  default: vi.fn(() => ({
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    manage: vi.fn(),
    unmanage: vi.fn()
  }))
}))

vi.mock('@/presenter', () => ({
  presenter: {
    tabPresenter: {
      getWindowTabsData: vi.fn().mockResolvedValue([])
    },
    devicePresenter: {
      restartApp: vi.fn()
    }
  }
}))

describe('WindowPresenter settings navigation queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queues settings events until the settings renderer reports ready', async () => {
    const { WindowPresenter } = await import('@/presenter/windowPresenter')
    const presenter = new WindowPresenter({
      getContentProtectionEnabled: vi.fn(() => false)
    } as any)

    const send = vi.fn()
    ;(presenter as any).settingsWindow = {
      id: 9,
      isDestroyed: vi.fn(() => false),
      webContents: {
        id: 99,
        isDestroyed: vi.fn(() => false),
        send
      }
    }

    expect(
      presenter.sendToWindow(9, SETTINGS_EVENTS.NAVIGATE, {
        routeName: 'settings-deepchat-agents'
      })
    ).toBe(true)
    expect(presenter.sendToWindow(9, SETTINGS_EVENTS.CHECK_FOR_UPDATES)).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect((presenter as any).pendingSettingsMessages).toHaveLength(2)

    const readyHandler = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([eventName]) => eventName === SETTINGS_EVENTS.READY)?.[1]

    expect(readyHandler).toBeTypeOf('function')

    readyHandler?.({ sender: { id: 99 } } as any)

    expect(send).toHaveBeenNthCalledWith(1, SETTINGS_EVENTS.NAVIGATE, {
      routeName: 'settings-deepchat-agents'
    })
    expect(send).toHaveBeenNthCalledWith(2, SETTINGS_EVENTS.CHECK_FOR_UPDATES)
    expect((presenter as any).pendingSettingsMessages).toHaveLength(0)
  })

  it('clears queued settings messages when the settings window state resets', async () => {
    const { WindowPresenter } = await import('@/presenter/windowPresenter')
    const presenter = new WindowPresenter({
      getContentProtectionEnabled: vi.fn(() => false)
    } as any)

    ;(presenter as any).pendingSettingsMessages = [
      { channel: SETTINGS_EVENTS.NAVIGATE, args: [{ routeName: 'settings-about' }] }
    ]
    ;(presenter as any).settingsWindowReady = true
    ;(presenter as any).resetSettingsWindowState(true)

    expect((presenter as any).settingsWindowReady).toBe(false)
    expect((presenter as any).pendingSettingsMessages).toHaveLength(0)
  })
})
