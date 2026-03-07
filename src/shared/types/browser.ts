export enum BrowserPageStatus {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Error = 'error',
  Closed = 'closed'
}

// Deprecated aliases kept temporarily while in-tree callers migrate to page/window semantics.
export type BrowserTabStatus = BrowserPageStatus

export interface BrowserPageInfo {
  id: string
  url: string
  title?: string
  favicon?: string
  status: BrowserPageStatus
  createdAt: number
  updatedAt: number
}

// Deprecated alias kept temporarily while in-tree callers migrate to page/window semantics.
export interface BrowserTabInfo extends BrowserPageInfo {
  isActive?: boolean
}

export interface BrowserWindowInfo {
  id: number
  page: BrowserPageInfo
  isFocused: boolean
  isVisible: boolean
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
  | { type: 'window-created'; window: BrowserWindowInfo }
  | { type: 'window-updated'; window: BrowserWindowInfo }
  | { type: 'window-focused'; windowId: number | null }
  | { type: 'window-closed'; windowId: number }
  | { type: 'window-visibility-changed'; windowId: number; visible: boolean }

export interface BrowserContextSnapshot {
  activeWindowId: number | null
  windows: BrowserWindowInfo[]
}
