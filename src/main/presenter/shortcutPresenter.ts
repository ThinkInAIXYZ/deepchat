import { app, globalShortcut } from 'electron'

import { presenter } from '.'
import { SHORTCUT_EVENTS, TRAY_EVENTS } from '../events'
import { eventBus, SendTarget } from '../eventbus'
import { defaultShortcutKey, ShortcutKeySetting } from './configPresenter/shortcutKeySettings'
import { IConfigPresenter, IShortcutPresenter } from '@shared/presenter'

export class ShortcutPresenter implements IShortcutPresenter {
  private isActive: boolean = false
  private configPresenter: IConfigPresenter
  private shortcutKeys: ShortcutKeySetting = {
    ...defaultShortcutKey
  }

  /**
   * 创建一个新的 ShortcutPresenter 实例
   * @param shortKey 可选的自定义快捷键设置
   */
  constructor(configPresenter: IConfigPresenter) {
    this.configPresenter = configPresenter
  }

  registerShortcuts(): void {
    if (this.isActive) return
    console.log('reg shortcuts')

    this.shortcutKeys = {
      ...defaultShortcutKey,
      ...this.configPresenter.getShortcutKey()
    }

    // Command+N 或 Ctrl+N 创建新会话
    if (this.shortcutKeys.NewConversation) {
      globalShortcut.register(this.shortcutKeys.NewConversation, async () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          presenter.windowPresenter.sendToActiveTab(
            focusedWindow.id,
            SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION
          )
        }
      })
    }

    // Command+Shift+N 或 Ctrl+Shift+N 创建新窗口
    if (this.shortcutKeys.NewWindow) {
      globalShortcut.register(this.shortcutKeys.NewWindow, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          eventBus.sendToMain(SHORTCUT_EVENTS.CREATE_NEW_WINDOW)
        }
      })
    }

    // Command+W 或 Ctrl+W 关闭当前窗口
    if (this.shortcutKeys.CloseTab) {
      globalShortcut.register(this.shortcutKeys.CloseTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          if (focusedWindow.id === presenter.windowPresenter.getSettingsWindowId()) {
            // 如果是设置窗口，直接关闭
            presenter.windowPresenter.closeSettingsWindow()
            return
          }
          presenter.windowPresenter.close(focusedWindow.id)
        }
      })
    }

    // Command+Q 或 Ctrl+Q 退出程序
    if (this.shortcutKeys.Quit) {
      globalShortcut.register(this.shortcutKeys.Quit, () => {
        app.quit() // Exit trigger: shortcut key
      })
    }

    // Command+= 或 Ctrl+= 放大字体
    if (this.shortcutKeys.ZoomIn) {
      globalShortcut.register(this.shortcutKeys.ZoomIn, () => {
        eventBus.send(SHORTCUT_EVENTS.ZOOM_IN, SendTarget.ALL_WINDOWS)
      })
    }

    // Command+- 或 Ctrl+- 缩小字体
    if (this.shortcutKeys.ZoomOut) {
      globalShortcut.register(this.shortcutKeys.ZoomOut, () => {
        eventBus.send(SHORTCUT_EVENTS.ZOOM_OUT, SendTarget.ALL_WINDOWS)
      })
    }

    // Command+0 或 Ctrl+0 重置字体大小
    if (this.shortcutKeys.ZoomResume) {
      globalShortcut.register(this.shortcutKeys.ZoomResume, () => {
        eventBus.send(SHORTCUT_EVENTS.ZOOM_RESUME, SendTarget.ALL_WINDOWS)
      })
    }

    // Command+, 或 Ctrl+, 打开设置
    if (this.shortcutKeys.GoSettings) {
      globalShortcut.register(this.shortcutKeys.GoSettings, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          eventBus.sendToMain(SHORTCUT_EVENTS.GO_SETTINGS, focusedWindow.id)
        }
      })
    }
    console.log('clean chat history shortcut', this.shortcutKeys.CleanChatHistory)
    // Command+L 或 Ctrl+L 清除聊天历史
    if (this.shortcutKeys.CleanChatHistory) {
      globalShortcut.register(this.shortcutKeys.CleanChatHistory, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        console.log('clean chat history')
        if (focusedWindow?.isFocused()) {
          presenter.windowPresenter.sendToActiveTab(
            focusedWindow.id,
            SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY
          )
        }
      })
    }

    // Command+D 或 Ctrl+D 清除聊天历史
    if (this.shortcutKeys.DeleteConversation) {
      globalShortcut.register(this.shortcutKeys.DeleteConversation, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        console.log('delete conversation')
        if (focusedWindow?.isFocused()) {
          presenter.windowPresenter.sendToActiveTab(
            focusedWindow.id,
            SHORTCUT_EVENTS.DELETE_CONVERSATION
          )
        }
      })
    }

    this.showHideWindow()

    this.isActive = true
  }

  // Command+O 或 Ctrl+O 显示/隐藏窗口
  private async showHideWindow() {
    // Command+O 或 Ctrl+O 显示/隐藏窗口
    if (this.shortcutKeys.ShowHideWindow) {
      globalShortcut.register(this.shortcutKeys.ShowHideWindow, () => {
        eventBus.sendToMain(TRAY_EVENTS.SHOW_HIDDEN_WINDOW)
      })
    }
  }

  unregisterShortcuts(): void {
    console.log('unreg shortcuts')
    globalShortcut.unregisterAll()

    this.showHideWindow()
    this.isActive = false
  }

  destroy(): void {
    this.unregisterShortcuts()
  }
}
