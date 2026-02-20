/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow, type WebContents } from 'electron'
import { ITabPresenter, TabCreateOptions, IWindowPresenter, TabData } from '@shared/presenter'
import { eventBus } from '@/eventbus'
import { TAB_EVENTS, WINDOW_EVENTS } from '@/events'
import { addWatermarkToNativeImage } from '@/lib/watermark'
import { stitchImagesVertically } from '@/lib/scrollCapture'
import { join } from 'path'

type TabLike = {
  webContents: WebContents
  setVisible: (visible: boolean) => void
}

const toLocalUrl = (url: string): string => {
  if (url.startsWith('local://')) {
    return url
  }
  return 'local://chat'
}

export class TabPresenter implements ITabPresenter {
  private readonly windowPresenter: IWindowPresenter
  private readonly tabWindowMap = new Map<number, number>()
  private readonly floatingTabs = new Map<number, TabLike>()
  private readonly windowTypes = new Map<number, 'chat' | 'browser'>()

  constructor(windowPresenter: IWindowPresenter) {
    this.windowPresenter = windowPresenter

    eventBus.on(WINDOW_EVENTS.WINDOW_CLOSED, (windowId: number) => {
      const tabIds = Array.from(this.tabWindowMap.entries())
        .filter(([, mappedWindowId]) => mappedWindowId === windowId)
        .map(([tabId]) => tabId)

      for (const tabId of tabIds) {
        this.tabWindowMap.delete(tabId)
        eventBus.sendToMain(TAB_EVENTS.CLOSED, tabId)
      }

      this.windowTypes.delete(windowId)
    })
  }

  setWindowType(windowId: number, type: 'chat' | 'browser'): void {
    this.windowTypes.set(windowId, type)
  }

  getWindowType(windowId: number): 'chat' | 'browser' {
    return this.windowTypes.get(windowId) ?? 'chat'
  }

  updateChromeHeight(_windowId: number, _height: number): void {
    // Window-only architecture no longer needs chrome height for tab WebContentsView bounds.
  }

  async createTab(
    windowId: number,
    url: string,
    options: TabCreateOptions = {}
  ): Promise<number | null> {
    const isLocal = url.startsWith('local://')

    if (isLocal) {
      const createChatWindow = (this.windowPresenter as any).createChatWindow
      if (typeof createChatWindow === 'function') {
        const newWindowId = await createChatWindow.call(this.windowPresenter)
        if (typeof newWindowId === 'number') {
          const tabId = this.registerWindowTab(newWindowId)
          if (options.active !== false) {
            this.windowPresenter.show(newWindowId, true)
          }
          return tabId
        }
      }

      const fallbackTabId = this.registerWindowTab(windowId)
      if (options.active !== false) {
        this.windowPresenter.show(windowId, true)
      }
      return fallbackTabId
    }

    const targetWindow = BrowserWindow.fromId(windowId)
    if (targetWindow && !targetWindow.isDestroyed()) {
      await targetWindow.loadURL(url)
      const tabId = this.registerWindowTab(windowId)
      if (options.active !== false) {
        this.windowPresenter.show(windowId, true)
      }
      return tabId
    }

    const createBrowserWindow = (this.windowPresenter as any).createBrowserWindow
    if (typeof createBrowserWindow === 'function') {
      const newWindowId = await createBrowserWindow.call(this.windowPresenter, {
        initialUrl: url,
        autoShow: options.active !== false
      })
      if (typeof newWindowId === 'number') {
        return this.registerWindowTab(newWindowId)
      }
    }

    return null
  }

  async closeTab(tabId: number): Promise<boolean> {
    if (this.floatingTabs.has(tabId)) {
      this.floatingTabs.delete(tabId)
      this.tabWindowMap.delete(tabId)
      eventBus.sendToMain(TAB_EVENTS.CLOSED, tabId)
      return true
    }

    const windowId = this.getTabWindowId(tabId)
    if (windowId === undefined) {
      return false
    }

    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      this.tabWindowMap.delete(tabId)
      return false
    }

    window.close()
    return true
  }

  async closeTabs(windowId: number): Promise<void> {
    const tabId = this.getWindowTabId(windowId)
    if (tabId !== undefined) {
      await this.closeTab(tabId)
    }
  }

  async switchTab(tabId: number): Promise<boolean> {
    if (this.floatingTabs.has(tabId)) {
      return true
    }

    const windowId = this.getTabWindowId(tabId)
    if (windowId === undefined) {
      return false
    }

    this.windowPresenter.show(windowId, true)
    return true
  }

  async getTab(tabId: number): Promise<any> {
    const floating = this.floatingTabs.get(tabId)
    if (floating && !floating.webContents.isDestroyed()) {
      return floating as any
    }

    const windowId = this.getTabWindowId(tabId)
    if (windowId === undefined) {
      return undefined
    }

    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return undefined
    }

    return {
      webContents: window.webContents,
      setVisible: (_visible: boolean) => {
        // No-op in window-only mode.
      }
    } as TabLike
  }

  async detachTab(_tabId: number): Promise<boolean> {
    return false
  }

  async attachTab(_tabId: number, _targetWindowId: number, _index?: number): Promise<boolean> {
    return false
  }

  async moveTab(_tabId: number, _targetWindowId: number, _index?: number): Promise<boolean> {
    return false
  }

  async getWindowTabsData(windowId: number): Promise<Array<TabData>> {
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return []
    }

    const tabId = this.registerWindowTab(windowId)
    const title =
      window.webContents.getTitle() ||
      (this.getWindowType(windowId) === 'browser' ? 'Browser' : 'Chat')
    const currentUrl = window.webContents.getURL()
    const url = currentUrl || toLocalUrl(currentUrl)

    return [
      {
        id: tabId,
        title,
        isActive: true,
        position: 0,
        closable: true,
        url
      }
    ]
  }

  async getActiveTabId(windowId: number): Promise<number | undefined> {
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return undefined
    }

    return this.registerWindowTab(windowId)
  }

  getTabIdByWebContentsId(webContentsId: number): number | undefined {
    if (this.floatingTabs.has(webContentsId)) {
      return webContentsId
    }

    const maybeWindow = BrowserWindow.getAllWindows().find(
      (window) => !window.isDestroyed() && window.webContents.id === webContentsId
    )

    if (maybeWindow) {
      this.tabWindowMap.set(webContentsId, maybeWindow.id)
      if (!this.windowTypes.has(maybeWindow.id)) {
        this.windowTypes.set(maybeWindow.id, 'chat')
      }
      return webContentsId
    }

    return this.tabWindowMap.has(webContentsId) ? webContentsId : undefined
  }

  getWindowIdByWebContentsId(webContentsId: number): number | undefined {
    const tabId = this.getTabIdByWebContentsId(webContentsId)
    if (tabId !== undefined) {
      return this.tabWindowMap.get(tabId)
    }
    return undefined
  }

  getTabWindowId(tabId: number): number | undefined {
    if (this.floatingTabs.has(tabId)) {
      return undefined
    }

    const mapped = this.tabWindowMap.get(tabId)
    if (mapped !== undefined) {
      return mapped
    }

    const maybeWindow = BrowserWindow.getAllWindows().find(
      (window) => !window.isDestroyed() && window.webContents.id === tabId
    )

    if (!maybeWindow) {
      return undefined
    }

    this.tabWindowMap.set(tabId, maybeWindow.id)
    return maybeWindow.id
  }

  async reorderTabs(_windowId: number, _tabIds: number[]): Promise<boolean> {
    return false
  }

  async moveTabToNewWindow(tabId: number, screenX?: number, screenY?: number): Promise<boolean> {
    const windowId = this.getTabWindowId(tabId)
    if (windowId === undefined) {
      return false
    }

    const sourceWindow = BrowserWindow.fromId(windowId)
    if (!sourceWindow || sourceWindow.isDestroyed()) {
      return false
    }

    const createChatWindow = (this.windowPresenter as any).createChatWindow
    if (typeof createChatWindow !== 'function') {
      return false
    }

    const newWindowId = await createChatWindow.call(this.windowPresenter, {
      x: screenX,
      y: screenY
    })

    if (typeof newWindowId !== 'number') {
      return false
    }

    this.windowPresenter.show(newWindowId, true)
    return true
  }

  async captureTabArea(
    tabId: number,
    rect: { x: number; y: number; width: number; height: number }
  ): Promise<string | null> {
    const tab = await this.getTab(tabId)
    if (!tab || tab.webContents.isDestroyed()) {
      return null
    }

    try {
      const image = await tab.webContents.capturePage(rect)
      return image.toDataURL()
    } catch (error) {
      console.error(`captureTabArea failed for tab ${tabId}:`, error)
      return null
    }
  }

  async stitchImagesWithWatermark(
    imageDataList: string[],
    options?: {
      isDark?: boolean
      version?: string
      texts?: {
        brand?: string
        time?: string
        tip?: string
      }
    }
  ): Promise<string | null> {
    if (!Array.isArray(imageDataList) || imageDataList.length === 0) {
      return null
    }

    try {
      const imageBuffers = imageDataList.map((dataUrl) => {
        const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
        return Buffer.from(base64Data, 'base64')
      })
      const stitched = await stitchImagesVertically(imageBuffers)
      if (!stitched) {
        return null
      }
      const watermarked = await addWatermarkToNativeImage(stitched, {
        isDark: options?.isDark,
        version: options?.version,
        texts: options?.texts
      })
      return watermarked.toDataURL()
    } catch (error) {
      console.error('stitchImagesWithWatermark failed:', error)
      return null
    }
  }

  async onRendererTabReady(tabId: number): Promise<void> {
    eventBus.sendToMain(TAB_EVENTS.RENDERER_TAB_READY, tabId)
  }

  async onRendererTabActivated(threadId: string): Promise<void> {
    eventBus.sendToMain(TAB_EVENTS.RENDERER_TAB_ACTIVATED, threadId)
  }

  async isLastTabInWindow(tabId: number): Promise<boolean> {
    return this.getTabWindowId(tabId) !== undefined
  }

  registerFloatingWindow(webContentsId: number, floatingWebContents: Electron.WebContents): void {
    if (!floatingWebContents || floatingWebContents.isDestroyed()) {
      return
    }

    this.floatingTabs.set(webContentsId, {
      webContents: floatingWebContents,
      setVisible: (_visible: boolean) => {
        // No-op for floating window.
      }
    })
  }

  unregisterFloatingWindow(webContentsId: number): void {
    this.floatingTabs.delete(webContentsId)
    this.tabWindowMap.delete(webContentsId)
  }

  async resetTabToBlank(tabId: number): Promise<void> {
    const windowId = this.getTabWindowId(tabId)
    if (windowId === undefined) {
      return
    }

    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return
    }

    const kind = this.getWindowType(windowId)
    if (kind === 'browser') {
      await window.loadURL('about:blank')
      return
    }

    if (process.env['ELECTRON_RENDERER_URL']) {
      await window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/chat`)
    } else {
      await window.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/chat' })
    }
  }

  setTabBrowserId(_tabId: number, _browserTabId: string): void {
    // Browser tab mapping is no longer needed in window-only mode.
  }

  async destroy(): Promise<void> {
    this.tabWindowMap.clear()
    this.floatingTabs.clear()
    this.windowTypes.clear()
  }

  private registerWindowTab(windowId: number): number {
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return windowId
    }

    const tabId = window.webContents.id
    this.tabWindowMap.set(tabId, windowId)
    if (!this.windowTypes.has(windowId)) {
      this.windowTypes.set(windowId, this.inferWindowType(window))
    }

    return tabId
  }

  private getWindowTabId(windowId: number): number | undefined {
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return undefined
    }

    return this.registerWindowTab(windowId)
  }

  private inferWindowType(window: BrowserWindow): 'chat' | 'browser' {
    const url = window.webContents.getURL()
    if (!url) {
      return 'chat'
    }

    const isBrowser =
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('about:') ||
      url.startsWith('file://')

    return isBrowser ? 'browser' : 'chat'
  }
}
