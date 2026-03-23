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

export interface TelegramRemoteSettings {
  botToken: string
  remoteEnabled: boolean
  allowedUserIds: number[]
  streamMode: TelegramStreamMode
  pairCode: string | null
  pairCodeExpiresAt: number | null
  hookNotifications: TelegramHookSettings
}

export interface TelegramRemoteStatus {
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
  createTelegramPairCode(): Promise<{ code: string; expiresAt: number }>
  clearTelegramPairCode(): Promise<void>
  clearTelegramBindings(): Promise<number>
  testTelegramHookNotification(): Promise<HookTestResult>
}
