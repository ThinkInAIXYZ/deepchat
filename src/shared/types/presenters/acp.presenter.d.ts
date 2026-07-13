export type AcpDebugActionType =
  | 'initialize'
  | 'authenticate'
  | 'newSession'
  | 'loadSession'
  | 'sessionList'
  | 'sessionResume'
  | 'sessionClose'
  | 'sessionFork'
  | 'prompt'
  | 'cancel'
  | 'setSessionMode'
  | 'setSessionModel'
  | 'extMethod'
  | 'extNotification'

export type AcpDebugEventKind =
  | 'request'
  | 'response'
  | 'notification'
  | 'permission'
  | 'lifecycle'
  | 'stderr'
  | 'error'

export interface AcpDebugRequest {
  agentId: string
  action: AcpDebugActionType
  payload?: Record<string, unknown>
  sessionId?: string
  workdir?: string
  methodName?: string
  webContentsId?: number
}

export interface AcpDebugEventEntry {
  id: string
  kind: AcpDebugEventKind
  action: string
  agentId: string
  sessionId?: string
  timestamp: number
  payload?: unknown
  message?: string
}

export interface AcpDebugRunResult {
  status: 'ok' | 'error'
  sessionId?: string
  error?: string
  events: AcpDebugEventEntry[]
}

export interface AcpWorkdirInfo {
  path: string
  isCustom: boolean
}
