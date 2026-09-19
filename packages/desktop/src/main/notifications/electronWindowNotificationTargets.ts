import { BrowserWindow, webContents as electronWebContents, type WebContents } from 'electron'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import {
  createDeepchatEventEnvelope,
  semanticNotificationEvent,
  type DeepchatEventName,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import type { ITabPresenter, IWindowPresenter } from '@shared/types/desktop'
import type { SemanticNotificationDelivery } from '@shared/notifications'
import type {
  NotificationWindowTarget,
  WindowNotificationTargetPort
} from './windowNotificationRouter'

type NotificationWindowPort = Pick<
  IWindowPresenter,
  'getAllWindows' | 'getFocusedWindow' | 'getSettingsWindowId' | 'sendToWebContents'
>

type NotificationTabPort = Pick<
  ITabPresenter,
  'getActiveTabId' | 'getTab' | 'getWindowIdByWebContentsId'
>

export class ElectronWindowNotificationTargets implements WindowNotificationTargetPort {
  private readonly readyWebContentsIds = new Set<number>()
  private readonly lifecycleCleanups = new Map<number, () => void>()

  constructor(
    private readonly windows: NotificationWindowPort,
    private readonly getTabs: () => NotificationTabPort | undefined,
    private readonly onRendererUnavailable: (webContentsId: number) => void = () => undefined
  ) {}

  async markRendererReady(webContentsId: number): Promise<boolean> {
    const target = await this.resolveExistingTargetByWebContents(webContentsId)
    if (!target) return false

    const contents = electronWebContents.fromId(webContentsId)
    if (!contents || contents.isDestroyed()) return false

    this.readyWebContentsIds.add(webContentsId)
    if (!this.lifecycleCleanups.has(webContentsId)) {
      const clearReadiness = () => {
        if (this.readyWebContentsIds.delete(webContentsId)) {
          try {
            this.onRendererUnavailable(webContentsId)
          } catch (error) {
            console.error('[NotificationTargets] renderer invalidation callback failed', error)
          }
        }
      }
      const handleNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
        if (details.isMainFrame && !details.isSameDocument) {
          clearReadiness()
        }
      }
      const handleRenderProcessGone = () => {
        clearReadiness()
      }
      const handleDestroyed = () => {
        clearReadiness()
        this.lifecycleCleanups.delete(webContentsId)
      }

      contents.on('did-start-navigation', handleNavigation)
      contents.on('render-process-gone', handleRenderProcessGone)
      contents.once('destroyed', handleDestroyed)
      this.lifecycleCleanups.set(webContentsId, () => {
        contents.removeListener('did-start-navigation', handleNavigation)
        contents.removeListener('render-process-gone', handleRenderProcessGone)
        contents.removeListener('destroyed', handleDestroyed)
      })
    }
    return true
  }

  async getTargetForWindow(windowId: number): Promise<NotificationWindowTarget | undefined> {
    const settingsWindowId = this.windows.getSettingsWindowId()
    if (settingsWindowId === windowId) {
      const settingsWindow = BrowserWindow.fromId(windowId)
      return settingsWindow && !settingsWindow.isDestroyed()
        ? this.createReadyTarget(settingsWindow.webContents, windowId, 'settings')
        : undefined
    }

    const window = this.windows.getAllWindows().find((candidate) => candidate.id === windowId)
    if (!window) return undefined

    const tabs = this.getTabs()
    if (!tabs) return undefined
    const activeTabId = await tabs.getActiveTabId(windowId)
    if (activeTabId !== undefined) {
      const activeTab = await tabs.getTab(activeTabId)
      if (!activeTab || tabs.getWindowIdByWebContentsId(activeTab.webContents.id) !== windowId) {
        return undefined
      }
      return this.createReadyTarget(activeTab.webContents, windowId, 'main')
    }
    return this.createReadyTarget(window.webContents, windowId, 'main')
  }

  async getTargetByWebContents(
    webContentsId: number
  ): Promise<NotificationWindowTarget | undefined> {
    if (!this.readyWebContentsIds.has(webContentsId)) return undefined
    return await this.resolveExistingTargetByWebContents(webContentsId)
  }

  async getFocusedTarget(): Promise<NotificationWindowTarget | undefined> {
    const focusedWindow = this.windows.getFocusedWindow()
    return focusedWindow ? await this.getTargetForWindow(focusedWindow.id) : undefined
  }

  async getExistingTargets(): Promise<readonly NotificationWindowTarget[]> {
    const windowIds = this.windows.getAllWindows().map((window) => window.id)
    const settingsWindowId = this.windows.getSettingsWindowId()
    if (settingsWindowId !== null) windowIds.push(settingsWindowId)

    const targets = await Promise.all(
      windowIds.map((windowId) => this.getTargetForWindow(windowId))
    )
    return targets.filter((target): target is NotificationWindowTarget => target !== undefined)
  }

  async send(
    target: NotificationWindowTarget,
    delivery: SemanticNotificationDelivery
  ): Promise<boolean> {
    return await this.sendDeepchatEvent(target, semanticNotificationEvent.name, delivery)
  }

  async sendDeepchatEvent<T extends DeepchatEventName>(
    target: NotificationWindowTarget,
    eventName: T,
    payload: DeepchatEventPayload<T>
  ): Promise<boolean> {
    const current = await this.getTargetByWebContents(target.webContentsId)
    if (!current || current.kind !== target.kind || current.windowId !== target.windowId) {
      return false
    }

    return await this.windows.sendToWebContents(
      target.webContentsId,
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope(eventName, payload)
    )
  }

  dispose(): void {
    for (const cleanup of this.lifecycleCleanups.values()) {
      cleanup()
    }
    this.lifecycleCleanups.clear()
    this.readyWebContentsIds.clear()
  }

  private createReadyTarget(
    contents: WebContents,
    windowId: number,
    kind: NotificationWindowTarget['kind']
  ): NotificationWindowTarget | undefined {
    if (contents.isDestroyed() || !this.readyWebContentsIds.has(contents.id)) {
      return undefined
    }
    return Object.freeze({
      windowId,
      webContentsId: contents.id,
      kind
    })
  }

  private async resolveExistingTargetByWebContents(
    webContentsId: number
  ): Promise<NotificationWindowTarget | undefined> {
    const contents = electronWebContents.fromId(webContentsId)
    if (!contents || contents.isDestroyed()) return undefined

    const settingsWindowId = this.windows.getSettingsWindowId()
    if (settingsWindowId !== null) {
      const settingsWindow = BrowserWindow.fromId(settingsWindowId)
      if (
        settingsWindow &&
        !settingsWindow.isDestroyed() &&
        settingsWindow.webContents.id === webContentsId
      ) {
        return Object.freeze({
          windowId: settingsWindowId,
          webContentsId,
          kind: 'settings'
        })
      }
    }

    const tabs = this.getTabs()
    const tabWindowId = tabs?.getWindowIdByWebContentsId(webContentsId)
    const owningWindowId = tabWindowId ?? BrowserWindow.fromWebContents(contents)?.id
    if (
      owningWindowId === undefined ||
      !this.windows.getAllWindows().some((window) => window.id === owningWindowId)
    ) {
      return undefined
    }

    return Object.freeze({
      windowId: owningWindowId,
      webContentsId,
      kind: 'main'
    })
  }
}
