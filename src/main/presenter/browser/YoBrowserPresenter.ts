import { BrowserWindow, WebContents, screen } from 'electron'
import type { Rectangle } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { TAB_EVENTS, YO_BROWSER_EVENTS } from '@/events'
import { BrowserTabInfo, BrowserContextSnapshot, ScreenshotOptions } from '@shared/types/browser'
import {
  IYoBrowserPresenter,
  MCPToolDefinition,
  DownloadInfo,
  IWindowPresenter,
  ITabPresenter
} from '@shared/presenter'
import { BrowserTab } from './BrowserTab'
import { CDPManager } from './CDPManager'
import { ScreenshotManager } from './ScreenshotManager'
import { DownloadManager } from './DownloadManager'
import { BrowserToolManager } from './BrowserToolManager'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { clearYoBrowserSessionData } from './yoBrowserSession'

export class YoBrowserPresenter implements IYoBrowserPresenter {
  private windowId: number | null = null
  private readonly tabIds: Map<string, number> = new Map()
  private readonly viewIdToTabId: Map<number, string> = new Map()
  private readonly tabIdToBrowserTab: Map<string, BrowserTab> = new Map()
  private activeTabId: string | null = null
  private readonly maxTabs = 5
  private readonly cdpManager = new CDPManager()
  private readonly screenshotManager = new ScreenshotManager(this.cdpManager)
  private readonly downloadManager = new DownloadManager()
  private readonly browserToolManager: BrowserToolManager
  private readonly windowPresenter: IWindowPresenter
  private readonly tabPresenter: ITabPresenter

  constructor(windowPresenter: IWindowPresenter, tabPresenter: ITabPresenter) {
    this.windowPresenter = windowPresenter
    this.tabPresenter = tabPresenter
    this.browserToolManager = new BrowserToolManager(this)
    eventBus.on(TAB_EVENTS.CLOSED, (tabId: number) => this.handleTabClosed(tabId))
  }

  async initialize(): Promise<void> {
    // Lazy initialization: only create browser window/tabs when explicitly requested.
  }

  async ensureWindow(options?: { x?: number; y?: number }): Promise<number | null> {
    const window = this.getWindow()
    if (window) return window.id

    this.windowId = await this.windowPresenter.createShellWindow({
      windowType: 'browser',
      x: options?.x,
      y: options?.y
    })

    const created = this.getWindow()
    if (created) {
      created.on('closed', () => this.handleWindowClosed())
      this.emitVisibility(created.isVisible())
    }

    return this.windowId
  }

  async hasWindow(): Promise<boolean> {
    return this.windowId !== null && this.getWindow() !== null
  }

  async show(shouldFocus: boolean = true): Promise<void> {
    const existingWindow = this.getWindow()
    const referenceBounds = existingWindow
      ? this.getReferenceBounds(existingWindow.id)
      : this.getReferenceBounds()

    // Calculate position before creating window if it doesn't exist
    let initialPosition: { x: number; y: number } | undefined
    if (!existingWindow && referenceBounds) {
      // Use default window size for calculation (browser window is 600px wide)
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

    if (this.tabIdToBrowserTab.size === 0) {
      await this.createTab('about:blank')
    }

    const window = this.getWindow()
    if (window && !window.isDestroyed()) {
      // If window already existed, recalculate position based on actual bounds
      if (existingWindow) {
        const currentReferenceBounds = this.getReferenceBounds(window.id)
        const position = this.calculateWindowPosition(window.getBounds(), currentReferenceBounds)
        window.setPosition(position.x, position.y)
      }

      // For existing windows, directly show them (they're already ready)
      // For new windows, wait for ready-to-show event
      if (existingWindow) {
        // Window already exists, just show it directly
        this.windowPresenter.show(window.id, shouldFocus)
        this.emitVisibility(true)
      } else {
        // New window, wait for ready-to-show
        const reveal = () => {
          if (!window.isDestroyed()) {
            this.windowPresenter.show(window.id, shouldFocus)
            this.emitVisibility(true)
          }
        }
        if (window.isVisible()) {
          reveal()
        } else {
          window.once('ready-to-show', reveal)
        }
      }
    }
  }

  async hide(): Promise<void> {
    const window = this.getWindow()
    if (window) {
      this.windowPresenter.hide(window.id)
      this.emitVisibility(false)
    }
  }

  async toggleVisibility(): Promise<boolean> {
    await this.ensureWindow()
    const window = this.getWindow()
    if (!window) return false
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
    await this.syncActiveTabId()
    return Array.from(this.tabIdToBrowserTab.values()).map((tab) => this.toTabInfo(tab))
  }

  async getActiveTab(): Promise<BrowserTabInfo | null> {
    await this.syncActiveTabId()
    if (!this.activeTabId) return null
    const tab = this.tabIdToBrowserTab.get(this.activeTabId)
    const result = tab ? this.toTabInfo(tab) : null
    return result
  }

  async getTabById(tabId: string): Promise<BrowserTabInfo | null> {
    const tab = this.tabIdToBrowserTab.get(tabId)
    if (!tab || tab.contents.isDestroyed()) return null
    return this.toTabInfo(tab)
  }

  async getBrowserTab(tabId?: string): Promise<BrowserTab | null> {
    return await this.resolveTab(tabId)
  }

  async goBack(tabId?: string): Promise<void> {
    const tab = await this.resolveTab(tabId)
    if (tab?.contents.canGoBack()) {
      tab.contents.goBack()
    }
  }

  async goForward(tabId?: string): Promise<void> {
    const tab = await this.resolveTab(tabId)
    if (tab?.contents.canGoForward()) {
      tab.contents.goForward()
    }
  }

  async reload(tabId?: string): Promise<void> {
    const tab = await this.resolveTab(tabId)
    if (tab && !tab.contents.isDestroyed()) {
      tab.contents.reload()
    }
  }

  async createTab(url?: string): Promise<BrowserTabInfo | null> {
    await this.ensureWindow()
    const windowId = this.windowId
    if (!windowId) return null

    if (this.tabIdToBrowserTab.size >= this.maxTabs) {
      const reusable = this.findReusableTab(url || '')
      if (reusable) {
        await reusable.navigate(url || reusable.url)
        await this.activateTab(reusable.tabId)
        return this.toTabInfo(reusable)
      }

      const oldest = this.findOldestTab()
      if (oldest) {
        await this.closeTab(oldest.tabId)
      }
    }

    const targetUrl = url || 'about:blank'
    const viewId = await this.tabPresenter.createTab(windowId, targetUrl, { active: true })
    if (viewId === null) return null
    const view = await this.tabPresenter.getTab(viewId as number)
    if (!view) return null

    const browserTab = new BrowserTab(view.webContents, this.cdpManager, this.screenshotManager)
    const tabKey = browserTab.tabId
    this.tabIds.set(tabKey, viewId as number)
    this.viewIdToTabId.set(view.webContents.id, tabKey)
    this.tabIdToBrowserTab.set(tabKey, browserTab)
    this.tabPresenter.setTabBrowserId(viewId as number, tabKey)
    this.activeTabId = tabKey

    this.setupTabListeners(tabKey, viewId as number, view.webContents)
    this.emitTabCreated(browserTab)
    this.emitTabCount()

    const result = this.toTabInfo(browserTab)
    return result
  }

  async navigateTab(tabId: string, url: string, timeoutMs?: number): Promise<void> {
    let tab = this.tabIdToBrowserTab.get(tabId)
    if (!tab || tab.contents.isDestroyed()) {
      const created = await this.createTab(url)
      if (!created) {
        throw new Error('Failed to create tab for navigation')
      }
      tab = this.tabIdToBrowserTab.get(created.id) ?? undefined
      this.activeTabId = created.id
    }
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`)
    }
    if (tab.contents.isDestroyed()) {
      throw new Error(`Tab ${tab.tabId} is destroyed`)
    }
    await tab.navigate(url, timeoutMs)
    this.emitTabNavigated(tab.tabId, url)
  }

  async activateTab(tabId: string): Promise<void> {
    const viewId = this.tabIds.get(tabId)
    if (viewId === undefined) return
    await this.tabPresenter.switchTab(viewId)
    this.activeTabId = tabId
    this.emitTabActivated(tabId)
  }

  async closeTab(tabId: string): Promise<void> {
    const viewId = this.tabIds.get(tabId)
    if (viewId !== undefined) {
      await this.tabPresenter.closeTab(viewId)
    }
    this.cleanupTab(tabId)
  }

  async reuseTab(url: string): Promise<BrowserTabInfo | null> {
    const reusable = this.findReusableTab(url)
    if (reusable) {
      await reusable.navigate(url)
      await this.activateTab(reusable.tabId)
      return this.toTabInfo(reusable)
    }

    if (this.tabIdToBrowserTab.size >= this.maxTabs) {
      const oldest = this.findOldestTab()
      if (oldest) {
        await this.closeTab(oldest.tabId)
        return this.createTab(url)
      }
    }

    return await this.createTab(url)
  }

  async getBrowserContext(): Promise<BrowserContextSnapshot> {
    return {
      activeTabId: this.activeTabId,
      tabs: await this.listTabs()
    }
  }

  async getNavigationState(tabId?: string): Promise<{
    canGoBack: boolean
    canGoForward: boolean
  }> {
    const tab = await this.resolveTab(tabId)
    if (!tab || tab.contents.isDestroyed()) {
      return { canGoBack: false, canGoForward: false }
    }
    return {
      canGoBack: tab.contents.canGoBack(),
      canGoForward: tab.contents.canGoForward()
    }
  }

  async getTabIdByViewId(viewId: number): Promise<string | null> {
    return this.viewIdToTabId.get(viewId) ?? null
  }

  async getToolDefinitions(_supportsVision: boolean): Promise<MCPToolDefinition[]> {
    // Only return browser_* tools from BrowserToolManager
    const browserTools = this.browserToolManager.getToolDefinitions()
    const browserMcpTools: MCPToolDefinition[] = browserTools.map((tool) => {
      const jsonSchema = zodToJsonSchema(tool.schema) as {
        type?: string
        properties?: Record<string, unknown>
        required?: string[]
        [key: string]: unknown
      }
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object' as const,
            properties: (jsonSchema.properties || {}) as Record<string, unknown>,
            required: (jsonSchema.required || []) as string[]
          }
        },
        server: {
          name: 'yo-browser',
          icons: '🌐',
          description: 'DeepChat built-in Yo Browser'
        }
      }
    })
    return browserMcpTools
  }

  async callTool(toolName: string, params: Record<string, unknown>): Promise<string> {
    const result = await this.browserToolManager.executeTool(toolName, params)
    const textParts = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
    const textContent = textParts.join('\n\n')
    if (result.isError) {
      throw new Error(textContent || 'Tool execution failed')
    }
    return textContent
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
    const active = await this.resolveTab()
    if (active?.contents?.isDestroyed()) {
      throw new Error('Active tab is destroyed')
    }
    return await this.downloadManager.downloadFile(url, savePath, active?.contents)
  }

  async clearSandboxData(): Promise<void> {
    await clearYoBrowserSessionData()
    for (const tab of this.tabIdToBrowserTab.values()) {
      if (!tab.contents.isDestroyed()) {
        tab.contents.reloadIgnoringCache()
      }
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

  private getWindow(): BrowserWindow | null {
    if (!this.windowId) return null
    const window = BrowserWindow.fromId(this.windowId)
    if (!window || window.isDestroyed()) {
      this.windowId = null
      return null
    }
    return window
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
      // 如果没有参考窗口，使用默认位置
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

    // Browser 窗口尺寸
    const browserWidth = windowBounds.width
    const browserHeight = windowBounds.height

    // 计算主窗口右侧和左侧的空间
    const spaceOnRight = workArea.x + workArea.width - (referenceBounds.x + referenceBounds.width)
    const spaceOnLeft = referenceBounds.x - workArea.x

    let targetX: number
    let targetY: number

    if (spaceOnRight >= browserWidth + gap) {
      // 显示在主窗口右侧
      targetX = referenceBounds.x + referenceBounds.width + gap
      targetY = referenceBounds.y + (referenceBounds.height - browserHeight) / 2
    } else if (spaceOnLeft >= browserWidth + gap) {
      // 显示在主窗口左侧
      targetX = referenceBounds.x - browserWidth - gap
      targetY = referenceBounds.y + (referenceBounds.height - browserHeight) / 2
    } else {
      // 空间不够，显示在主窗口下方
      targetX = referenceBounds.x
      const spaceBelow = workArea.y + workArea.height - (referenceBounds.y + referenceBounds.height)
      if (spaceBelow >= browserHeight + gap) {
        targetY = referenceBounds.y + referenceBounds.height + gap
      } else {
        // 下方空间也不够，显示在主窗口上方
        targetY = referenceBounds.y - browserHeight - gap
      }
    }

    // 确保窗口在屏幕范围内
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

  private setupTabListeners(tabId: string, viewId: number, contents: WebContents): void {
    contents.on('did-navigate', (_event, url) => {
      const tab = this.tabIdToBrowserTab.get(tabId)
      if (!tab) return
      tab.url = url
      tab.updatedAt = Date.now()
      this.emitTabNavigated(tabId, url)
    })

    contents.on('page-title-updated', (_event, title) => {
      const tab = this.tabIdToBrowserTab.get(tabId)
      if (!tab) return
      tab.title = title || tab.url
      tab.updatedAt = Date.now()
      this.emitTabUpdated(tab)
    })

    contents.on('page-favicon-updated', (_event, favicons) => {
      if (favicons.length > 0) {
        const tab = this.tabIdToBrowserTab.get(tabId)
        if (!tab) return
        if (tab.favicon !== favicons[0]) {
          tab.favicon = favicons[0]
          tab.updatedAt = Date.now()
          this.emitTabUpdated(tab)
        }
      }
    })

    contents.on('destroyed', () => {
      const mappedId = this.viewIdToTabId.get(viewId)
      if (mappedId) {
        this.cleanupTab(mappedId)
      }
    })
  }

  private findReusableTab(url: string): BrowserTab | null {
    if (!url) return this.findOldestTab()
    try {
      const targetHost = new URL(url).hostname
      const sameHost = Array.from(this.tabIdToBrowserTab.values()).find((tab) => {
        try {
          return new URL(tab.url).hostname === targetHost
        } catch {
          return false
        }
      })
      if (sameHost) return sameHost
    } catch {
      // ignore parse errors
    }
    return this.findOldestTab()
  }

  private findOldestTab(): BrowserTab | null {
    const sorted = Array.from(this.tabIdToBrowserTab.values()).sort(
      (a, b) => a.createdAt - b.createdAt
    )
    return sorted[0] || null
  }

  private async resolveTab(tabId?: string): Promise<BrowserTab | null> {
    if (tabId) {
      const target = this.tabIdToBrowserTab.get(tabId)
      if (target && !target.contents.isDestroyed()) return target
    }
    await this.syncActiveTabId()
    if (this.activeTabId) {
      const active = this.tabIdToBrowserTab.get(this.activeTabId)
      if (active && !active.contents.isDestroyed()) return active
    }
    const first = this.tabIdToBrowserTab.values().next().value as BrowserTab | undefined
    if (first && !first.contents.isDestroyed()) return first
    return null
  }

  private async syncActiveTabId(): Promise<void> {
    if (!this.windowId) return
    try {
      const activeViewId = await this.tabPresenter.getActiveTabId(this.windowId)
      if (activeViewId !== undefined) {
        const mapped = this.viewIdToTabId.get(activeViewId)
        if (mapped) {
          this.activeTabId = mapped
        }
      }
    } catch (error) {
      console.warn('[YoBrowser] Failed to sync active tab id', error)
    }
  }

  private handleTabClosed(tabId: number): void {
    const mapped = this.viewIdToTabId.get(tabId)
    if (mapped) {
      this.cleanupTab(mapped)
    }
  }

  private cleanupTab(tabId: string): void {
    if (!this.tabIdToBrowserTab.has(tabId)) {
      return
    }
    const browserTab = this.tabIdToBrowserTab.get(tabId)
    const viewId = this.tabIds.get(tabId)
    if (browserTab) {
      browserTab.destroy()
    }
    if (viewId !== undefined) {
      this.viewIdToTabId.delete(viewId)
    }
    this.tabIds.delete(tabId)
    this.tabIdToBrowserTab.delete(tabId)
    if (this.activeTabId === tabId) {
      const fallback = Array.from(this.tabIdToBrowserTab.keys()).find((id) => id !== tabId)
      this.activeTabId = fallback ?? null
    }
    this.emitTabClosed(tabId)
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
    const info = this.toTabInfo(tab)
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.TAB_CREATED, SendTarget.ALL_WINDOWS, info)
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
    const info = this.toTabInfo(tab)
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.TAB_UPDATED, SendTarget.ALL_WINDOWS, info)
  }

  private emitTabCount() {
    eventBus.sendToRenderer(
      YO_BROWSER_EVENTS.TAB_COUNT_CHANGED,
      SendTarget.ALL_WINDOWS,
      this.tabIdToBrowserTab.size
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
    for (const tab of this.tabIdToBrowserTab.values()) {
      tab.destroy()
    }
    this.tabIdToBrowserTab.clear()
    this.tabIds.clear()
    this.viewIdToTabId.clear()
    this.activeTabId = null
    this.windowId = null
  }
}
