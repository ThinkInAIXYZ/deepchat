import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type {
  BrowserImportApplyResult,
  BrowserImportPreview,
  BrowserImportScanResult,
  BrowserPageInfo,
  BrowserPreviewMode,
  BrowserPreviewModeResult,
  DownloadInfo,
  ScreenshotOptions,
  YoBrowserStatus
} from './browser'
import type { MCPToolDefinition } from './mcp'
import type { ProviderInstallPreview } from '@shared/providerDeeplink'
import type { SettingsNavigationPayload } from '@shared/settingsNavigation'

export interface TabData {
  id: number
  title: string
  isActive: boolean
  position: number
  closable: boolean
  url: string
  icon?: string
}

export interface FloatingChatWindowLike {
  isShowing(): boolean
  getWindow(): BrowserWindow | null
}

export interface IWindowPresenter {
  createAppWindow(options?: {
    initialRoute?: string
    x?: number
    y?: number
  }): Promise<number | null>
  createBrowserWindow(options?: { x?: number; y?: number }): Promise<number | null>
  createShellWindow(options?: {
    activateTabId?: number
    initialTab?: {
      url: string
      type?: string
      icon?: string
    }
    forMovedTab?: boolean
    windowType?: 'chat' | 'browser'
    x?: number
    y?: number
  }): Promise<number | null>
  mainWindow: BrowserWindow | undefined
  previewFile(filePath: string): void
  minimize(windowId: number): void
  maximize(windowId: number): void
  close(windowId: number): void
  createSettingsWindow(navigation?: SettingsNavigationPayload): Promise<number | null>
  closeSettingsWindow(): void
  getSettingsWindowId(): number | null
  focusMainWindow(): boolean
  restoreMainWindowHiddenByClose(): boolean
  clearMainWindowHiddenByClose(): void
  notifySettingsReady(senderWebContentsId: number): void
  setPendingSettingsProviderInstall(preview: ProviderInstallPreview): void
  consumePendingSettingsProviderInstall(): ProviderInstallPreview | null
  hide(windowId: number): void
  show(windowId?: number, shouldFocus?: boolean): void
  isMaximized(windowId: number): boolean
  isMainWindowFocused(windowId: number): boolean
  sendToAllWindows(channel: string, ...args: unknown[]): void
  sendSettingsNavigation(windowId: number, navigation: SettingsNavigationPayload): boolean
  sendSettingsCheckForUpdates(windowId: number): boolean
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): boolean
  sendToDefaultWindow(
    channel: string,
    switchToTarget?: boolean,
    ...args: unknown[]
  ): Promise<boolean>
  openOrFocusSettingsWindow(): Promise<void>
  sendToDefaultTab(channel: string, switchToTarget?: boolean, ...args: unknown[]): Promise<boolean>
  openOrFocusSettingsTab(windowId: number): Promise<void>
  closeWindow(windowId: number, forceClose?: boolean): Promise<void>
  isApplicationQuitting(): boolean
  setApplicationQuitting(isQuitting: boolean): void
  destroyFloatingChatWindow(): void
  isFloatingChatWindowVisible(): boolean
  getFloatingChatWindow(): FloatingChatWindowLike | null
  getFocusedWindow(): BrowserWindow | undefined
  toggleMainWindowVisibility(mustShow?: boolean): void
  sendToWebContents(webContentsId: number, channel: string, ...args: unknown[]): Promise<boolean>
  sendToActiveTab(windowId: number, channel: string, ...args: unknown[]): Promise<boolean>
  getAllWindows(): BrowserWindow[]
  toggleFloatingChatWindow(floatingButtonPosition?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void>
  createFloatingChatWindow(): Promise<void>
}

export type ShortcutKeySetting = Record<string, string>
export type ShortcutKey = string

export interface IYoBrowserPresenter {
  initialize(): Promise<void>
  getBrowserStatus(sessionId: string): Promise<YoBrowserStatus>
  loadUrl(
    sessionId: string,
    url: string,
    timeoutMs?: number,
    hostWindowId?: number
  ): Promise<YoBrowserStatus>
  attachSessionBrowser(sessionId: string, hostWindowId: number): Promise<boolean>
  updateSessionBrowserBounds(
    sessionId: string,
    hostWindowId: number,
    bounds: {
      x: number
      y: number
      width: number
      height: number
    },
    visible: boolean
  ): Promise<void>
  detachSessionBrowser(sessionId: string): Promise<void>
  setPreviewMode(
    sessionId: string,
    mode: BrowserPreviewMode,
    hostWindowId?: number,
    runId?: string
  ): Promise<BrowserPreviewModeResult>
  destroySessionBrowser(sessionId: string): Promise<void>
  goBack(sessionId: string): Promise<void>
  goForward(sessionId: string): Promise<void>
  reload(sessionId: string): Promise<void>
  getNavigationState(sessionId: string): Promise<{
    canGoBack: boolean
    canGoForward: boolean
  }>
  captureScreenshot(sessionId: string, options?: ScreenshotOptions): Promise<string>
  getBrowserPage(sessionId: string): Promise<BrowserPageInfo | null>
  startDownload(url: string, savePath?: string): Promise<DownloadInfo>
  clearSandboxData(): Promise<void>
  scanImportSources(): Promise<BrowserImportScanResult>
  previewImport(profileId: string): Promise<BrowserImportPreview>
  applyImport(token: string): Promise<BrowserImportApplyResult>
  shutdown(): Promise<void>
  readonly toolHandler: {
    getToolDefinitions(): MCPToolDefinition[]
    callTool(
      toolName: string,
      args: Record<string, unknown>,
      conversationId?: string,
      runId?: string
    ): Promise<string>
  }
}

export interface ITabPresenter {
  createTab(windowId: number, url: string, options?: TabCreateOptions): Promise<number | null>
  closeTab(tabId: number): Promise<boolean>
  closeTabs(windowId: number): Promise<void>
  switchTab(tabId: number): Promise<boolean>
  getTab(tabId: number): Promise<WebContentsView | undefined>
  detachTab(tabId: number): Promise<boolean>
  attachTab(tabId: number, targetWindowId: number, index?: number): Promise<boolean>
  moveTab(tabId: number, targetWindowId: number, index?: number): Promise<boolean>
  getWindowTabsData(windowId: number): Promise<TabData[]>
  getActiveTabId(windowId: number): Promise<number | undefined>
  getTabIdByWebContentsId(webContentsId: number): number | undefined
  getWindowIdByWebContentsId(webContentsId: number): number | undefined
  getTabWindowId(tabId: number): number | undefined
  reorderTabs(windowId: number, tabIds: number[]): Promise<boolean>
  moveTabToNewWindow(tabId: number, screenX?: number, screenY?: number): Promise<boolean>
  captureTabArea(
    tabId: number,
    rect: { x: number; y: number; width: number; height: number }
  ): Promise<string | null>
  stitchImagesWithWatermark(
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
  ): Promise<string | null>
  isLastTabInWindow(tabId: number): Promise<boolean>
  registerFloatingWindow(webContentsId: number, webContents: WebContents): void
  unregisterFloatingWindow(webContentsId: number): void
  resetTabToBlank(tabId: number): Promise<void>
  destroy(): Promise<void>
}

export interface TabCreateOptions {
  active?: boolean
  position?: number
  allowNonLocal?: boolean
}

export interface IShortcutPresenter {
  registerShortcuts(): void
  unregisterShortcuts(): void
  destroy(): void
}
