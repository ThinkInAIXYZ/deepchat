import { BrowserWindow, WebContents, screen, webContents } from 'electron'
import type { Rectangle } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { YO_BROWSER_EVENTS } from '@/events'
import { BrowserTabInfo, BrowserContextSnapshot, ScreenshotOptions } from '@shared/types/browser'
import {
  IYoBrowserPresenter,
  DownloadInfo,
  IWindowPresenter,
  ITabPresenter
} from '@shared/presenter'
import { BrowserTab } from './BrowserTab'
import { CDPManager } from './CDPManager'
import { ScreenshotManager } from './ScreenshotManager'
import { DownloadManager } from './DownloadManager'
import { clearYoBrowserSessionData } from './yoBrowserSession'
import { YoBrowserToolHandler } from './YoBrowserToolHandler'

const resolveAfter = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export class YoBrowserPresenter implements IYoBrowserPresenter {
  private windowId: number | null = null
  private browserTab: BrowserTab | null = null
  private activeTabId: string | null = null
  private readonly cdpManager = new CDPManager()
  private readonly screenshotManager = new ScreenshotManager(this.cdpManager)
  private readonly downloadManager = new DownloadManager()
  private readonly windowPresenter: IWindowPresenter
  private detachWebContentsListeners: (() => void) | null = null
  readonly toolHandler: YoBrowserToolHandler

  constructor(windowPresenter: IWindowPresenter, _tabPresenter: ITabPresenter) {
    this.windowPresenter = windowPresenter
    this.toolHandler = new YoBrowserToolHandler(this)
  }

  async initialize(): Promise<void> {
    // Lazy initialization: only create browser window when explicitly requested.
  }

  async ensureWindow(options?: { x?: number; y?: number }): Promise<number | null> {
    const existing = this.getWindow()
    if (existing) {
      this.ensureBrowserTab(existing)
      return existing.id
    }

    const createBrowserWindow = (this.windowPresenter as any).createBrowserWindow
    if (typeof createBrowserWindow !== 'function') {
      return null
    }

    this.windowId = await createBrowserWindow.call(this.windowPresenter, {
      x: options?.x,
      y: options?.y,
      initialUrl: 'about:blank',
      autoShow: false
    })

    const window = this.getWindow()
    if (!window) {
      return null
    }

    window.on('closed', () => this.handleWindowClosed())
    this.ensureBrowserTab(window)
    this.emitVisibility(window.isVisible())

    return window.id
  }

  async hasWindow(): Promise<boolean> {
    return this.windowId !== null && this.getWindow() !== null
  }

  async show(shouldFocus: boolean = true): Promise<void> {
    const existingWindow = this.getWindow()
    const referenceBounds = existingWindow
      ? this.getReferenceBounds(existingWindow.id)
      : this.getReferenceBounds()

    let initialPosition: { x: number; y: number } | undefined
    if (!existingWindow && referenceBounds) {
      const defaultBounds: Rectangle = {
        x: 0,
        y: 0,
        width: 600,
        height: 620
      }
      initialPosition = this.calculateWindowPosition(defaultBounds, referenceBounds)
    }

    await this.ensureWindow({
      x: initialPosition?.x,
      y: initialPosition?.y
    })

    const window = this.getWindow()
    if (!window || window.isDestroyed()) {
      return
    }

    if (existingWindow) {
      const currentReferenceBounds = this.getReferenceBounds(window.id)
      const position = this.calculateWindowPosition(window.getBounds(), currentReferenceBounds)
      window.setPosition(position.x, position.y)
    }

    this.windowPresenter.show(window.id, shouldFocus)
    this.emitVisibility(true)
  }

  async hide(): Promise<void> {
    const window = this.getWindow()
    if (!window) {
      return
    }

    this.windowPresenter.hide(window.id)
    this.emitVisibility(false)
  }

  async toggleVisibility(): Promise<boolean> {
    await this.ensureWindow()
    const window = this.getWindow()
    if (!window) {
      return false
    }

    if (window.isVisible()) {
      await this.hide()
      return false
    }

    await this.show()
    return true
  }

  async isVisible(): Promise<boolean> {
    const window = this.getWindow()
    return Boolean(window?.isVisible())
  }

  async listTabs(): Promise<BrowserTabInfo[]> {
    const tab = await this.getBrowserTab()
    if (!tab) {
      return []
    }
    return [this.toTabInfo(tab)]
  }

  async getActiveTab(): Promise<BrowserTabInfo | null> {
    const tab = await this.getBrowserTab()
    return tab ? this.toTabInfo(tab) : null
  }

  async getTabById(tabId: string): Promise<BrowserTabInfo | null> {
    const tab = await this.getBrowserTab(tabId)
    return tab ? this.toTabInfo(tab) : null
  }

  async goBack(_tabId?: string): Promise<void> {
    const tab = await this.resolveTab(undefined, 1000)
    if (tab?.contents.canGoBack()) {
      tab.contents.goBack()
    }
  }

  async goForward(_tabId?: string): Promise<void> {
    const tab = await this.resolveTab(undefined, 1000)
    if (tab?.contents.canGoForward()) {
      tab.contents.goForward()
    }
  }

  async reload(_tabId?: string): Promise<void> {
    const tab = await this.resolveTab(undefined, 1000)
    if (tab && !tab.contents.isDestroyed()) {
      tab.contents.reload()
    }
  }

  async createTab(url?: string): Promise<BrowserTabInfo | null> {
    await this.ensureWindow()
    const tab = await this.resolveTab(undefined, 3000)
    if (!tab) {
      return null
    }

    if (url && url.trim()) {
      await tab.navigate(url)
      this.emitTabNavigated(tab.tabId, url)
    }

    this.activeTabId = tab.tabId
    this.emitTabActivated(tab.tabId)
    this.emitTabUpdated(tab)

    return this.toTabInfo(tab)
  }

  async navigateTab(tabId: string, url: string, timeoutMs?: number): Promise<void> {
    const tab = (await this.resolveTab(tabId, 3000)) ?? (await this.resolveTab(undefined, 3000))
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`)
    }

    await tab.navigate(url, timeoutMs)
    this.activeTabId = tab.tabId
    this.emitTabNavigated(tab.tabId, url)
    this.emitTabUpdated(tab)
  }

  async activateTab(tabId: string): Promise<void> {
    const tab = (await this.resolveTab(tabId, 2000)) ?? (await this.resolveTab(undefined, 2000))
    if (!tab) {
      return
    }

    this.activeTabId = tab.tabId
    await this.show(true)
    this.emitTabActivated(tab.tabId)
  }

  async closeTab(tabId: string): Promise<void> {
    if (!this.browserTab || this.browserTab.tabId !== tabId) {
      return
    }

    if (this.windowId) {
      await this.windowPresenter.closeWindow(this.windowId, true)
    }

    this.cleanup()
    this.emitTabClosed(tabId)
    this.emitTabCount()
    this.emitVisibility(false)
  }

  async reuseTab(url: string): Promise<BrowserTabInfo | null> {
    return await this.createTab(url)
  }

  async getBrowserContext(): Promise<BrowserContextSnapshot> {
    const tabs = await this.listTabs()
    return {
      activeTabId: this.activeTabId,
      tabs,
      currentPage: tabs[0] ?? null
    }
  }

  async getNavigationState(_tabId?: string): Promise<{
    canGoBack: boolean
    canGoForward: boolean
  }> {
    const tab = await this.resolveTab(undefined, 1000)
    if (!tab || tab.contents.isDestroyed()) {
      return { canGoBack: false, canGoForward: false }
    }

    return {
      canGoBack: tab.contents.canGoBack(),
      canGoForward: tab.contents.canGoForward()
    }
  }

  async getTabIdByViewId(viewId: number): Promise<string | null> {
    const tab = await this.resolveTab(undefined, 500)
    if (!tab || tab.contents.id !== viewId) {
      return null
    }

    return tab.tabId
  }

  async captureScreenshot(tabId: string, options?: ScreenshotOptions): Promise<string> {
    const tab = await this.resolveTab(tabId)
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`)
    }

    return await tab.takeScreenshot(options)
  }

  async extractDom(tabId: string, selector?: string): Promise<string> {
    const tab = await this.resolveTab(tabId)
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`)
    }

    return await tab.extractDOM(selector)
  }

  async evaluateScript(tabId: string, script: string): Promise<unknown> {
    const tab = await this.resolveTab(tabId)
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`)
    }

    return await tab.evaluateScript(script)
  }

  async startDownload(url: string, savePath?: string): Promise<DownloadInfo> {
    const active = await this.resolveTab(undefined, 2000)
    if (active?.contents?.isDestroyed()) {
      throw new Error('Active page is destroyed')
    }

    return await this.downloadManager.downloadFile(url, savePath, active?.contents)
  }

  async clearSandboxData(): Promise<void> {
    await clearYoBrowserSessionData()
    if (this.browserTab && !this.browserTab.contents.isDestroyed()) {
      this.browserTab.contents.reloadIgnoringCache()
    }
  }

  async shutdown(): Promise<void> {
    if (this.windowId) {
      await this.windowPresenter.closeWindow(this.windowId, true)
    }
    this.cleanup()
    this.emitTabCount()
    this.emitVisibility(false)
  }

  async getBrowserTab(tabId?: string): Promise<BrowserTab | null> {
    return await this.resolveTab(tabId)
  }

  async registerBrowserWebContents(webContentsId: number): Promise<boolean> {
    const window = this.getWindow()
    if (!window) {
      return false
    }

    const contents = webContents.fromId(webContentsId)
    if (!contents || contents.isDestroyed()) {
      return false
    }

    const hostContents = contents.hostWebContents ?? contents
    const ownerWindow = BrowserWindow.fromWebContents(hostContents)
    if (!ownerWindow || ownerWindow.id !== window.id) {
      return false
    }

    this.attachBrowserContents(contents)
    return true
  }

  async unregisterBrowserWebContents(webContentsId: number): Promise<void> {
    if (!this.browserTab || this.browserTab.contents.isDestroyed()) {
      return
    }

    if (this.browserTab.contents.id !== webContentsId) {
      return
    }

    const closedTabId = this.browserTab.tabId
    this.detachWebContentsListeners?.()
    this.detachWebContentsListeners = null
    this.browserTab.destroy()
    this.browserTab = null
    this.activeTabId = null
    this.emitTabClosed(closedTabId)
    this.emitTabCount()
  }

  private ensureBrowserTab(window: BrowserWindow): void {
    if (this.browserTab && !this.browserTab.contents.isDestroyed()) {
      const hostContents = this.browserTab.contents.hostWebContents ?? this.browserTab.contents
      const ownerWindow = BrowserWindow.fromWebContents(hostContents)
      if (ownerWindow && ownerWindow.id === window.id) {
        return
      }
    }

    if (this.isBrowserHostUrl(window.webContents.getURL())) {
      return
    }

    this.attachBrowserContents(window.webContents)
  }

  private attachBrowserContents(contents: WebContents): void {
    if (contents.isDestroyed()) {
      return
    }

    if (
      this.browserTab &&
      !this.browserTab.contents.isDestroyed() &&
      this.browserTab.contents.id === contents.id
    ) {
      this.activeTabId = this.browserTab.tabId
      this.emitTabUpdated(this.browserTab)
      return
    }

    this.detachWebContentsListeners?.()
    this.detachWebContentsListeners = null

    this.browserTab?.destroy()
    this.browserTab = new BrowserTab(contents, this.cdpManager, this.screenshotManager)
    this.activeTabId = this.browserTab.tabId
    this.bindWebContentsListeners(contents, this.browserTab.tabId)
    this.emitTabCreated(this.browserTab)
    this.emitTabActivated(this.browserTab.tabId)
    this.emitTabUpdated(this.browserTab)
    this.emitTabCount()
  }

  private bindWebContentsListeners(contents: WebContents, tabId: string): void {
    this.detachWebContentsListeners?.()

    const handleDidNavigate = (_event: unknown, url: string) => {
      const tab = this.browserTab
      if (!tab || tab.tabId !== tabId) {
        return
      }
      tab.url = url
      tab.updatedAt = Date.now()
      this.emitTabNavigated(tab.tabId, url)
      this.emitTabUpdated(tab)
    }

    const handleTitleUpdated = (_event: unknown, title: string) => {
      const tab = this.browserTab
      if (!tab || tab.tabId !== tabId) {
        return
      }
      tab.title = title || tab.url
      tab.updatedAt = Date.now()
      this.emitTabUpdated(tab)
    }

    const handleFaviconUpdated = (_event: unknown, favicons: string[]) => {
      const tab = this.browserTab
      if (!tab || tab.tabId !== tabId) {
        return
      }
      const nextFavicon = favicons[0]
      if (!nextFavicon || tab.favicon === nextFavicon) {
        return
      }
      tab.favicon = nextFavicon
      tab.updatedAt = Date.now()
      this.emitTabUpdated(tab)
    }

    const handleDestroyed = () => {
      if (!this.browserTab || this.browserTab.tabId !== tabId) {
        return
      }

      this.detachWebContentsListeners?.()
      this.detachWebContentsListeners = null

      this.browserTab = null
      this.activeTabId = null
      this.emitTabClosed(tabId)
      this.emitTabCount()
    }

    contents.on('did-navigate', handleDidNavigate)
    contents.on('did-navigate-in-page', handleDidNavigate)
    contents.on('page-title-updated', handleTitleUpdated)
    contents.on('page-favicon-updated', handleFaviconUpdated)
    contents.on('destroyed', handleDestroyed)

    this.detachWebContentsListeners = () => {
      contents.removeListener('did-navigate', handleDidNavigate)
      contents.removeListener('did-navigate-in-page', handleDidNavigate)
      contents.removeListener('page-title-updated', handleTitleUpdated)
      contents.removeListener('page-favicon-updated', handleFaviconUpdated)
      contents.removeListener('destroyed', handleDestroyed)
    }
  }

  private async resolveTab(tabId?: string, waitMs: number = 0): Promise<BrowserTab | null> {
    const deadline = Date.now() + waitMs

    while (true) {
      const window = this.getWindow()
      if (window) {
        this.ensureBrowserTab(window)
      }

      const tab = this.browserTab
      if (tab && !tab.contents.isDestroyed() && (!tabId || tab.tabId === tabId)) {
        return tab
      }

      if (Date.now() >= deadline) {
        return null
      }

      await resolveAfter(50)
    }
  }

  private getWindow(): BrowserWindow | null {
    if (!this.windowId) {
      return null
    }

    const window = BrowserWindow.fromId(this.windowId)
    if (!window || window.isDestroyed()) {
      this.windowId = null
      return null
    }

    return window
  }

  private isBrowserHostUrl(url: string): boolean {
    if (!url) {
      return false
    }

    if (url === 'about:blank') {
      return false
    }

    return url.includes('#/browser')
  }

  private getReferenceBounds(excludeWindowId?: number): Rectangle | undefined {
    const focused = this.windowPresenter.getFocusedWindow()
    if (focused && !focused.isDestroyed() && focused.id !== excludeWindowId) {
      return focused.getBounds()
    }

    const fallback = this.windowPresenter
      .getAllWindows()
      .find((candidate) => candidate.id !== excludeWindowId)

    return fallback?.getBounds()
  }

  private calculateWindowPosition(
    windowBounds: Rectangle,
    referenceBounds?: Rectangle
  ): { x: number; y: number } {
    if (!referenceBounds) {
      const display = screen.getDisplayMatching(windowBounds)
      const { workArea } = display
      return {
        x: workArea.x + workArea.width - windowBounds.width - 20,
        y: workArea.y + (workArea.height - windowBounds.height) / 2
      }
    }

    const gap = 20
    const display = screen.getDisplayMatching(referenceBounds)
    const { workArea } = display

    const browserWidth = windowBounds.width
    const browserHeight = windowBounds.height

    const spaceOnRight = workArea.x + workArea.width - (referenceBounds.x + referenceBounds.width)
    const spaceOnLeft = referenceBounds.x - workArea.x

    let targetX: number
    let targetY: number

    if (spaceOnRight >= browserWidth + gap) {
      targetX = referenceBounds.x + referenceBounds.width + gap
      targetY = referenceBounds.y + (referenceBounds.height - browserHeight) / 2
    } else if (spaceOnLeft >= browserWidth + gap) {
      targetX = referenceBounds.x - browserWidth - gap
      targetY = referenceBounds.y + (referenceBounds.height - browserHeight) / 2
    } else {
      targetX = referenceBounds.x
      const spaceBelow = workArea.y + workArea.height - (referenceBounds.y + referenceBounds.height)
      if (spaceBelow >= browserHeight + gap) {
        targetY = referenceBounds.y + referenceBounds.height + gap
      } else {
        targetY = referenceBounds.y - browserHeight - gap
      }
    }

    const clampedX = Math.max(
      workArea.x,
      Math.min(targetX, workArea.x + workArea.width - browserWidth)
    )
    const clampedY = Math.max(
      workArea.y,
      Math.min(targetY, workArea.y + workArea.height - browserHeight)
    )

    return { x: Math.round(clampedX), y: Math.round(clampedY) }
  }

  private handleWindowClosed(): void {
    this.cleanup()
    this.emitVisibility(false)
    this.emitTabCount()
  }

  private toTabInfo(tab: BrowserTab): BrowserTabInfo {
    return {
      id: tab.tabId,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      isActive: tab.tabId === this.activeTabId,
      status: tab.status,
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt
    }
  }

  private emitTabCreated(tab: BrowserTab) {
    eventBus.sendToRenderer(
      YO_BROWSER_EVENTS.TAB_CREATED,
      SendTarget.ALL_WINDOWS,
      this.toTabInfo(tab)
    )
  }

  private emitTabClosed(tabId: string) {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.TAB_CLOSED, SendTarget.ALL_WINDOWS, tabId)
  }

  private emitTabActivated(tabId: string) {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.TAB_ACTIVATED, SendTarget.ALL_WINDOWS, tabId)
  }

  private emitTabNavigated(tabId: string, url: string) {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.TAB_NAVIGATED, SendTarget.ALL_WINDOWS, {
      tabId,
      url
    })
  }

  private emitTabUpdated(tab: BrowserTab) {
    eventBus.sendToRenderer(
      YO_BROWSER_EVENTS.TAB_UPDATED,
      SendTarget.ALL_WINDOWS,
      this.toTabInfo(tab)
    )
  }

  private emitTabCount() {
    eventBus.sendToRenderer(
      YO_BROWSER_EVENTS.TAB_COUNT_CHANGED,
      SendTarget.ALL_WINDOWS,
      this.browserTab ? 1 : 0
    )
  }

  private emitVisibility(visible: boolean) {
    eventBus.sendToRenderer(
      YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED,
      SendTarget.ALL_WINDOWS,
      visible
    )
  }

  private cleanup() {
    this.detachWebContentsListeners?.()
    this.detachWebContentsListeners = null
    this.browserTab?.destroy()
    this.browserTab = null
    this.activeTabId = null
    this.windowId = null
  }
}
