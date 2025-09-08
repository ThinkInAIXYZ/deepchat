import { app, globalShortcut } from 'electron'

import { presenter } from '.'
import { SHORTCUT_EVENTS, TRAY_EVENTS } from '../events'
import { eventBus, SendTarget } from '../eventbus'
import {
  CommandKey,
  defaultShortcutKey,
  ShortcutKeySetting
} from './configPresenter/shortcutKeySettings'
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

    // Command+T 或 Ctrl+T 在当前窗口创建新标签页
    if (this.shortcutKeys.NewTab) {
      globalShortcut.register(this.shortcutKeys.NewTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          eventBus.sendToMain(SHORTCUT_EVENTS.CREATE_NEW_TAB, focusedWindow.id)
        }
      })
    }

    // Command+W 或 Ctrl+W 关闭当前标签页
    if (this.shortcutKeys.CloseTab) {
      globalShortcut.register(this.shortcutKeys.CloseTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          eventBus.sendToMain(SHORTCUT_EVENTS.CLOSE_CURRENT_TAB, focusedWindow.id)
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
          presenter.windowPresenter.sendToActiveTab(focusedWindow.id, SHORTCUT_EVENTS.GO_SETTINGS)
        }
      })
    }

    // Command+L 或 Ctrl+L 清除聊天历史
    if (this.shortcutKeys.CleanChatHistory) {
      globalShortcut.register(this.shortcutKeys.CleanChatHistory, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
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
        if (focusedWindow?.isFocused()) {
          presenter.windowPresenter.sendToActiveTab(
            focusedWindow.id,
            SHORTCUT_EVENTS.DELETE_CONVERSATION
          )
        }
      })
    }

    // 添加标签页切换相关快捷键

    // Command+Tab 或 Ctrl+Tab 切换到下一个标签页
    if (this.shortcutKeys.SwitchNextTab) {
      globalShortcut.register(this.shortcutKeys.SwitchNextTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          this.switchToNextTab(focusedWindow.id)
        }
      })
    }

    // Ctrl+Shift+Tab 切换到上一个标签页
    if (this.shortcutKeys.SwitchPrevTab) {
      globalShortcut.register(this.shortcutKeys.SwitchPrevTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          this.switchToPreviousTab(focusedWindow.id)
        }
      })
    }

    // 注册标签页数字快捷键 (1-8)
    for (let i = 1; i <= 8; i++) {
      globalShortcut.register(`${CommandKey}+${i}`, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          this.switchToTabByIndex(focusedWindow.id, i - 1) // 索引从0开始
        }
      })
    }

    // Command+9 或 Ctrl+9 切换到最后一个标签页
    if (this.shortcutKeys.SwtichToLastTab) {
      globalShortcut.register(this.shortcutKeys.SwtichToLastTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          this.switchToLastTab(focusedWindow.id)
        }
      })
    }

    this.showHideWindow()

    this.isActive = true
  }

  // 切换到下一个标签页
  private async switchToNextTab(windowId: number): Promise<void> {
    try {
      const tabsData = await presenter.tabPresenter.getWindowTabsData(windowId)
      if (!tabsData || tabsData.length <= 1) return // 只有一个或没有标签页时不执行切换

      // 找到当前活动标签的索引
      const activeTabIndex = tabsData.findIndex((tab) => tab.isActive)
      if (activeTabIndex === -1) return

      // 计算下一个标签页的索引（循环到第一个）
      const nextTabIndex = (activeTabIndex + 1) % tabsData.length

      // 切换到下一个标签页
      await presenter.tabPresenter.switchTab(tabsData[nextTabIndex].id)
    } catch (error) {
      console.error('Failed to switch to next tab:', error)
    }
  }

  // 切换到上一个标签页
  private async switchToPreviousTab(windowId: number): Promise<void> {
    try {
      const tabsData = await presenter.tabPresenter.getWindowTabsData(windowId)
      if (!tabsData || tabsData.length <= 1) return // 只有一个或没有标签页时不执行切换

      // 找到当前活动标签的索引
      const activeTabIndex = tabsData.findIndex((tab) => tab.isActive)
      if (activeTabIndex === -1) return

      // 计算上一个标签页的索引（循环到最后一个）
      const previousTabIndex = (activeTabIndex - 1 + tabsData.length) % tabsData.length

      // 切换到上一个标签页
      await presenter.tabPresenter.switchTab(tabsData[previousTabIndex].id)
    } catch (error) {
      console.error('Failed to switch to previous tab:', error)
    }
  }

  // 切换到指定索引的标签页
  private async switchToTabByIndex(windowId: number, index: number): Promise<void> {
    try {
      const tabsData = await presenter.tabPresenter.getWindowTabsData(windowId)
      if (!tabsData || index >= tabsData.length) return // 索引超出范围

      // 切换到指定索引的标签页
      await presenter.tabPresenter.switchTab(tabsData[index].id)
    } catch (error) {
      console.error(`Failed to switch to tab at index ${index}:`, error)
    }
  }

  // 切换到最后一个标签页
  private async switchToLastTab(windowId: number): Promise<void> {
    try {
      const tabsData = await presenter.tabPresenter.getWindowTabsData(windowId)
      if (!tabsData || tabsData.length === 0) return

      // 切换到最后一个标签页
      await presenter.tabPresenter.switchTab(tabsData[tabsData.length - 1].id)
    } catch (error) {
      console.error('Failed to switch to last tab:', error)
    }
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
