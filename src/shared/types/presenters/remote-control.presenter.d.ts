export type RemoteChannelId = 'telegram' | 'feishu' | 'qqbot' | 'discord' | 'weixin-ilink'
export type RemoteChannel = RemoteChannelId
export type PairableRemoteChannel = Extract<
  RemoteChannelId,
  'telegram' | 'feishu' | 'qqbot' | 'discord'
>
export type RemoteBindingKind = 'dm' | 'group' | 'topic'
export type TelegramStreamMode = 'draft' | 'final'
export type FeishuBrand = 'feishu' | 'lark'
export type RemoteRuntimeState =
  | 'disabled'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'backoff'
  | 'error'

export interface RemoteChannelDescriptor {
  id: RemoteChannelId
  type: 'builtin'
  implemented: boolean
  titleKey: string
  descriptionKey: string
  supportsPairing: boolean
  supportsNotifications: boolean
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

export interface QQBotRemoteBindingSummary extends RemoteBindingSummary {
  channel: 'qqbot'
}

export interface DiscordRemoteBindingSummary extends RemoteBindingSummary {
  channel: 'discord'
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

export interface QQBotPairingSnapshot {
  pairCode: string | null
  pairCodeExpiresAt: number | null
  pairedUserIds: string[]
  pairedGroupIds: string[]
}

export interface DiscordPairingSnapshot {
  pairCode: string | null
  pairCodeExpiresAt: number | null
  pairedChannelIds: string[]
}

export type RemotePairingSnapshot =
  | TelegramPairingSnapshot
  | FeishuPairingSnapshot
  | QQBotPairingSnapshot
  | DiscordPairingSnapshot

export interface WeixinIlinkAccountSummary {
  accountId: string
  ownerUserId: string
  baseUrl: string
  enabled: boolean
}

export interface TelegramRemoteSettings {
  botToken: string
  remoteEnabled: boolean
  defaultAgentId: string
}

export interface FeishuRemoteSettings {
  brand: FeishuBrand
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey: string
  remoteEnabled: boolean
  defaultAgentId: string
  defaultWorkdir: string
  pairedUserOpenIds: string[]
}

export interface QQBotRemoteSettings {
  appId: string
  clientSecret: string
  remoteEnabled: boolean
  defaultAgentId: string
  defaultWorkdir: string
  pairedUserIds: string[]
}

export interface DiscordRemoteSettings {
  botToken: string
  remoteEnabled: boolean
  defaultAgentId: string
  defaultWorkdir: string
  pairedChannelIds: string[]
}

export interface WeixinIlinkRemoteSettings {
  remoteEnabled: boolean
  defaultAgentId: string
  defaultWorkdir: string
  accounts: WeixinIlinkAccountSummary[]
}

export type RemoteChannelSettings =
  | TelegramRemoteSettings
  | FeishuRemoteSettings
  | QQBotRemoteSettings
  | DiscordRemoteSettings
  | WeixinIlinkRemoteSettings

export type ChannelSettingsMap = {
  telegram: TelegramRemoteSettings
  feishu: FeishuRemoteSettings
  qqbot: QQBotRemoteSettings
  discord: DiscordRemoteSettings
  'weixin-ilink': WeixinIlinkRemoteSettings
}

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

export interface QQBotRemoteStatus {
  channel: 'qqbot'
  enabled: boolean
  state: RemoteRuntimeState
  bindingCount: number
  pairedUserCount: number
  lastError: string | null
  botUser: {
    id: string
    username?: string
  } | null
}

export interface DiscordRemoteStatus {
  channel: 'discord'
  enabled: boolean
  state: RemoteRuntimeState
  bindingCount: number
  pairedChannelCount: number
  lastError: string | null
  botUser: {
    id: string
    username?: string
    displayName?: string
  } | null
}

export interface WeixinIlinkAccountStatus extends WeixinIlinkAccountSummary {
  state: RemoteRuntimeState
  connected: boolean
  bindingCount: number
  lastError: string | null
}

export interface WeixinIlinkRemoteStatus {
  channel: 'weixin-ilink'
  enabled: boolean
  state: RemoteRuntimeState
  bindingCount: number
  accountCount: number
  connectedAccountCount: number
  lastError: string | null
  accounts: WeixinIlinkAccountStatus[]
}

export type RemoteChannelStatus =
  | TelegramRemoteStatus
  | FeishuRemoteStatus
  | QQBotRemoteStatus
  | DiscordRemoteStatus
  | WeixinIlinkRemoteStatus

export interface WeixinIlinkLoginSession {
  sessionKey: string
  loginUrl: string | null
  message?: string
  messageKey?: string
}

export interface WeixinIlinkLoginResult {
  connected: boolean
  account: WeixinIlinkAccountSummary | null
  message?: string
  messageKey?: string
}

export interface IRemoteControlPresenter {
  listRemoteChannels(): Promise<RemoteChannelDescriptor[]>

  getChannelSettings<T extends RemoteChannel>(channel: T): Promise<ChannelSettingsMap[T]>

  saveChannelSettings<T extends RemoteChannel>(
    channel: T,
    input: ChannelSettingsMap[T]
  ): Promise<ChannelSettingsMap[T]>

  getChannelStatus(channel: 'telegram'): Promise<TelegramRemoteStatus>
  getChannelStatus(channel: 'feishu'): Promise<FeishuRemoteStatus>
  getChannelStatus(channel: 'qqbot'): Promise<QQBotRemoteStatus>
  getChannelStatus(channel: 'discord'): Promise<DiscordRemoteStatus>
  getChannelStatus(channel: 'weixin-ilink'): Promise<WeixinIlinkRemoteStatus>
  getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus>

  getChannelBindings(channel: RemoteChannel): Promise<RemoteBindingSummary[]>
  removeChannelBinding(channel: RemoteChannel, endpointKey: string): Promise<void>
  removeChannelPrincipal(channel: PairableRemoteChannel, principalId: string): Promise<void>

  getChannelPairingSnapshot(channel: 'telegram'): Promise<TelegramPairingSnapshot>
  getChannelPairingSnapshot(channel: 'feishu'): Promise<FeishuPairingSnapshot>
  getChannelPairingSnapshot(channel: 'qqbot'): Promise<QQBotPairingSnapshot>
  getChannelPairingSnapshot(channel: 'discord'): Promise<DiscordPairingSnapshot>
  getChannelPairingSnapshot(channel: PairableRemoteChannel): Promise<RemotePairingSnapshot>

  createChannelPairCode(
    channel: PairableRemoteChannel
  ): Promise<{ code: string; expiresAt: number }>
  clearChannelPairCode(channel: PairableRemoteChannel): Promise<void>
  clearChannelBindings(channel: RemoteChannel): Promise<number>

  getTelegramSettings(): Promise<TelegramRemoteSettings>
  saveTelegramSettings(input: TelegramRemoteSettings): Promise<TelegramRemoteSettings>
  getTelegramStatus(): Promise<TelegramRemoteStatus>
  getTelegramBindings(): Promise<TelegramRemoteBindingSummary[]>
  removeTelegramBinding(endpointKey: string): Promise<void>
  getTelegramPairingSnapshot(): Promise<TelegramPairingSnapshot>
  createTelegramPairCode(): Promise<{ code: string; expiresAt: number }>
  clearTelegramPairCode(): Promise<void>
  clearTelegramBindings(): Promise<number>

  getDiscordSettings(): Promise<DiscordRemoteSettings>
  saveDiscordSettings(input: DiscordRemoteSettings): Promise<DiscordRemoteSettings>
  getDiscordStatus(): Promise<DiscordRemoteStatus>

  getWeixinIlinkSettings(): Promise<WeixinIlinkRemoteSettings>
  saveWeixinIlinkSettings(input: WeixinIlinkRemoteSettings): Promise<WeixinIlinkRemoteSettings>
  getWeixinIlinkStatus(): Promise<WeixinIlinkRemoteStatus>
  startWeixinIlinkLogin(input?: { force?: boolean }): Promise<WeixinIlinkLoginSession>
  waitForWeixinIlinkLogin(input: {
    sessionKey: string
    timeoutMs?: number
  }): Promise<WeixinIlinkLoginResult>
  removeWeixinIlinkAccount(accountId: string): Promise<void>
  restartWeixinIlinkAccount(accountId: string): Promise<void>
}
