import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SHORTCUT_EVENTS } from '@/events'

const registerMock = vi.hoisted(() => vi.fn())
const unregisterAllMock = vi.hoisted(() => vi.fn())
const presenterMock = vi.hoisted(() => ({
  windowPresenter: {
    getFocusedWindow: vi.fn(),
    sendToWebContents: vi.fn(),
    mainWindow: null,
    getSettingsWindowId: vi.fn(() => null),
    show: vi.fn(),
    close: vi.fn(),
    closeSettingsWindow: vi.fn()
  }
}))
const eventBusMock = vi.hoisted(() => ({
  send: vi.fn(),
  sendToMain: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    quit: vi.fn()
  },
  globalShortcut: {
    register: registerMock,
    unregisterAll: unregisterAllMock
  }
}))

vi.mock('@/presenter', () => ({
  presenter: presenterMock
}))

vi.mock('@/eventbus', () => ({
  eventBus: eventBusMock,
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

describe('ShortcutPresenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    presenterMock.windowPresenter.getFocusedWindow.mockReturnValue({
      id: 7,
      isFocused: vi.fn(() => true),
      webContents: {
        id: 42
      }
    })
  })

  it('registers sidebar and workspace shortcuts and sends renderer events to the focused window', async () => {
    const { ShortcutPresenter } = await import('@/presenter/shortcutPresenter')
    const shortcutPresenter = new ShortcutPresenter({
      getShortcutKey: vi.fn(() => ({}))
    } as any)

    shortcutPresenter.registerShortcuts()

    const toggleSidebarCall = registerMock.mock.calls.find(
      ([accelerator]) => accelerator === 'CommandOrControl+B'
    )
    const toggleWorkspaceCall = registerMock.mock.calls.find(
      ([accelerator]) => accelerator === 'CommandOrControl+J'
    )

    expect(toggleSidebarCall).toBeTruthy()
    expect(toggleWorkspaceCall).toBeTruthy()

    toggleSidebarCall?.[1]()
    toggleWorkspaceCall?.[1]()

    expect(presenterMock.windowPresenter.sendToWebContents).toHaveBeenNthCalledWith(
      1,
      42,
      SHORTCUT_EVENTS.TOGGLE_SIDEBAR
    )
    expect(presenterMock.windowPresenter.sendToWebContents).toHaveBeenNthCalledWith(
      2,
      42,
      SHORTCUT_EVENTS.TOGGLE_WORKSPACE
    )
  })

  it('does not send sidebar or workspace events when the focused window is not active', async () => {
    presenterMock.windowPresenter.getFocusedWindow.mockReturnValue({
      id: 7,
      isFocused: vi.fn(() => false),
      webContents: {
        id: 42
      }
    })

    const { ShortcutPresenter } = await import('@/presenter/shortcutPresenter')
    const shortcutPresenter = new ShortcutPresenter({
      getShortcutKey: vi.fn(() => ({}))
    } as any)

    shortcutPresenter.registerShortcuts()

    const toggleSidebarCall = registerMock.mock.calls.find(
      ([accelerator]) => accelerator === 'CommandOrControl+B'
    )
    const toggleWorkspaceCall = registerMock.mock.calls.find(
      ([accelerator]) => accelerator === 'CommandOrControl+J'
    )

    toggleSidebarCall?.[1]()
    toggleWorkspaceCall?.[1]()

    expect(presenterMock.windowPresenter.sendToWebContents).not.toHaveBeenCalled()
  })
})
