export enum BrowserPageStatus {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Error = 'error',
  Closed = 'closed'
}

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
  owner?: 'agent' | 'user'
  agentRunId?: string
}

export type BrowserImportCapabilityReason =
  | 'platform_unsupported'
  | 'browser_not_found'
  | 'profile_data_missing'

export interface BrowserImportProfile {
  id: string
  browser: 'chrome' | 'arc'
  browserName: string
  profileName: string
  supported: boolean
  reason?: BrowserImportCapabilityReason
}

export interface BrowserImportScanResult {
  platformSupported: boolean
  profiles: BrowserImportProfile[]
  reason?: BrowserImportCapabilityReason
}

export interface BrowserImportPreview {
  token: string
  profile: BrowserImportProfile
  cookieCount: number
  skippedExpired: number
  skippedPartitioned: number
}

export interface BrowserImportApplyResult {
  importedCookies: number
  skippedExpired: number
  skippedPartitioned: number
  syncedAt: number
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

export type YoBrowserActivityKind = 'navigation' | 'vision' | 'pointer' | 'scroll' | 'keyboard'

export type YoBrowserActivityAction =
  | 'navigate'
  | 'reload'
  | 'screenshot'
  | 'dom'
  | 'runtime'
  | 'mouse_move'
  | 'mouse_click'
  | 'mouse_wheel'
  | 'key'

export type YoBrowserActivityPhase = 'started' | 'completed' | 'failed'

export type YoBrowserActivityDirection = 'up' | 'down' | 'left' | 'right'

export interface YoBrowserActivityPoint {
  x: number
  y: number
}

export interface YoBrowserActivityRect {
  x: number
  y: number
  width: number
  height: number
}

export interface YoBrowserActivityPayload {
  id: string
  sessionId: string
  windowId: number | null
  pageId?: string
  kind: YoBrowserActivityKind
  action: YoBrowserActivityAction
  phase: YoBrowserActivityPhase
  point?: YoBrowserActivityPoint
  rect?: YoBrowserActivityRect
  direction?: YoBrowserActivityDirection
  timestamp: number
}

export interface BrowserToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  requiresVision?: boolean
}
