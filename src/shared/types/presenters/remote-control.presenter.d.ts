import type { HookEventName, HookTestResult } from '../../hooksNotifications'

export type RemoteChannel = 'telegram' | 'feishu'
export type RemoteBindingKind = 'dm' | 'group' | 'topic'
export type TelegramStreamMode = 'draft' | 'final'
export type RemoteRuntimeState =
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

export interface RemoteBindingSummary {
  channel: RemoteChannel
  endpointKey: string
  sessionId: string
  chatId: string
  threadId: string | null
  kind: RemoteBindingKind
  updatedAt: number
}

export interface TelegramRemoteBindingSummary {
  endpointKey: string
  sessionId: string
  chatId: number
  messageThreadId: number
  updatedAt: number
}

export interface FeishuRemoteBindingSummary extends RemoteBindingSummary {
  channel: 'feishu'
}

export interface TelegramPairingSnapshot {
  pairCode: string | null
  pairCodeExpiresAt: number | null
  allowedUserIds: number[]
}

export interface FeishuPairingSnapshot {
  pairCode: string | null
  pairCodeExpiresAt: number | null
  pairedUserOpenIds: string[]
}

export type RemotePairingSnapshot = TelegramPairingSnapshot | FeishuPairingSnapshot

export interface TelegramRemoteSettings {
  botToken: string
  remoteEnabled: boolean
  allowedUserIds: number[]
  defaultAgentId: string
  hookNotifications: TelegramHookSettings
}

export interface FeishuRemoteSettings {
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey: string
  remoteEnabled: boolean
  defaultAgentId: string
  pairedUserOpenIds: string[]
}

export type RemoteChannelSettings = TelegramRemoteSettings | FeishuRemoteSettings

export interface TelegramRemoteStatus {
  channel: 'telegram'
  enabled: boolean
  state: RemoteRuntimeState
  pollOffset: number
  bindingCount: number
  allowedUserCount: number
  lastError: string | null
  botUser: {
    id: number
    username?: string
  } | null
}

export interface FeishuRemoteStatus {
  channel: 'feishu'
  enabled: boolean
  state: RemoteRuntimeState
  bindingCount: number
  pairedUserCount: number
  lastError: string | null
  botUser: {
    openId: string
    name?: string
  } | null
}

export type RemoteChannelStatus = TelegramRemoteStatus | FeishuRemoteStatus

export interface IRemoteControlPresenter {
  getChannelSettings(channel: 'telegram'): Promise<TelegramRemoteSettings>
  getChannelSettings(channel: 'feishu'): Promise<FeishuRemoteSettings>
  getChannelSettings(channel: RemoteChannel): Promise<RemoteChannelSettings>

  saveChannelSettings(
    channel: 'telegram',
    input: TelegramRemoteSettings
  ): Promise<TelegramRemoteSettings>
  saveChannelSettings(channel: 'feishu', input: FeishuRemoteSettings): Promise<FeishuRemoteSettings>
  saveChannelSettings(
    channel: RemoteChannel,
    input: RemoteChannelSettings
  ): Promise<RemoteChannelSettings>

  getChannelStatus(channel: 'telegram'): Promise<TelegramRemoteStatus>
  getChannelStatus(channel: 'feishu'): Promise<FeishuRemoteStatus>
  getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus>

  getChannelBindings(channel: RemoteChannel): Promise<RemoteBindingSummary[]>
  removeChannelBinding(channel: RemoteChannel, endpointKey: string): Promise<void>

  getChannelPairingSnapshot(channel: 'telegram'): Promise<TelegramPairingSnapshot>
  getChannelPairingSnapshot(channel: 'feishu'): Promise<FeishuPairingSnapshot>
  getChannelPairingSnapshot(channel: RemoteChannel): Promise<RemotePairingSnapshot>

  createChannelPairCode(channel: RemoteChannel): Promise<{ code: string; expiresAt: number }>
  clearChannelPairCode(channel: RemoteChannel): Promise<void>
  clearChannelBindings(channel: RemoteChannel): Promise<number>
  testTelegramHookNotification(): Promise<HookTestResult>

  getTelegramSettings(): Promise<TelegramRemoteSettings>
  saveTelegramSettings(input: TelegramRemoteSettings): Promise<TelegramRemoteSettings>
  getTelegramStatus(): Promise<TelegramRemoteStatus>
  getTelegramBindings(): Promise<TelegramRemoteBindingSummary[]>
  removeTelegramBinding(endpointKey: string): Promise<void>
  getTelegramPairingSnapshot(): Promise<TelegramPairingSnapshot>
  createTelegramPairCode(): Promise<{ code: string; expiresAt: number }>
  clearTelegramPairCode(): Promise<void>
  clearTelegramBindings(): Promise<number>
}
