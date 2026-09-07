import logger from '@shared/logger'
import {
  app,
  globalShortcut,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions
} from 'electron'

import { SHORTCUT_EVENTS } from '../events'
import { defaultShortcutKey } from './shortcutKeySettings'
import type {
  IShortcutPresenter,
  IWindowPresenter,
  ShortcutKeySetting
} from '@shared/types/desktop'
import type { DesktopSettings } from './settings'
import { getContextMenuLabels, type TranslationMap } from '@shared/i18n'
import { is } from '@electron-toolkit/utils'
import type { DeepchatEventPublisher } from '@shared/contracts/events'

export class ShortcutPresenter implements IShortcutPresenter {
  private settings: Pick<DesktopSettings, 'getShortcutKeys' | 'getLanguage'>
  private windowPresenter: IWindowPresenter
  private shortcutKeys: ShortcutKeySetting = {
    ...defaultShortcutKey
  }

  /**
   * 创建一个新的 ShortcutPresenter 实例
   * @param shortKey 可选的自定义快捷键设置
   */
  constructor(
    settings: Pick<DesktopSettings, 'getShortcutKeys' | 'getLanguage'>,
    windowPresenter: IWindowPresenter,
    private readonly publishEvent: DeepchatEventPublisher
  ) {
    this.settings = settings
    this.windowPresenter = windowPresenter
  }

  registerShortcuts(): void {
    logger.info('reg shortcuts')
    this.refreshShortcutKeys()
    this.installApplicationMenu()
    this.registerSystemShortcuts()
  }

  private refreshShortcutKeys(): void {
    this.shortcutKeys = {
      ...defaultShortcutKey,
      ...this.settings.getShortcutKeys()
    }
  }

  private getLabels(): TranslationMap {
    const locale =
      this.settings.getLanguage() || app.getLocale?.() || app.getSystemLocale?.() || 'en-US'
    return getContextMenuLabels(locale)
  }

  private accelerator(shortcut: string | undefined): string | undefined {
    return shortcut && shortcut.trim().length > 0 ? shortcut : undefined
  }

  private createCommandItem(
    label: string,
    accelerator: string | undefined,
    click: () => void
  ): MenuItemConstructorOptions {
    return {
      label,
      accelerator: this.accelerator(accelerator),
      click
    }
  }

  private installApplicationMenu(): void {
    const labels = this.getLabels()
    const template: MenuItemConstructorOptions[] = []

    if (process.platform === 'darwin') {
      template.push({
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          this.createCommandItem(labels.settings, this.shortcutKeys.GoSettings, () =>
            this.openSettings()
          ),
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          this.createCommandItem(labels.quit, this.shortcutKeys.Quit, () => app.quit())
        ]
      })
    }

    template.push(
      {
        label: labels.file,
        submenu: [
          this.createCommandItem(labels.newConversation, this.shortcutKeys.NewConversation, () =>
            this.sendChatWindowShortcut(SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION)
          ),
          this.createCommandItem(
            labels.newWindow,
            this.shortcutKeys.NewWindow,
            () => void this.windowPresenter.createAppWindow({ initialRoute: 'chat' })
          ),
          { type: 'separator' },
          this.createCommandItem(labels.closeWindow, this.shortcutKeys.CloseWindow, () =>
            this.closeFocusedWindow()
          ),
          ...(process.platform === 'darwin'
            ? []
            : [
                { type: 'separator' as const },
                this.createCommandItem(labels.quit, this.shortcutKeys.Quit, () => app.quit())
              ])
        ]
      },
      {
        label: labels.edit,
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { type: 'separator' },
          { role: 'selectAll' }
        ]
      },
      {
        label: labels.view,
        submenu: [
          this.createCommandItem(labels.quickSearch, this.shortcutKeys.QuickSearch, () =>
            this.openQuickSearch()
          ),
          this.createCommandItem(labels.toggleSidebar, this.shortcutKeys.ToggleSidebar, () =>
            this.sendFocusedChatWindowShortcut(SHORTCUT_EVENTS.TOGGLE_SIDEBAR)
          ),
          this.createCommandItem(labels.toggleWorkspace, this.shortcutKeys.ToggleWorkspace, () =>
            this.sendFocusedChatWindowShortcut(SHORTCUT_EVENTS.TOGGLE_WORKSPACE)
          ),
          { type: 'separator' },
          this.createCommandItem(labels.cleanChatHistory, this.shortcutKeys.CleanChatHistory, () =>
            this.sendFocusedChatWindowShortcut(SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY)
          ),
          this.createCommandItem(
            labels.deleteConversation,
            this.shortcutKeys.DeleteConversation,
            () => this.sendFocusedChatWindowShortcut(SHORTCUT_EVENTS.DELETE_CONVERSATION)
          ),
          { type: 'separator' },
          this.createCommandItem(labels.zoomIn, this.shortcutKeys.ZoomIn, () => {
            this.publishEvent('appRuntime.shortcutRequested', { action: 'zoomIn' })
          }),
          this.createCommandItem(labels.zoomOut, this.shortcutKeys.ZoomOut, () => {
            this.publishEvent('appRuntime.shortcutRequested', { action: 'zoomOut' })
          }),
          this.createCommandItem(labels.resetZoom, this.shortcutKeys.ZoomResume, () => {
            this.publishEvent('appRuntime.shortcutRequested', { action: 'zoomResume' })
          }),
          ...(is.dev
            ? [
                { type: 'separator' as const },
                { role: 'reload' as const },
                { role: 'forceReload' as const },
                { role: 'toggleDevTools' as const }
              ]
            : [])
        ]
      },
      {
        label: labels.window,
        role: 'windowMenu'
      }
    )

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  private getFocusedWindow(): BrowserWindow | undefined {
    const focusedWindow = this.windowPresenter.getFocusedWindow()
    return focusedWindow?.isFocused() ? focusedWindow : undefined
  }

  private getFocusedChatWindow(): BrowserWindow | undefined {
    const focusedWindow = this.getFocusedWindow()
    if (!focusedWindow) {
      return undefined
    }

    const isChatWindow = this.windowPresenter
      .getAllWindows()
      .some((window) => window.id === focusedWindow.id)

    return isChatWindow ? focusedWindow : undefined
  }

  private getPrimaryChatWindow(): BrowserWindow | undefined {
    const focusedChatWindow = this.getFocusedChatWindow()
    if (focusedChatWindow) {
      return focusedChatWindow
    }

    const mainWindow = this.windowPresenter.mainWindow
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  }

  private sendFocusedChatWindowShortcut(channel: string): void {
    const focusedWindow = this.getFocusedChatWindow()
    if (!focusedWindow) {
      return
    }

    void this.windowPresenter.sendToWebContents(focusedWindow.webContents.id, channel)
  }

  private sendChatWindowShortcut(channel: string): void {
    const targetWindow = this.getPrimaryChatWindow()
    if (!targetWindow) {
      return
    }

    this.windowPresenter.show(targetWindow.id, true)
    void this.windowPresenter.sendToWebContents(targetWindow.webContents.id, channel)
  }

  private openQuickSearch(): void {
    const focusedWindow = this.getFocusedWindow()
    const settingsWindowId = this.windowPresenter.getSettingsWindowId()
    const targetWindow =
      focusedWindow && focusedWindow.id !== settingsWindowId
        ? focusedWindow
        : this.windowPresenter.mainWindow

    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }

    this.windowPresenter.show(targetWindow.id, true)
    void this.windowPresenter.sendToWebContents(
      targetWindow.webContents.id,
      SHORTCUT_EVENTS.TOGGLE_SPOTLIGHT
    )
  }

  private closeFocusedWindow(): void {
    const focusedWindow = this.getFocusedWindow()
    if (!focusedWindow) {
      return
    }

    if (focusedWindow.id === this.windowPresenter.getSettingsWindowId()) {
      this.windowPresenter.closeSettingsWindow()
      return
    }

    this.windowPresenter.close(focusedWindow.id)
  }

  private openSettings(): void {
    void this.windowPresenter.openOrFocusSettingsWindow().catch((error) => {
      console.error('Failed to open settings window from shortcut:', error)
    })
  }

  private registerSystemShortcuts(): void {
    globalShortcut.unregisterAll()

    if (this.shortcutKeys.ShowHideWindow) {
      globalShortcut.register(this.shortcutKeys.ShowHideWindow, () => {
        this.windowPresenter.toggleMainWindowVisibility()
      })
    }
  }

  unregisterShortcuts(): void {
    logger.info('unreg shortcuts')
    this.registerSystemShortcuts()
  }

  destroy(): void {
    globalShortcut.unregisterAll()
    Menu.setApplicationMenu(null)
  }
}
