import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SHORTCUT_EVENTS, TRAY_EVENTS } from '@/events'

const registerMock = vi.hoisted(() => vi.fn())
const unregisterAllMock = vi.hoisted(() => vi.fn())
const buildFromTemplateMock = vi.hoisted(() => vi.fn((template) => ({ template })))
const setApplicationMenuMock = vi.hoisted(() => vi.fn())
const presenterMock = vi.hoisted(() => ({
  windowPresenter: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(),
    sendToWebContents: vi.fn(),
    mainWindow: null as any,
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
    getName: vi.fn(() => 'DeepChat'),
    getLocale: vi.fn(() => 'en-US'),
    getSystemLocale: vi.fn(() => 'en-US'),
    quit: vi.fn()
  },
  globalShortcut: {
    register: registerMock,
    unregisterAll: unregisterAllMock
  },
  Menu: {
    buildFromTemplate: buildFromTemplateMock,
    setApplicationMenu: setApplicationMenuMock
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false
  }
}))

vi.mock('@/presenter', () => ({
  presenter: presenterMock
}))

vi.mock('@/eventbus', () => ({
  eventBus: eventBusMock
}))

function createConfigPresenter(shortcuts = {}) {
  return {
    getShortcutKey: vi.fn(() => shortcuts),
    getLanguage: vi.fn(() => 'en-US')
  } as any
}

function getLatestMenuTemplate(): any[] {
  const latestCall = buildFromTemplateMock.mock.calls.at(-1)
  expect(latestCall).toBeTruthy()
  return latestCall?.[0] ?? []
}

function findMenuItemByAccelerator(items: any[], accelerator: string): any | undefined {
  for (const item of items) {
    if (item?.accelerator === accelerator) {
      return item
    }

    if (Array.isArray(item?.submenu)) {
      const match = findMenuItemByAccelerator(item.submenu, accelerator)
      if (match) {
        return match
      }
    }
  }

  return undefined
}

describe('ShortcutPresenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const chatWindow = {
      id: 7,
      isFocused: vi.fn(() => true),
      isDestroyed: vi.fn(() => false),
      webContents: {
        id: 42
      }
    }
    presenterMock.windowPresenter.getFocusedWindow.mockReturnValue(chatWindow)
    presenterMock.windowPresenter.getAllWindows.mockReturnValue([chatWindow])
    presenterMock.windowPresenter.mainWindow = chatWindow
    presenterMock.windowPresenter.getSettingsWindowId.mockReturnValue(null)
  })

  it('registers sidebar and workspace menu accelerators and sends renderer events to the focused window', async () => {
    const { ShortcutPresenter } = await import('@/presenter/shortcutPresenter')
    const shortcutPresenter = new ShortcutPresenter(createConfigPresenter())

    shortcutPresenter.registerShortcuts()

    const template = getLatestMenuTemplate()
    const toggleSidebarItem = findMenuItemByAccelerator(template, 'CommandOrControl+B')
    const toggleWorkspaceItem = findMenuItemByAccelerator(template, 'CommandOrControl+J')

    expect(toggleSidebarItem).toBeTruthy()
    expect(toggleWorkspaceItem).toBeTruthy()

    toggleSidebarItem?.click()
    toggleWorkspaceItem?.click()

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

  it('does not register app-scoped shortcuts through globalShortcut', async () => {
    const { ShortcutPresenter } = await import('@/presenter/shortcutPresenter')
    const shortcutPresenter = new ShortcutPresenter(createConfigPresenter())

    shortcutPresenter.registerShortcuts()

    expect(registerMock).toHaveBeenCalledTimes(1)
    expect(registerMock).toHaveBeenCalledWith('CommandOrControl+O', expect.any(Function))
    expect(
      registerMock.mock.calls.some(([accelerator]) => accelerator === 'CommandOrControl+B')
    ).toBe(false)

    registerMock.mock.calls[0][1]()
    expect(eventBusMock.sendToMain).toHaveBeenCalledWith(TRAY_EVENTS.SHOW_HIDDEN_WINDOW)
  })

  it('does not send sidebar or workspace events when the focused window is not active', async () => {
    presenterMock.windowPresenter.getAllWindows.mockReturnValue([
      {
        id: 7,
        isFocused: vi.fn(() => false),
        webContents: {
          id: 42
        }
      }
    ])
    presenterMock.windowPresenter.getFocusedWindow.mockReturnValue({
      id: 7,
      isFocused: vi.fn(() => false),
      webContents: {
        id: 42
      }
    })

    const { ShortcutPresenter } = await import('@/presenter/shortcutPresenter')
    const shortcutPresenter = new ShortcutPresenter(createConfigPresenter())

    shortcutPresenter.registerShortcuts()

    const template = getLatestMenuTemplate()
    const toggleSidebarItem = findMenuItemByAccelerator(template, 'CommandOrControl+B')
    const toggleWorkspaceItem = findMenuItemByAccelerator(template, 'CommandOrControl+J')

    toggleSidebarItem?.click()
    toggleWorkspaceItem?.click()

    expect(presenterMock.windowPresenter.sendToWebContents).not.toHaveBeenCalled()
  })

  it('does not send sidebar or workspace events to the settings window', async () => {
    presenterMock.windowPresenter.getAllWindows.mockReturnValue([
      {
        id: 7,
        isFocused: vi.fn(() => false),
        webContents: {
          id: 42
        }
      }
    ])
    presenterMock.windowPresenter.getFocusedWindow.mockReturnValue({
      id: 99,
      isFocused: vi.fn(() => true),
      webContents: {
        id: 77
      }
    })
    presenterMock.windowPresenter.getSettingsWindowId.mockReturnValue(99)

    const { ShortcutPresenter } = await import('@/presenter/shortcutPresenter')
    const shortcutPresenter = new ShortcutPresenter(createConfigPresenter())

    shortcutPresenter.registerShortcuts()

    const template = getLatestMenuTemplate()
    const toggleSidebarItem = findMenuItemByAccelerator(template, 'CommandOrControl+B')
    const toggleWorkspaceItem = findMenuItemByAccelerator(template, 'CommandOrControl+J')

    toggleSidebarItem?.click()
    toggleWorkspaceItem?.click()

    expect(presenterMock.windowPresenter.sendToWebContents).not.toHaveBeenCalled()
  })
})
