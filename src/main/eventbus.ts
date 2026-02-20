import { IWindowPresenter } from '@shared/presenter'
import { webContents } from 'electron'
import EventEmitter from 'events'

export enum SendTarget {
  ALL_WINDOWS = 'all_windows',
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
   * @param target 发送目标：所有窗口或默认标签页
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
      case SendTarget.DEFAULT_TAB:
        this.windowPresenter.sendToDefaultTab(eventName, true, ...args)
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
   * 向指定Tab发送事件
   * @param tabId Tab ID
   * @param eventName 事件名称
   * @param args 事件参数
   */
  sendToTab(tabId: number, eventName: string, ...args: unknown[]) {
    const target = webContents.fromId(tabId)
    if (!target || target.isDestroyed()) {
      console.warn(`WebContents ${tabId} not found or destroyed, cannot send ${eventName}`)
      return
    }
    target.send(eventName, ...args)
  }

  /**
   * 向指定窗口的活跃Tab发送事件
   * @param windowId 窗口ID
   * @param eventName 事件名称
   * @param args 事件参数
   */
  sendToActiveTab(windowId: number, eventName: string, ...args: unknown[]) {
    if (!this.windowPresenter) {
      console.warn('WindowPresenter not available, cannot send to active tab')
      return
    }
    const sent = this.windowPresenter.sendToWindow(windowId, eventName, ...args)
    if (!sent) {
      console.warn(`No active renderer found for window ${windowId}`)
    }
  }

  /**
   * 向多个Tab广播事件
   * @param tabIds Tab ID数组
   * @param eventName 事件名称
   * @param args 事件参数
   */
  broadcastToTabs(tabIds: number[], eventName: string, ...args: unknown[]) {
    tabIds.forEach((tabId) => this.sendToTab(tabId, eventName, ...args))
  }
}

// 创建全局事件总线实例
export const eventBus = new EventBus()
