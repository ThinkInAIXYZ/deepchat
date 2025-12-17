export enum BrowserTabStatus {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Error = 'error',
  Closed = 'closed'
}

export interface BrowserTabInfo {
  id: string
  url: string
  title?: string
  favicon?: string
  isActive: boolean
  status: BrowserTabStatus
  createdAt: number
  updatedAt: number
}

export interface ScreenshotOptions {
  fullPage?: boolean
  quality?: number
  selector?: string
  highlightSelectors?: string[]
  clip?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface DownloadInfo {
  id: string
  url: string
  filePath?: string
  mimeType?: string
  receivedBytes: number
  totalBytes: number
  status: 'pending' | 'in-progress' | 'completed' | 'failed'
  error?: string
}

export interface BrowserToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  requiresVision?: boolean
}

export type BrowserEvent =
  | { type: 'tab-created'; tab: BrowserTabInfo }
  | { type: 'tab-updated'; tab: BrowserTabInfo }
  | { type: 'tab-activated'; tabId: string }
  | { type: 'tab-closed'; tabId: string }
  | { type: 'tab-navigated'; tabId: string; url: string }
  | { type: 'window-visibility-changed'; visible: boolean }

export interface BrowserContextSnapshot {
  activeTabId: string | null
  tabs: BrowserTabInfo[]
}
