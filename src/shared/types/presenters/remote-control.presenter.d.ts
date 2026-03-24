import type { HookEventName, HookTestResult } from '../../hooksNotifications'

export type TelegramStreamMode = 'draft' | 'final'
export type TelegramRemoteRuntimeState =
  | 'disabled'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'backoff'
  | 'error'

export interface TelegramHookSettings {
  enabled: boolean
  chatId: string
  threadId?: string
  events: HookEventName[]
}

export interface TelegramRemoteBindingSummary {
  endpointKey: string
  sessionId: string
  chatId: number
  messageThreadId: number
  updatedAt: number
}

export interface TelegramPairingSnapshot {
  pairCode: string | null
  pairCodeExpiresAt: number | null
  allowedUserIds: number[]
}

export interface TelegramRemoteSettings {
  botToken: string
  remoteEnabled: boolean
  allowedUserIds: number[]
  defaultAgentId: string
  hookNotifications: TelegramHookSettings
}

export interface TelegramRemoteStatus {
  enabled: boolean
  state: TelegramRemoteRuntimeState
  pollOffset: number
  bindingCount: number
  allowedUserCount: number
  lastError: string | null
  botUser: {
    id: number
    username?: string
  } | null
}

export interface IRemoteControlPresenter {
  getTelegramSettings(): Promise<TelegramRemoteSettings>
  saveTelegramSettings(input: TelegramRemoteSettings): Promise<TelegramRemoteSettings>
  getTelegramStatus(): Promise<TelegramRemoteStatus>
  getTelegramBindings(): Promise<TelegramRemoteBindingSummary[]>
  removeTelegramBinding(endpointKey: string): Promise<void>
  getTelegramPairingSnapshot(): Promise<TelegramPairingSnapshot>
  createTelegramPairCode(): Promise<{ code: string; expiresAt: number }>
  clearTelegramPairCode(): Promise<void>
  clearTelegramBindings(): Promise<number>
  testTelegramHookNotification(): Promise<HookTestResult>
}
