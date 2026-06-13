import type { BrowserWindow } from 'electron'
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
