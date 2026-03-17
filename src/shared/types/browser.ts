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

export interface YoBrowserStatus {
  initialized: boolean
  page: BrowserPageInfo | null
  canGoBack: boolean
  canGoForward: boolean
  visible: boolean
  loading: boolean
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
