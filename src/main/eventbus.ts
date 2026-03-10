import { IWindowPresenter, ITabPresenter } from '@shared/presenter'
import EventEmitter from 'events'

export enum SendTarget {
  ALL_WINDOWS = 'all_windows',
  DEFAULT_WINDOW = 'default_window',
  DEFAULT_TAB = 'default_tab'
}

export class EventBus extends EventEmitter {
  private windowPresenter: IWindowPresenter | null = null

  constructor() {
    super()
  }
  /**
   * 仅向主进程发送事件
   */
  sendToMain(eventName: string, ...args: unknown[]) {
    super.emit(eventName, ...args)
  }

  sendToWindow(eventName: string, windowId: number, ...args: unknown[]) {
    if (!this.windowPresenter) {
      console.warn('WindowPresenter not available, cannot send to window')
      return
    }
    this.windowPresenter.sendToWindow(windowId, eventName, ...args)
  }
  /**
   * 向渲染进程发送事件
   * @param eventName 事件名称
   * @param target 发送目标：所有窗口或默认窗口
   * @param args 事件参数
   */
  sendToRenderer(
    eventName: string,
    target: SendTarget = SendTarget.ALL_WINDOWS,
    ...args: unknown[]
  ) {
    if (!this.windowPresenter) {
      console.warn('WindowPresenter not available, cannot send to renderer')
      return
    }

    switch (target) {
      case SendTarget.ALL_WINDOWS:
        this.windowPresenter.sendToAllWindows(eventName, ...args)
        break
      case SendTarget.DEFAULT_WINDOW:
      case SendTarget.DEFAULT_TAB:
        if (typeof this.windowPresenter.sendToDefaultWindow === 'function') {
          this.windowPresenter.sendToDefaultWindow(eventName, true, ...args)
        } else {
          this.windowPresenter.sendToDefaultTab(eventName, true, ...args)
        }
        break
      default:
        this.windowPresenter.sendToAllWindows(eventName, ...args)
    }
  }

  /**
   * 同时发送到主进程和渲染进程
   * @param eventName 事件名称
   * @param target 发送目标
   * @param args 事件参数
   */
  send(eventName: string, target: SendTarget = SendTarget.ALL_WINDOWS, ...args: unknown[]) {
    // 发送到主进程
    this.sendToMain(eventName, ...args)

    // 发送到渲染进程
    this.sendToRenderer(eventName, target, ...args)
  }

  /**
   * 设置窗口展示器（用于向渲染进程发送消息）
   */
  setWindowPresenter(windowPresenter: IWindowPresenter) {
    this.windowPresenter = windowPresenter
  }

  /**
   * 设置Tab展示器（用于兼容旧的 BrowserView 路由）
   */
  setTabPresenter(_tabPresenter: ITabPresenter) {
    // Intentionally kept as a compatibility hook for legacy initialization paths.
  }

  /**
   * 向指定 webContents 发送事件
   * @param webContentsId webContents ID
   * @param eventName 事件名称
   * @param args 事件参数
   */
  sendToWebContents(webContentsId: number, eventName: string, ...args: unknown[]) {
    if (!this.windowPresenter) {
      console.warn('WindowPresenter not available, cannot send to specific webContents')
      return
    }

    this.windowPresenter
      .sendToWebContents(webContentsId, eventName, ...args)
      .then((sent) => {
        if (!sent) {
          console.warn(
            `webContents ${webContentsId} not found or destroyed, cannot send event ${eventName}`
          )
        }
      })
      .catch((error) => {
        console.error(`Error sending event ${eventName} to webContents ${webContentsId}:`, error)
      })
  }

  /**
   * Deprecated alias for webContents routing.
   * @param windowId 窗口ID
   * @param eventName 事件名称
   * @param args 事件参数
   */
  sendToActiveTab(windowId: number, eventName: string, ...args: unknown[]) {
    if (!this.windowPresenter) {
      console.warn('WindowPresenter not available, cannot send to active window content')
      return
    }

    this.windowPresenter
      .sendToActiveTab(windowId, eventName, ...args)
      .then((sent) => {
        if (!sent) {
          console.warn(`No active content found for window ${windowId}`)
        }
      })
      .catch((error) => {
        console.error(`Error getting active content for window ${windowId}:`, error)
      })
  }

  /**
   * 向多个 webContents 广播事件
   * @param webContentsIds webContents ID数组
   * @param eventName 事件名称
   * @param args 事件参数
   */
  broadcastToWebContents(webContentsIds: number[], eventName: string, ...args: unknown[]) {
    webContentsIds.forEach((webContentsId) =>
      this.sendToWebContents(webContentsId, eventName, ...args)
    )
  }

  sendToTab(tabId: number, eventName: string, ...args: unknown[]) {
    this.sendToWebContents(tabId, eventName, ...args)
  }

  broadcastToTabs(tabIds: number[], eventName: string, ...args: unknown[]) {
    this.broadcastToWebContents(tabIds, eventName, ...args)
  }
}

// 创建全局事件总线实例
export const eventBus = new EventBus()
