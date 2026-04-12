import { BrowserWindow } from 'electron'
import logger from '@shared/logger'
import type {
  DiscordPairingSnapshot,
  DiscordRemoteSettings,
  DiscordRemoteStatus,
  FeishuPairingSnapshot,
  FeishuRemoteSettings,
  FeishuRemoteStatus,
  PairableRemoteChannel,
  RemoteBindingSummary,
  RemoteChannel,
  RemoteChannelDescriptor,
  RemoteChannelSettings,
  RemoteChannelStatus,
  WeixinIlinkLoginResult,
  WeixinIlinkLoginSession,
  WeixinIlinkRemoteSettings,
  WeixinIlinkRemoteStatus,
  QQBotPairingSnapshot,
  QQBotRemoteSettings,
  QQBotRemoteStatus,
  TelegramPairingSnapshot,
  TelegramRemoteBindingSummary,
  TelegramRemoteSettings,
  TelegramRemoteStatus
} from '@shared/presenter'
import {
  DISCORD_REMOTE_DEFAULT_AGENT_ID,
  QQBOT_REMOTE_DEFAULT_AGENT_ID,
  TELEGRAM_REMOTE_COMMANDS,
  TELEGRAM_REMOTE_DEFAULT_AGENT_ID,
  WEIXIN_ILINK_REMOTE_DEFAULT_AGENT_ID,
  buildBindingSummary,
  normalizeDiscordSettingsInput,
  normalizeFeishuSettingsInput,
  normalizeQQBotSettingsInput,
  normalizeTelegramSettingsInput,
  normalizeWeixinIlinkSettingsInput,
  parseTelegramEndpointKey,
  type DiscordRuntimeStatusSnapshot,
  type FeishuRuntimeStatusSnapshot,
  type QQBotRuntimeStatusSnapshot,
  type TelegramPollerStatusSnapshot,
  type WeixinIlinkRuntimeStatusSnapshot
} from './types'
import type { ChannelAdapterConfig } from './types/channel'
import { resolveAcpAgentAlias } from '../configPresenter/acpRegistryConstants'
import type { RemoteControlPresenterDeps } from './interface'
import { RemoteBindingStore } from './services/remoteBindingStore'
import { RemoteConversationRunner } from './services/remoteConversationRunner'
import { TelegramClient } from './telegram/telegramClient'
import { ChannelManager } from './channelManager'
import { TelegramAdapter } from './adapters/telegram/TelegramAdapter'
import { DiscordAdapter } from './adapters/discord/DiscordAdapter'
import { FeishuAdapter } from './adapters/feishu/FeishuAdapter'
import { QQBotAdapter } from './adapters/qqbot/QQBotAdapter'
import { WeixinIlinkAdapter } from './adapters/weixinIlink/WeixinIlinkAdapter'
import { WeixinIlinkClient } from './weixinIlink/weixinIlinkClient'

const DEFAULT_CHANNEL_ID = 'default'
const WEIXIN_TRACE_LOG_ENABLED = process.env.DEEPCHAT_WEIXIN_TRACE === '1'

const DEFAULT_TELEGRAM_POLLER_STATUS: TelegramPollerStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

const DEFAULT_FEISHU_RUNTIME_STATUS: FeishuRuntimeStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

const DEFAULT_QQBOT_RUNTIME_STATUS: QQBotRuntimeStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

const DEFAULT_DISCORD_RUNTIME_STATUS: DiscordRuntimeStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

const DEFAULT_WEIXIN_ILINK_RUNTIME_STATUS: WeixinIlinkRuntimeStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

export class RemoteControlPresenter {
  private readonly bindingStore: RemoteBindingStore
  private readonly channelManager: ChannelManager
  private runtimeOperation: Promise<void> = Promise.resolve()
  private weixinIlinkLoginWindow: BrowserWindow | null = null
  private weixinIlinkLoginWindowUrl: string | null = null
  private readonly weixinIlinkLoginWaits = new Map<string, Promise<WeixinIlinkLoginResult>>()

  constructor(private readonly deps: RemoteControlPresenterDeps) {
    this.bindingStore = new RemoteBindingStore(this.deps.configPresenter)
    this.channelManager = new ChannelManager()
    this.registerBuiltInFactories()
  }

  async initialize(): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await Promise.all([
        this.rebuildTelegramRuntime(),
        this.rebuildFeishuRuntime(),
        this.rebuildQQBotRuntime(),
        this.rebuildDiscordRuntime(),
        this.rebuildWeixinIlinkRuntimes()
      ])
    })
  }

  async destroy(): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await this.channelManager.unregisterAll()
    })
    this.weixinIlinkLoginWaits.clear()
    this.closeWeixinIlinkLoginWindow()
  }

  buildTelegramSettingsSnapshot(): TelegramRemoteSettings {
    const remoteConfig = this.bindingStore.getTelegramConfig()

    return {
      botToken: remoteConfig.botToken,
      remoteEnabled: remoteConfig.enabled,
      defaultAgentId: remoteConfig.defaultAgentId
    }
  }

  buildFeishuSettingsSnapshot(): FeishuRemoteSettings {
    const remoteConfig = this.bindingStore.getFeishuConfig()
    return {
      brand: remoteConfig.brand,
      appId: remoteConfig.appId,
      appSecret: remoteConfig.appSecret,
      verificationToken: remoteConfig.verificationToken,
      encryptKey: remoteConfig.encryptKey,
      remoteEnabled: remoteConfig.enabled,
      defaultAgentId: remoteConfig.defaultAgentId,
      defaultWorkdir: remoteConfig.defaultWorkdir,
      pairedUserOpenIds: [...remoteConfig.pairedUserOpenIds]
    }
  }

  buildQQBotSettingsSnapshot(): QQBotRemoteSettings {
    const remoteConfig = this.bindingStore.getQQBotConfig()
    return {
      appId: remoteConfig.appId,
      clientSecret: remoteConfig.clientSecret,
      remoteEnabled: remoteConfig.enabled,
      defaultAgentId: remoteConfig.defaultAgentId,
      defaultWorkdir: remoteConfig.defaultWorkdir,
      pairedUserIds: [...remoteConfig.pairedUserIds]
    }
  }

  buildDiscordSettingsSnapshot(): DiscordRemoteSettings {
    const remoteConfig = this.bindingStore.getDiscordConfig()
    return {
      botToken: remoteConfig.botToken,
      remoteEnabled: remoteConfig.enabled,
      defaultAgentId: remoteConfig.defaultAgentId,
      defaultWorkdir: remoteConfig.defaultWorkdir,
      pairedChannelIds: [...remoteConfig.pairedChannelIds]
    }
  }

  buildWeixinIlinkSettingsSnapshot(): WeixinIlinkRemoteSettings {
    const remoteConfig = this.bindingStore.getWeixinIlinkConfig()
    return {
      remoteEnabled: remoteConfig.enabled,
      defaultAgentId: remoteConfig.defaultAgentId,
      defaultWorkdir: remoteConfig.defaultWorkdir,
      accounts: remoteConfig.accounts.map((account) => ({
        accountId: account.accountId,
        ownerUserId: account.ownerUserId,
        baseUrl: account.baseUrl,
        enabled: account.enabled
      }))
    }
  }

  async listRemoteChannels(): Promise<RemoteChannelDescriptor[]> {
    return [
      {
        id: 'telegram',
        type: 'builtin',
        implemented: true,
        titleKey: 'settings.remote.telegram.title',
        descriptionKey: 'settings.remote.telegram.description',
        supportsPairing: true,
        supportsNotifications: false
      },
      {
        id: 'feishu',
        type: 'builtin',
        implemented: true,
        titleKey: 'settings.remote.feishu.title',
        descriptionKey: 'settings.remote.feishu.description',
        supportsPairing: true,
        supportsNotifications: false
      },
      {
        id: 'qqbot',
        type: 'builtin',
        implemented: true,
        titleKey: 'settings.remote.qqbot.title',
        descriptionKey: 'settings.remote.qqbot.description',
        supportsPairing: true,
        supportsNotifications: false
      },
      {
        id: 'discord',
        type: 'builtin',
        implemented: true,
        titleKey: 'settings.remote.discord.title',
        descriptionKey: 'settings.remote.discord.description',
        supportsPairing: true,
        supportsNotifications: false
      },
      {
        id: 'weixin-ilink',
        type: 'builtin',
        implemented: true,
        titleKey: 'settings.remote.weixinIlink.title',
        descriptionKey: 'settings.remote.weixinIlink.description',
        supportsPairing: false,
        supportsNotifications: false
      }
    ]
  }

  async getChannelSettings(channel: 'telegram'): Promise<TelegramRemoteSettings>
  async getChannelSettings(channel: 'feishu'): Promise<FeishuRemoteSettings>
  async getChannelSettings(channel: 'qqbot'): Promise<QQBotRemoteSettings>
  async getChannelSettings(channel: 'discord'): Promise<DiscordRemoteSettings>
  async getChannelSettings(channel: 'weixin-ilink'): Promise<WeixinIlinkRemoteSettings>
  async getChannelSettings(channel: RemoteChannel): Promise<RemoteChannelSettings>
  async getChannelSettings(channel: RemoteChannel): Promise<RemoteChannelSettings> {
    if (channel === 'telegram') {
      return await this.getTelegramSettings()
    }

    if (channel === 'feishu') {
      return await this.getFeishuSettings()
    }

    if (channel === 'qqbot') {
      return await this.getQQBotSettings()
    }

    if (channel === 'discord') {
      return await this.getDiscordSettings()
    }

    return await this.getWeixinIlinkSettings()
  }

  async saveChannelSettings(
    channel: 'telegram',
    input: TelegramRemoteSettings
  ): Promise<TelegramRemoteSettings>
  async saveChannelSettings(
    channel: 'feishu',
    input: FeishuRemoteSettings
  ): Promise<FeishuRemoteSettings>
  async saveChannelSettings(
    channel: 'qqbot',
    input: QQBotRemoteSettings
  ): Promise<QQBotRemoteSettings>
  async saveChannelSettings(
    channel: 'discord',
    input: DiscordRemoteSettings
  ): Promise<DiscordRemoteSettings>
  async saveChannelSettings(
    channel: 'weixin-ilink',
    input: WeixinIlinkRemoteSettings
  ): Promise<WeixinIlinkRemoteSettings>
  async saveChannelSettings(
    channel: RemoteChannel,
    input: RemoteChannelSettings
  ): Promise<RemoteChannelSettings>
  async saveChannelSettings(
    channel: RemoteChannel,
    input: RemoteChannelSettings
  ): Promise<RemoteChannelSettings> {
    if (channel === 'telegram') {
      return await this.saveTelegramSettings(input as TelegramRemoteSettings)
    }

    if (channel === 'feishu') {
      return await this.saveFeishuSettings(input as FeishuRemoteSettings)
    }

    if (channel === 'qqbot') {
      return await this.saveQQBotSettings(input as QQBotRemoteSettings)
    }

    if (channel === 'discord') {
      return await this.saveDiscordSettings(input as DiscordRemoteSettings)
    }

    return await this.saveWeixinIlinkSettings(input as WeixinIlinkRemoteSettings)
  }

  async getChannelStatus(channel: 'telegram'): Promise<TelegramRemoteStatus>
  async getChannelStatus(channel: 'feishu'): Promise<FeishuRemoteStatus>
  async getChannelStatus(channel: 'qqbot'): Promise<QQBotRemoteStatus>
  async getChannelStatus(channel: 'discord'): Promise<DiscordRemoteStatus>
  async getChannelStatus(channel: 'weixin-ilink'): Promise<WeixinIlinkRemoteStatus>
  async getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus>
  async getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus> {
    if (channel === 'telegram') {
      return await this.getTelegramStatus()
    }

    if (channel === 'feishu') {
      return await this.getFeishuStatus()
    }

    if (channel === 'qqbot') {
      return await this.getQQBotStatus()
    }

    if (channel === 'discord') {
      return await this.getDiscordStatus()
    }

    return await this.getWeixinIlinkStatus()
  }

  async getChannelBindings(channel: RemoteChannel): Promise<RemoteBindingSummary[]> {
    return this.bindingStore
      .listBindings(channel)
      .map(({ endpointKey, binding }) => buildBindingSummary(endpointKey, binding))
      .filter((binding): binding is RemoteBindingSummary => binding !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async removeChannelBinding(channel: RemoteChannel, endpointKey: string): Promise<void> {
    if (!endpointKey.startsWith(`${channel}:`)) {
      return
    }

    this.bindingStore.clearBinding(endpointKey)
  }

  async removeChannelPrincipal(channel: PairableRemoteChannel, principalId: string): Promise<void> {
    const normalizedPrincipalId = principalId.trim()
    if (!normalizedPrincipalId) {
      return
    }

    if (channel === 'telegram') {
      const parsedUserId = Number.parseInt(normalizedPrincipalId, 10)
      if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
        return
      }

      this.bindingStore.removeAllowedUser(parsedUserId)
      return
    }

    if (channel === 'feishu') {
      this.bindingStore.removeFeishuPairedUser(normalizedPrincipalId)
      return
    }

    if (channel === 'qqbot') {
      this.bindingStore.removeQQBotPairedUser(normalizedPrincipalId)
      return
    }

    this.bindingStore.removeDiscordPairedChannel(normalizedPrincipalId)
  }

  async getChannelPairingSnapshot(channel: 'telegram'): Promise<TelegramPairingSnapshot>
  async getChannelPairingSnapshot(channel: 'feishu'): Promise<FeishuPairingSnapshot>
  async getChannelPairingSnapshot(channel: 'qqbot'): Promise<QQBotPairingSnapshot>
  async getChannelPairingSnapshot(channel: 'discord'): Promise<DiscordPairingSnapshot>
  async getChannelPairingSnapshot(
    channel: 'telegram' | 'feishu' | 'qqbot' | 'discord'
  ): Promise<
    TelegramPairingSnapshot | FeishuPairingSnapshot | QQBotPairingSnapshot | DiscordPairingSnapshot
  >
  async getChannelPairingSnapshot(
    channel: 'telegram' | 'feishu' | 'qqbot' | 'discord'
  ): Promise<
    TelegramPairingSnapshot | FeishuPairingSnapshot | QQBotPairingSnapshot | DiscordPairingSnapshot
  > {
    if (channel === 'telegram') {
      return this.bindingStore.getTelegramPairingSnapshot()
    }

    if (channel === 'feishu') {
      return this.bindingStore.getFeishuPairingSnapshot()
    }

    if (channel === 'qqbot') {
      return this.bindingStore.getQQBotPairingSnapshot()
    }

    return this.bindingStore.getDiscordPairingSnapshot()
  }

  async createChannelPairCode(
    channel: 'telegram' | 'feishu' | 'qqbot' | 'discord'
  ): Promise<{ code: string; expiresAt: number }> {
    return this.bindingStore.createPairCode(channel)
  }

  async clearChannelPairCode(channel: 'telegram' | 'feishu' | 'qqbot' | 'discord'): Promise<void> {
    this.bindingStore.clearPairCode(channel)
  }

  async clearChannelBindings(channel: RemoteChannel): Promise<number> {
    return this.bindingStore.clearBindings(channel)
  }

  async getTelegramSettings(): Promise<TelegramRemoteSettings> {
    const snapshot = this.buildTelegramSettingsSnapshot()
    const defaultAgentId = await this.sanitizeDefaultAgentId('telegram', snapshot.defaultAgentId)
    return {
      ...snapshot,
      defaultAgentId
    }
  }

  async saveTelegramSettings(input: TelegramRemoteSettings): Promise<TelegramRemoteSettings> {
    const normalized = normalizeTelegramSettingsInput(input)
    const defaultAgentId = await this.sanitizeDefaultAgentId('telegram', normalized.defaultAgentId)
    const currentRemoteConfig = this.bindingStore.getTelegramConfig()
    const shouldClearFatalError =
      currentRemoteConfig.enabled !== normalized.remoteEnabled ||
      currentRemoteConfig.botToken !== normalized.botToken

    this.bindingStore.updateTelegramConfig((config) => ({
      ...config,
      botToken: normalized.botToken,
      enabled: normalized.remoteEnabled,
      defaultAgentId,
      streamMode: currentRemoteConfig.streamMode,
      lastFatalError: shouldClearFatalError ? null : config.lastFatalError,
      pairing: config.pairing
    }))

    await this.enqueueRuntimeOperation(async () => {
      await this.rebuildTelegramRuntime()
    })
    return await this.getTelegramSettings()
  }

  async getTelegramStatus(): Promise<TelegramRemoteStatus> {
    const remoteConfig = this.bindingStore.getTelegramConfig()
    const runtimeStatus = this.getEffectiveTelegramStatus(
      remoteConfig.botToken,
      remoteConfig.enabled,
      remoteConfig.lastFatalError
    )

    return {
      channel: 'telegram',
      enabled: remoteConfig.enabled,
      state: runtimeStatus.state,
      pollOffset: remoteConfig.pollOffset,
      bindingCount: Object.keys(remoteConfig.bindings).length,
      allowedUserCount: remoteConfig.allowlist.length,
      lastError: runtimeStatus.lastError,
      botUser: runtimeStatus.botUser
    }
  }

  async getTelegramBindings(): Promise<TelegramRemoteBindingSummary[]> {
    return this.bindingStore
      .listBindings('telegram')
      .map(({ endpointKey, binding }) => {
        const endpoint = parseTelegramEndpointKey(endpointKey)
        if (!endpoint) {
          return null
        }

        return {
          endpointKey,
          sessionId: binding.sessionId,
          chatId: endpoint.chatId,
          messageThreadId: endpoint.messageThreadId,
          updatedAt: binding.updatedAt
        }
      })
      .filter((binding): binding is TelegramRemoteBindingSummary => binding !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async removeTelegramBinding(endpointKey: string): Promise<void> {
    await this.removeChannelBinding('telegram', endpointKey)
  }

  async getTelegramPairingSnapshot(): Promise<TelegramPairingSnapshot> {
    return this.bindingStore.getTelegramPairingSnapshot()
  }

  async createTelegramPairCode(): Promise<{ code: string; expiresAt: number }> {
    return await this.createChannelPairCode('telegram')
  }

  async clearTelegramPairCode(): Promise<void> {
    await this.clearChannelPairCode('telegram')
  }

  async clearTelegramBindings(): Promise<number> {
    return await this.clearChannelBindings('telegram')
  }

  async getFeishuSettings(): Promise<FeishuRemoteSettings> {
    const snapshot = this.buildFeishuSettingsSnapshot()
    const defaultAgentId = await this.sanitizeDefaultAgentId('feishu', snapshot.defaultAgentId)
    return {
      ...snapshot,
      defaultAgentId
    }
  }

  async saveFeishuSettings(input: FeishuRemoteSettings): Promise<FeishuRemoteSettings> {
    const normalized = normalizeFeishuSettingsInput(input)
    const defaultAgentId = await this.sanitizeDefaultAgentId('feishu', normalized.defaultAgentId)
    const currentRemoteConfig = this.bindingStore.getFeishuConfig()
    const shouldClearFatalError =
      currentRemoteConfig.brand !== normalized.brand ||
      currentRemoteConfig.enabled !== normalized.remoteEnabled ||
      currentRemoteConfig.appId !== normalized.appId ||
      currentRemoteConfig.appSecret !== normalized.appSecret ||
      currentRemoteConfig.verificationToken !== normalized.verificationToken ||
      currentRemoteConfig.encryptKey !== normalized.encryptKey ||
      currentRemoteConfig.defaultWorkdir !== normalized.defaultWorkdir

    this.bindingStore.updateFeishuConfig((config) => ({
      ...config,
      brand: normalized.brand,
      appId: normalized.appId,
      appSecret: normalized.appSecret,
      verificationToken: normalized.verificationToken,
      encryptKey: normalized.encryptKey,
      enabled: normalized.remoteEnabled,
      defaultAgentId,
      defaultWorkdir: normalized.defaultWorkdir,
      pairedUserOpenIds: normalized.pairedUserOpenIds,
      lastFatalError: shouldClearFatalError ? null : config.lastFatalError,
      pairing: config.pairing
    }))

    await this.enqueueRuntimeOperation(async () => {
      await this.rebuildFeishuRuntime()
    })
    return await this.getFeishuSettings()
  }

  async getFeishuStatus(): Promise<FeishuRemoteStatus> {
    const remoteConfig = this.bindingStore.getFeishuConfig()
    const runtimeStatus = this.getEffectiveFeishuStatus(
      remoteConfig.enabled,
      remoteConfig.lastFatalError,
      remoteConfig.appId,
      remoteConfig.appSecret
    )

    return {
      channel: 'feishu',
      enabled: remoteConfig.enabled,
      state: runtimeStatus.state,
      bindingCount: Object.keys(remoteConfig.bindings).length,
      pairedUserCount: remoteConfig.pairedUserOpenIds.length,
      lastError: runtimeStatus.lastError,
      botUser: runtimeStatus.botUser
    }
  }

  async getQQBotSettings(): Promise<QQBotRemoteSettings> {
    const snapshot = this.buildQQBotSettingsSnapshot()
    const defaultAgentId = await this.sanitizeDefaultAgentId('qqbot', snapshot.defaultAgentId)
    return {
      ...snapshot,
      defaultAgentId
    }
  }

  async saveQQBotSettings(input: QQBotRemoteSettings): Promise<QQBotRemoteSettings> {
    const normalized = normalizeQQBotSettingsInput(input)
    const defaultAgentId = await this.sanitizeDefaultAgentId('qqbot', normalized.defaultAgentId)
    const currentRemoteConfig = this.bindingStore.getQQBotConfig()
    const shouldClearFatalError =
      currentRemoteConfig.enabled !== normalized.remoteEnabled ||
      currentRemoteConfig.appId !== normalized.appId ||
      currentRemoteConfig.clientSecret !== normalized.clientSecret ||
      currentRemoteConfig.defaultWorkdir !== normalized.defaultWorkdir

    this.bindingStore.updateQQBotConfig((config) => ({
      ...config,
      appId: normalized.appId,
      clientSecret: normalized.clientSecret,
      enabled: normalized.remoteEnabled,
      defaultAgentId,
      defaultWorkdir: normalized.defaultWorkdir,
      pairedUserIds: normalized.pairedUserIds,
      lastFatalError: shouldClearFatalError ? null : config.lastFatalError,
      pairing: config.pairing
    }))

    await this.enqueueRuntimeOperation(async () => {
      await this.rebuildQQBotRuntime()
    })
    return await this.getQQBotSettings()
  }

  async getQQBotStatus(): Promise<QQBotRemoteStatus> {
    const remoteConfig = this.bindingStore.getQQBotConfig()
    const runtimeStatus = this.getEffectiveQQBotStatus(
      remoteConfig.enabled,
      remoteConfig.lastFatalError,
      remoteConfig.appId,
      remoteConfig.clientSecret
    )

    return {
      channel: 'qqbot',
      enabled: remoteConfig.enabled,
      state: runtimeStatus.state,
      bindingCount: Object.keys(remoteConfig.bindings).length,
      pairedUserCount: remoteConfig.pairedUserIds.length,
      lastError: runtimeStatus.lastError,
      botUser: runtimeStatus.botUser
    }
  }

  async getDiscordSettings(): Promise<DiscordRemoteSettings> {
    const snapshot = this.buildDiscordSettingsSnapshot()
    const defaultAgentId = await this.sanitizeDefaultAgentId('discord', snapshot.defaultAgentId)
    return {
      ...snapshot,
      defaultAgentId
    }
  }

  async saveDiscordSettings(input: DiscordRemoteSettings): Promise<DiscordRemoteSettings> {
    const normalized = normalizeDiscordSettingsInput(input)
    const defaultAgentId = await this.sanitizeDefaultAgentId('discord', normalized.defaultAgentId)
    const currentRemoteConfig = this.bindingStore.getDiscordConfig()
    const shouldClearFatalError =
      currentRemoteConfig.enabled !== normalized.remoteEnabled ||
      currentRemoteConfig.botToken !== normalized.botToken ||
      currentRemoteConfig.defaultWorkdir !== normalized.defaultWorkdir

    this.bindingStore.updateDiscordConfig((config) => ({
      ...config,
      botToken: normalized.botToken,
      enabled: normalized.remoteEnabled,
      defaultAgentId,
      defaultWorkdir: normalized.defaultWorkdir,
      pairedChannelIds: normalized.pairedChannelIds,
      lastFatalError: shouldClearFatalError ? null : config.lastFatalError,
      pairing: config.pairing
    }))

    await this.enqueueRuntimeOperation(async () => {
      await this.rebuildDiscordRuntime()
    })
    return await this.getDiscordSettings()
  }

  async getDiscordStatus(): Promise<DiscordRemoteStatus> {
    const remoteConfig = this.bindingStore.getDiscordConfig()
    const runtimeStatus = this.getEffectiveDiscordStatus(
      remoteConfig.enabled,
      remoteConfig.lastFatalError,
      remoteConfig.botToken
    )

    return {
      channel: 'discord',
      enabled: remoteConfig.enabled,
      state: runtimeStatus.state,
      bindingCount: Object.keys(remoteConfig.bindings).length,
      pairedChannelCount: remoteConfig.pairedChannelIds.length,
      lastError: runtimeStatus.lastError,
      botUser: runtimeStatus.botUser
    }
  }

  async getWeixinIlinkSettings(): Promise<WeixinIlinkRemoteSettings> {
    const snapshot = this.buildWeixinIlinkSettingsSnapshot()
    const defaultAgentId = await this.sanitizeDefaultAgentId(
      'weixin-ilink',
      snapshot.defaultAgentId
    )
    return {
      ...snapshot,
      defaultAgentId
    }
  }

  async saveWeixinIlinkSettings(
    input: WeixinIlinkRemoteSettings
  ): Promise<WeixinIlinkRemoteSettings> {
    const normalized = normalizeWeixinIlinkSettingsInput(input)
    const defaultAgentId = await this.sanitizeDefaultAgentId(
      'weixin-ilink',
      normalized.defaultAgentId
    )
    const currentRemoteConfig = this.bindingStore.getWeixinIlinkConfig()
    const currentAccountsById = new Map(
      currentRemoteConfig.accounts.map((account) => [account.accountId, account] as const)
    )

    this.bindingStore.updateWeixinIlinkConfig((config) => ({
      ...config,
      enabled: normalized.remoteEnabled,
      defaultAgentId,
      defaultWorkdir: normalized.defaultWorkdir,
      accounts: normalized.accounts.map((account) => {
        const existing = currentAccountsById.get(account.accountId)
        return {
          accountId: account.accountId,
          ownerUserId: account.ownerUserId,
          baseUrl: account.baseUrl,
          botToken: existing?.botToken ?? '',
          enabled: account.enabled,
          syncCursor: existing?.syncCursor ?? '',
          lastFatalError: existing?.lastFatalError ?? null,
          bindings: existing?.bindings ?? {}
        }
      })
    }))

    await this.enqueueRuntimeOperation(async () => {
      await this.rebuildWeixinIlinkRuntimes()
    })
    return await this.getWeixinIlinkSettings()
  }

  async getWeixinIlinkStatus(): Promise<WeixinIlinkRemoteStatus> {
    const remoteConfig = this.bindingStore.getWeixinIlinkConfig()
    const accounts = remoteConfig.accounts.map((account) => {
      const runtimeStatus = this.getEffectiveWeixinIlinkAccountStatus(remoteConfig.enabled, account)
      return {
        accountId: account.accountId,
        ownerUserId: account.ownerUserId,
        baseUrl: account.baseUrl,
        enabled: account.enabled,
        state: runtimeStatus.state,
        connected: runtimeStatus.state === 'running',
        bindingCount: Object.keys(account.bindings).length,
        lastError: runtimeStatus.lastError
      }
    })

    const connectedAccountCount = accounts.filter((account) => account.connected).length
    const aggregateState = this.resolveWeixinIlinkAggregateState(
      remoteConfig.enabled,
      accounts.map((account) => account.state)
    )
    const aggregateLastError =
      accounts.find((account) => account.lastError)?.lastError ??
      (!remoteConfig.enabled
        ? null
        : (remoteConfig.accounts.find((account) => account.lastFatalError)?.lastFatalError ?? null))

    return {
      channel: 'weixin-ilink',
      enabled: remoteConfig.enabled,
      state: aggregateState,
      bindingCount: accounts.reduce((total, account) => total + account.bindingCount, 0),
      accountCount: accounts.length,
      connectedAccountCount,
      lastError: aggregateLastError,
      accounts
    }
  }

  async startWeixinIlinkLogin(input?: { force?: boolean }): Promise<WeixinIlinkLoginSession> {
    const result = await WeixinIlinkClient.startLogin({
      force: input?.force
    })
    this.openWeixinIlinkLoginWindow(result.loginUrl)
    return {
      sessionKey: result.sessionKey,
      loginUrl: result.loginUrl,
      message: result.message,
      messageKey: result.messageKey
    }
  }

  async waitForWeixinIlinkLogin(input: {
    sessionKey: string
    timeoutMs?: number
  }): Promise<WeixinIlinkLoginResult> {
    const sessionKey = input.sessionKey.trim()
    if (!sessionKey) {
      return {
        connected: false,
        account: null,
        messageKey: 'settings.remote.weixinIlink.loginFailed'
      }
    }

    const existingWait = this.weixinIlinkLoginWaits.get(sessionKey)
    if (existingWait) {
      return await existingWait
    }

    const waitPromise = (async () => {
      const result = await WeixinIlinkClient.waitForLogin({
        ...input,
        sessionKey
      })
      this.closeWeixinIlinkLoginWindow()
      if (!result.connected || !result.accountId || !result.ownerUserId || !result.botToken) {
        return {
          connected: false,
          account: null,
          message: result.message,
          messageKey: result.messageKey
        }
      }

      this.bindingStore.upsertWeixinIlinkAccount({
        accountId: result.accountId,
        ownerUserId: result.ownerUserId,
        baseUrl: result.baseUrl?.trim() || WeixinIlinkClient.DEFAULT_BASE_URL,
        botToken: result.botToken,
        enabled: true,
        lastFatalError: null
      })

      await this.enqueueRuntimeOperation(async () => {
        await this.rebuildWeixinIlinkRuntimes()
      })

      return {
        connected: true,
        account: {
          accountId: result.accountId,
          ownerUserId: result.ownerUserId,
          baseUrl: result.baseUrl?.trim() || WeixinIlinkClient.DEFAULT_BASE_URL,
          enabled: true
        },
        message: result.message,
        messageKey: result.messageKey
      }
    })().finally(() => {
      if (this.weixinIlinkLoginWaits.get(sessionKey) === waitPromise) {
        this.weixinIlinkLoginWaits.delete(sessionKey)
      }
    })

    this.weixinIlinkLoginWaits.set(sessionKey, waitPromise)
    return await waitPromise
  }

  async removeWeixinIlinkAccount(accountId: string): Promise<void> {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) {
      return
    }

    this.bindingStore.removeWeixinIlinkAccount(normalizedAccountId)
    await this.enqueueRuntimeOperation(async () => {
      await this.channelManager.unregisterAdapter('weixin-ilink', normalizedAccountId)
    })
  }

  async restartWeixinIlinkAccount(accountId: string): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await this.rebuildWeixinIlinkAccountRuntime(accountId)
    })
  }

  private registerBuiltInFactories(): void {
    this.channelManager.registerFactory({
      source: 'builtin',
      channelType: 'telegram',
      create: (config) =>
        new TelegramAdapter(config, {
          bindingStore: this.bindingStore,
          createConversationRunner: () => this.createConversationRunner('telegram'),
          registerTelegramCommands: async (client) => {
            await this.registerTelegramCommands(client)
          },
          onFatalError: async (message) => {
            await this.enqueueRuntimeOperation(async () => {
              await this.disableTelegramRuntimeForFatalError(config.configSignature ?? '', message)
            })
          },
          configSignature: config.configSignature
        })
    })

    this.channelManager.registerFactory({
      source: 'builtin',
      channelType: 'feishu',
      create: (config) =>
        new FeishuAdapter(config, {
          bindingStore: this.bindingStore,
          createConversationRunner: () => this.createConversationRunner('feishu'),
          onFatalError: async (message) => {
            await this.enqueueRuntimeOperation(async () => {
              await this.disableFeishuRuntimeForFatalError(config.configSignature ?? '', message)
            })
          },
          configSignature: config.configSignature
        })
    })

    this.channelManager.registerFactory({
      source: 'builtin',
      channelType: 'qqbot',
      create: (config) =>
        new QQBotAdapter(config, {
          bindingStore: this.bindingStore,
          createConversationRunner: () => this.createConversationRunner('qqbot'),
          onFatalError: async (message) => {
            await this.enqueueRuntimeOperation(async () => {
              await this.disableQQBotRuntimeForFatalError(config.configSignature ?? '', message)
            })
          },
          configSignature: config.configSignature
        })
    })

    this.channelManager.registerFactory({
      source: 'builtin',
      channelType: 'discord',
      create: (config) =>
        new DiscordAdapter(config, {
          bindingStore: this.bindingStore,
          createConversationRunner: () => this.createConversationRunner('discord'),
          onFatalError: async (message) => {
            await this.enqueueRuntimeOperation(async () => {
              await this.disableDiscordRuntimeForFatalError(config.configSignature ?? '', message)
            })
          },
          configSignature: config.configSignature
        })
    })

    this.channelManager.registerFactory({
      source: 'builtin',
      channelType: 'weixin-ilink',
      create: (config) =>
        new WeixinIlinkAdapter(config, {
          bindingStore: this.bindingStore,
          createConversationRunner: () => this.createConversationRunner('weixin-ilink'),
          onFatalError: async (accountId, message) => {
            await this.enqueueRuntimeOperation(async () => {
              await this.disableWeixinIlinkRuntimeForFatalError(
                accountId,
                config.configSignature ?? '',
                message
              )
            })
          },
          configSignature: config.configSignature
        })
    })
  }

  private async rebuildTelegramRuntime(): Promise<void> {
    const settings = this.buildTelegramSettingsSnapshot()
    const botToken = settings.botToken.trim()

    if (!settings.remoteEnabled || !botToken) {
      await this.channelManager.unregisterAdapter('telegram', DEFAULT_CHANNEL_ID)
      return
    }

    const configSignature = this.buildTelegramAdapterSignature(settings)
    const existing = this.channelManager.getAdapter('telegram', DEFAULT_CHANNEL_ID)
    if (existing?.configSignature === configSignature && existing.connected) {
      return
    }

    await this.channelManager.unregisterAdapter('telegram', DEFAULT_CHANNEL_ID)

    const adapter = await this.channelManager.createAdapter(
      await this.buildChannelAdapterConfig(
        'telegram',
        {
          botToken
        },
        configSignature
      )
    )
    this.channelManager.registerAdapter(adapter)

    try {
      await adapter.connect()
    } catch {
      // The adapter status snapshot already captures the failure.
    }
  }

  private async rebuildFeishuRuntime(): Promise<void> {
    const settings = this.buildFeishuSettingsSnapshot()

    if (!settings.remoteEnabled || !settings.appId.trim() || !settings.appSecret.trim()) {
      await this.channelManager.unregisterAdapter('feishu', DEFAULT_CHANNEL_ID)
      return
    }

    const configSignature = this.buildFeishuAdapterSignature(settings)
    const existing = this.channelManager.getAdapter('feishu', DEFAULT_CHANNEL_ID)
    if (existing?.configSignature === configSignature && existing.connected) {
      return
    }

    await this.channelManager.unregisterAdapter('feishu', DEFAULT_CHANNEL_ID)

    const adapter = await this.channelManager.createAdapter(
      await this.buildChannelAdapterConfig(
        'feishu',
        {
          brand: settings.brand,
          appId: settings.appId.trim(),
          appSecret: settings.appSecret.trim(),
          verificationToken: settings.verificationToken.trim(),
          encryptKey: settings.encryptKey.trim()
        },
        configSignature
      )
    )
    this.channelManager.registerAdapter(adapter)

    try {
      await adapter.connect()
    } catch {
      // The adapter status snapshot already captures the failure.
    }
  }

  private async rebuildQQBotRuntime(): Promise<void> {
    const settings = this.buildQQBotSettingsSnapshot()

    if (!settings.remoteEnabled || !settings.appId.trim() || !settings.clientSecret.trim()) {
      await this.channelManager.unregisterAdapter('qqbot', DEFAULT_CHANNEL_ID)
      return
    }

    const configSignature = this.buildQQBotAdapterSignature(settings)
    const existing = this.channelManager.getAdapter('qqbot', DEFAULT_CHANNEL_ID)
    if (existing?.configSignature === configSignature && existing.connected) {
      return
    }

    await this.channelManager.unregisterAdapter('qqbot', DEFAULT_CHANNEL_ID)

    const adapter = await this.channelManager.createAdapter(
      await this.buildChannelAdapterConfig(
        'qqbot',
        {
          appId: settings.appId.trim(),
          clientSecret: settings.clientSecret.trim()
        },
        configSignature
      )
    )
    this.channelManager.registerAdapter(adapter)

    try {
      await adapter.connect()
    } catch {
      // The adapter status snapshot already captures the failure.
    }
  }

  private async rebuildDiscordRuntime(): Promise<void> {
    const settings = this.buildDiscordSettingsSnapshot()

    if (!settings.remoteEnabled || !settings.botToken.trim()) {
      await this.channelManager.unregisterAdapter('discord', DEFAULT_CHANNEL_ID)
      return
    }

    const configSignature = this.buildDiscordAdapterSignature(settings)
    const existing = this.channelManager.getAdapter('discord', DEFAULT_CHANNEL_ID)
    if (existing?.configSignature === configSignature && existing.connected) {
      return
    }

    await this.channelManager.unregisterAdapter('discord', DEFAULT_CHANNEL_ID)

    const adapter = await this.channelManager.createAdapter(
      await this.buildChannelAdapterConfig(
        'discord',
        {
          botToken: settings.botToken.trim()
        },
        configSignature
      )
    )
    this.channelManager.registerAdapter(adapter)

    try {
      await adapter.connect()
    } catch {
      // The adapter status snapshot already captures the failure.
    }
  }

  private async rebuildWeixinIlinkRuntimes(): Promise<void> {
    const settings = this.buildWeixinIlinkSettingsSnapshot()
    const configuredAccountIds = new Set(settings.accounts.map((account) => account.accountId))
    const existingAdapters = this.channelManager.listAdapters('weixin-ilink')

    for (const { channelId } of existingAdapters) {
      const account = settings.accounts.find((entry) => entry.accountId === channelId)
      const storedAccount = this.bindingStore.getWeixinIlinkAccount(channelId)
      if (
        !settings.remoteEnabled ||
        !account ||
        !account.enabled ||
        !storedAccount?.botToken.trim()
      ) {
        await this.channelManager.unregisterAdapter('weixin-ilink', channelId)
      }
    }

    if (!settings.remoteEnabled) {
      return
    }

    for (const accountId of configuredAccountIds) {
      await this.rebuildWeixinIlinkAccountRuntime(accountId)
    }
  }

  private async rebuildWeixinIlinkAccountRuntime(accountId: string): Promise<void> {
    const remoteConfig = this.bindingStore.getWeixinIlinkConfig()
    const account = remoteConfig.accounts.find((entry) => entry.accountId === accountId.trim())
    if (
      !remoteConfig.enabled ||
      !account ||
      !account.enabled ||
      !account.ownerUserId.trim() ||
      !account.botToken.trim()
    ) {
      this.logWeixinTrace('Unregistering Weixin iLink adapter.', {
        accountId,
        reason: !remoteConfig.enabled
          ? 'remote-disabled'
          : !account
            ? 'account-missing'
            : !account.enabled
              ? 'account-disabled'
              : !account.ownerUserId.trim()
                ? 'missing-owner-user-id'
                : 'missing-bot-token'
      })
      await this.channelManager.unregisterAdapter('weixin-ilink', accountId)
      return
    }

    const configSignature = this.buildWeixinIlinkAdapterSignature(
      remoteConfig.defaultAgentId,
      account
    )
    const existing = this.channelManager.getAdapter('weixin-ilink', account.accountId)
    if (existing?.configSignature === configSignature && existing.connected) {
      this.logWeixinTrace('Reusing existing Weixin iLink adapter.', {
        accountId: account.accountId
      })
      return
    }

    this.logWeixinTrace('Rebuilding Weixin iLink adapter.', {
      accountId: account.accountId,
      hadExistingAdapter: Boolean(existing)
    })
    await this.channelManager.unregisterAdapter('weixin-ilink', account.accountId)

    const adapter = await this.channelManager.createAdapter(
      await this.buildWeixinIlinkChannelAdapterConfig(account, configSignature)
    )
    this.channelManager.registerAdapter(adapter)

    try {
      await adapter.connect()
      this.logWeixinTrace('Connected Weixin iLink adapter.', {
        accountId: account.accountId
      })
    } catch (error) {
      logger.warn('[RemoteControlPresenter] Failed to connect Weixin iLink adapter.', {
        accountId: account.accountId,
        error
      })
      // The adapter status snapshot already captures the failure.
    }
  }

  private getEffectiveTelegramStatus(
    botToken: string,
    remoteEnabled: boolean,
    lastFatalError: string | null
  ): TelegramPollerStatusSnapshot {
    if (!remoteEnabled) {
      if (lastFatalError) {
        return {
          state: 'error',
          lastError: lastFatalError,
          botUser: null
        }
      }

      return {
        state: 'disabled',
        lastError: null,
        botUser: null
      }
    }

    if (!botToken.trim()) {
      return {
        state: 'error',
        lastError: 'Bot token is required.',
        botUser: null
      }
    }

    const snapshot = this.channelManager.getStatusSnapshot('telegram', DEFAULT_CHANNEL_ID)
    if (!snapshot) {
      return { ...DEFAULT_TELEGRAM_POLLER_STATUS }
    }

    return {
      state: snapshot.state,
      lastError: snapshot.lastError,
      botUser: (snapshot.botUser as TelegramRemoteStatus['botUser']) ?? null
    }
  }

  private getEffectiveFeishuStatus(
    remoteEnabled: boolean,
    lastFatalError: string | null,
    appId: string,
    appSecret: string
  ): FeishuRuntimeStatusSnapshot {
    if (!remoteEnabled) {
      if (lastFatalError) {
        return {
          state: 'error',
          lastError: lastFatalError,
          botUser: null
        }
      }

      return {
        state: 'disabled',
        lastError: null,
        botUser: null
      }
    }

    if (!appId.trim() || !appSecret.trim()) {
      return {
        state: 'error',
        lastError: 'App ID and App Secret are required.',
        botUser: null
      }
    }

    const snapshot = this.channelManager.getStatusSnapshot('feishu', DEFAULT_CHANNEL_ID)
    if (!snapshot) {
      return { ...DEFAULT_FEISHU_RUNTIME_STATUS }
    }

    return {
      state: snapshot.state,
      lastError: snapshot.lastError,
      botUser: (snapshot.botUser as FeishuRemoteStatus['botUser']) ?? null
    }
  }

  private getEffectiveQQBotStatus(
    remoteEnabled: boolean,
    lastFatalError: string | null,
    appId: string,
    clientSecret: string
  ): QQBotRuntimeStatusSnapshot {
    if (!remoteEnabled) {
      if (lastFatalError) {
        return {
          state: 'error',
          lastError: lastFatalError,
          botUser: null
        }
      }

      return {
        state: 'disabled',
        lastError: null,
        botUser: null
      }
    }

    if (!appId.trim() || !clientSecret.trim()) {
      return {
        state: 'error',
        lastError: 'App ID and Client Secret are required.',
        botUser: null
      }
    }

    const snapshot = this.channelManager.getStatusSnapshot('qqbot', DEFAULT_CHANNEL_ID)
    if (!snapshot) {
      return { ...DEFAULT_QQBOT_RUNTIME_STATUS }
    }

    return {
      state: snapshot.state,
      lastError: snapshot.lastError,
      botUser: (snapshot.botUser as QQBotRemoteStatus['botUser']) ?? null
    }
  }

  private getEffectiveDiscordStatus(
    remoteEnabled: boolean,
    lastFatalError: string | null,
    botToken: string
  ): DiscordRuntimeStatusSnapshot {
    if (!remoteEnabled) {
      if (lastFatalError) {
        return {
          state: 'error',
          lastError: lastFatalError,
          botUser: null
        }
      }

      return {
        state: 'disabled',
        lastError: null,
        botUser: null
      }
    }

    if (!botToken.trim()) {
      return {
        state: 'error',
        lastError: 'Bot token is required.',
        botUser: null
      }
    }

    const snapshot = this.channelManager.getStatusSnapshot('discord', DEFAULT_CHANNEL_ID)
    if (!snapshot) {
      return { ...DEFAULT_DISCORD_RUNTIME_STATUS }
    }

    return {
      state: snapshot.state,
      lastError: snapshot.lastError,
      botUser: (snapshot.botUser as DiscordRemoteStatus['botUser']) ?? null
    }
  }

  private getEffectiveWeixinIlinkAccountStatus(
    remoteEnabled: boolean,
    account: {
      accountId: string
      ownerUserId: string
      baseUrl: string
      botToken: string
      enabled: boolean
      lastFatalError: string | null
    }
  ): WeixinIlinkRuntimeStatusSnapshot {
    if (!remoteEnabled || !account.enabled) {
      if (account.lastFatalError) {
        return {
          state: 'error',
          lastError: account.lastFatalError,
          botUser: {
            accountId: account.accountId,
            ownerUserId: account.ownerUserId,
            baseUrl: account.baseUrl
          }
        }
      }

      return {
        ...DEFAULT_WEIXIN_ILINK_RUNTIME_STATUS,
        state: 'disabled',
        botUser: {
          accountId: account.accountId,
          ownerUserId: account.ownerUserId,
          baseUrl: account.baseUrl
        }
      }
    }

    if (!account.ownerUserId.trim() || !account.botToken.trim()) {
      return {
        state: 'error',
        lastError: 'Weixin iLink account credentials are incomplete.',
        botUser: {
          accountId: account.accountId,
          ownerUserId: account.ownerUserId,
          baseUrl: account.baseUrl
        }
      }
    }

    const snapshot = this.channelManager.getStatusSnapshot('weixin-ilink', account.accountId)
    if (!snapshot) {
      return {
        ...DEFAULT_WEIXIN_ILINK_RUNTIME_STATUS,
        botUser: {
          accountId: account.accountId,
          ownerUserId: account.ownerUserId,
          baseUrl: account.baseUrl
        }
      }
    }

    return {
      state: snapshot.state,
      lastError: snapshot.lastError,
      botUser: (snapshot.botUser as WeixinIlinkRuntimeStatusSnapshot['botUser']) ?? {
        accountId: account.accountId,
        ownerUserId: account.ownerUserId,
        baseUrl: account.baseUrl
      }
    }
  }

  private resolveWeixinIlinkAggregateState(
    remoteEnabled: boolean,
    states: Array<WeixinIlinkRemoteStatus['state']>
  ): WeixinIlinkRemoteStatus['state'] {
    if (!remoteEnabled) {
      return 'disabled'
    }

    if (states.length === 0) {
      return 'stopped'
    }

    if (states.includes('error')) {
      return 'error'
    }

    if (states.includes('backoff')) {
      return 'backoff'
    }

    if (states.includes('starting')) {
      return 'starting'
    }

    if (states.includes('running')) {
      return 'running'
    }

    return 'stopped'
  }

  private async disableTelegramRuntimeForFatalError(
    configSignature: string,
    errorMessage: string
  ): Promise<void> {
    const currentSettings = this.buildTelegramSettingsSnapshot()
    if (
      !currentSettings.remoteEnabled ||
      this.buildTelegramAdapterSignature(currentSettings) !== configSignature
    ) {
      return
    }

    this.bindingStore.updateTelegramConfig((config) => ({
      ...config,
      enabled: false,
      lastFatalError: errorMessage
    }))

    await this.channelManager.unregisterAdapter('telegram', DEFAULT_CHANNEL_ID)
  }

  private async disableFeishuRuntimeForFatalError(
    configSignature: string,
    errorMessage: string
  ): Promise<void> {
    const currentSettings = this.buildFeishuSettingsSnapshot()
    if (
      !currentSettings.remoteEnabled ||
      this.buildFeishuAdapterSignature(currentSettings) !== configSignature
    ) {
      return
    }

    this.bindingStore.updateFeishuConfig((config) => ({
      ...config,
      enabled: false,
      lastFatalError: errorMessage
    }))

    await this.channelManager.unregisterAdapter('feishu', DEFAULT_CHANNEL_ID)
  }

  private async disableQQBotRuntimeForFatalError(
    configSignature: string,
    errorMessage: string
  ): Promise<void> {
    const currentSettings = this.buildQQBotSettingsSnapshot()
    if (
      !currentSettings.remoteEnabled ||
      this.buildQQBotAdapterSignature(currentSettings) !== configSignature
    ) {
      return
    }

    this.bindingStore.updateQQBotConfig((config) => ({
      ...config,
      enabled: false,
      lastFatalError: errorMessage
    }))

    await this.channelManager.unregisterAdapter('qqbot', DEFAULT_CHANNEL_ID)
  }

  private async disableDiscordRuntimeForFatalError(
    configSignature: string,
    errorMessage: string
  ): Promise<void> {
    const currentSettings = this.buildDiscordSettingsSnapshot()
    if (
      !currentSettings.remoteEnabled ||
      this.buildDiscordAdapterSignature(currentSettings) !== configSignature
    ) {
      return
    }

    this.bindingStore.updateDiscordConfig((config) => ({
      ...config,
      enabled: false,
      lastFatalError: errorMessage
    }))

    await this.channelManager.unregisterAdapter('discord', DEFAULT_CHANNEL_ID)
  }

  private async disableWeixinIlinkRuntimeForFatalError(
    accountId: string,
    configSignature: string,
    errorMessage: string
  ): Promise<void> {
    const remoteConfig = this.bindingStore.getWeixinIlinkConfig()
    const account = remoteConfig.accounts.find((entry) => entry.accountId === accountId)
    if (!remoteConfig.enabled || !account) {
      return
    }

    if (
      this.buildWeixinIlinkAdapterSignature(remoteConfig.defaultAgentId, account) !==
      configSignature
    ) {
      return
    }

    this.bindingStore.updateWeixinIlinkAccount(accountId, (config) => ({
      ...config,
      enabled: false,
      lastFatalError: errorMessage
    }))

    await this.channelManager.unregisterAdapter('weixin-ilink', accountId)
  }

  private async buildChannelAdapterConfig(
    channel: 'telegram' | 'feishu' | 'qqbot' | 'discord',
    channelConfig: Record<string, unknown>,
    configSignature: string
  ): Promise<ChannelAdapterConfig> {
    return {
      channelId: DEFAULT_CHANNEL_ID,
      channelType: channel,
      agentId: await this.sanitizeDefaultAgentId(channel, this.getDefaultAgentId(channel)),
      channelConfig,
      source: 'builtin',
      configSignature
    }
  }

  private async buildWeixinIlinkChannelAdapterConfig(
    account: {
      accountId: string
      ownerUserId: string
      baseUrl: string
      botToken: string
    },
    configSignature: string
  ): Promise<ChannelAdapterConfig> {
    return {
      channelId: account.accountId,
      channelType: 'weixin-ilink',
      agentId: await this.sanitizeDefaultAgentId(
        'weixin-ilink',
        this.getDefaultAgentId('weixin-ilink')
      ),
      channelConfig: {
        ownerUserId: account.ownerUserId,
        baseUrl: account.baseUrl,
        botToken: account.botToken
      },
      source: 'builtin',
      configSignature
    }
  }

  private buildTelegramAdapterSignature(settings: TelegramRemoteSettings): string {
    return JSON.stringify({
      botToken: settings.botToken.trim(),
      remoteEnabled: settings.remoteEnabled,
      defaultAgentId: settings.defaultAgentId.trim()
    })
  }

  private buildFeishuAdapterSignature(settings: FeishuRemoteSettings): string {
    return JSON.stringify({
      brand: settings.brand,
      appId: settings.appId.trim(),
      appSecret: settings.appSecret.trim(),
      verificationToken: settings.verificationToken.trim(),
      encryptKey: settings.encryptKey.trim(),
      remoteEnabled: settings.remoteEnabled,
      defaultAgentId: settings.defaultAgentId.trim(),
      defaultWorkdir: settings.defaultWorkdir.trim()
    })
  }

  private buildQQBotAdapterSignature(settings: QQBotRemoteSettings): string {
    return JSON.stringify({
      appId: settings.appId.trim(),
      clientSecret: settings.clientSecret.trim(),
      remoteEnabled: settings.remoteEnabled,
      defaultAgentId: settings.defaultAgentId.trim(),
      defaultWorkdir: settings.defaultWorkdir.trim()
    })
  }

  private buildDiscordAdapterSignature(settings: DiscordRemoteSettings): string {
    return JSON.stringify({
      botToken: settings.botToken.trim(),
      remoteEnabled: settings.remoteEnabled,
      defaultAgentId: settings.defaultAgentId.trim(),
      defaultWorkdir: settings.defaultWorkdir.trim()
    })
  }

  private buildWeixinIlinkAdapterSignature(
    defaultAgentId: string,
    account: {
      accountId: string
      ownerUserId: string
      baseUrl: string
      botToken: string
      enabled: boolean
    }
  ): string {
    return JSON.stringify({
      accountId: account.accountId,
      ownerUserId: account.ownerUserId,
      baseUrl: account.baseUrl,
      botToken: account.botToken,
      enabled: account.enabled,
      defaultAgentId: defaultAgentId.trim()
    })
  }

  private openWeixinIlinkLoginWindow(loginUrl: string | null | undefined): void {
    const normalizedLoginUrl = loginUrl?.trim()
    if (!normalizedLoginUrl) {
      return
    }

    if (
      this.weixinIlinkLoginWindow &&
      !this.weixinIlinkLoginWindow.isDestroyed() &&
      this.weixinIlinkLoginWindowUrl === normalizedLoginUrl
    ) {
      this.weixinIlinkLoginWindow.show()
      this.weixinIlinkLoginWindow.focus()
      return
    }

    this.closeWeixinIlinkLoginWindow()

    const parentWindow =
      this.deps.windowPresenter.getFocusedWindow() ?? this.deps.windowPresenter.getAllWindows()[0]
    const loginWindow = new BrowserWindow({
      width: 420,
      height: 760,
      minWidth: 380,
      minHeight: 680,
      autoHideMenuBar: true,
      title: 'WeChat iLink Login',
      ...(parentWindow ? { parent: parentWindow } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      }
    })

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      void loginWindow.loadURL(url)
      return { action: 'deny' }
    })
    loginWindow.on('closed', () => {
      if (this.weixinIlinkLoginWindow === loginWindow) {
        this.weixinIlinkLoginWindow = null
        this.weixinIlinkLoginWindowUrl = null
      }
    })

    void loginWindow.loadURL(normalizedLoginUrl)
    loginWindow.show()
    loginWindow.focus()
    this.weixinIlinkLoginWindow = loginWindow
    this.weixinIlinkLoginWindowUrl = normalizedLoginUrl
  }

  private closeWeixinIlinkLoginWindow(): void {
    if (!this.weixinIlinkLoginWindow || this.weixinIlinkLoginWindow.isDestroyed()) {
      this.weixinIlinkLoginWindow = null
      this.weixinIlinkLoginWindowUrl = null
      return
    }

    this.weixinIlinkLoginWindow.close()
    this.weixinIlinkLoginWindow = null
    this.weixinIlinkLoginWindowUrl = null
  }

  private createConversationRunner(channel: RemoteChannel): RemoteConversationRunner {
    return new RemoteConversationRunner(
      {
        configPresenter: this.deps.configPresenter,
        agentSessionPresenter: this.deps.agentSessionPresenter,
        agentRuntimePresenter: this.deps.agentRuntimePresenter,
        windowPresenter: this.deps.windowPresenter,
        tabPresenter: this.deps.tabPresenter,
        resolveDefaultAgentId: async () =>
          await this.sanitizeDefaultAgentId(channel, this.getDefaultAgentId(channel))
      },
      this.bindingStore
    )
  }

  private logWeixinTrace(message: string, context?: Record<string, unknown>): void {
    if (!WEIXIN_TRACE_LOG_ENABLED) {
      return
    }

    logger.info(`[RemoteControlPresenter] ${message}`, context)
  }

  private getDefaultAgentId(channel: RemoteChannel): string {
    return channel === 'telegram'
      ? this.bindingStore.getTelegramDefaultAgentId()
      : channel === 'feishu'
        ? this.bindingStore.getFeishuDefaultAgentId()
        : channel === 'qqbot'
          ? this.bindingStore.getQQBotDefaultAgentId()
          : channel === 'discord'
            ? this.bindingStore.getDiscordDefaultAgentId()
            : this.bindingStore.getWeixinIlinkDefaultAgentId()
  }

  private enqueueRuntimeOperation(operation: () => Promise<void>): Promise<void> {
    const nextOperation = this.runtimeOperation.then(operation, operation)
    this.runtimeOperation = nextOperation.catch(() => {})
    return nextOperation
  }

  private async sanitizeDefaultAgentId(
    channel: RemoteChannel,
    candidate: string | null | undefined
  ): Promise<string> {
    const normalizedCandidate = resolveAcpAgentAlias(
      candidate?.trim() ||
        (channel === 'qqbot'
          ? QQBOT_REMOTE_DEFAULT_AGENT_ID
          : channel === 'discord'
            ? DISCORD_REMOTE_DEFAULT_AGENT_ID
            : channel === 'weixin-ilink'
              ? WEIXIN_ILINK_REMOTE_DEFAULT_AGENT_ID
              : TELEGRAM_REMOTE_DEFAULT_AGENT_ID)
    )
    const agents = await this.deps.configPresenter.listAgents()
    const enabledAgents = agents.filter((agent) => agent.enabled !== false)
    const enabledAgentIds = new Set(enabledAgents.map((agent) => resolveAcpAgentAlias(agent.id)))
    const nextDefaultAgentId = enabledAgentIds.has(normalizedCandidate)
      ? normalizedCandidate
      : enabledAgentIds.has(TELEGRAM_REMOTE_DEFAULT_AGENT_ID)
        ? TELEGRAM_REMOTE_DEFAULT_AGENT_ID
        : enabledAgents[0]?.id || TELEGRAM_REMOTE_DEFAULT_AGENT_ID

    if (channel === 'telegram') {
      if (this.bindingStore.getTelegramDefaultAgentId() !== nextDefaultAgentId) {
        this.bindingStore.updateTelegramConfig((config) => ({
          ...config,
          defaultAgentId: nextDefaultAgentId
        }))
      }
    } else if (channel === 'feishu') {
      if (this.bindingStore.getFeishuDefaultAgentId() !== nextDefaultAgentId) {
        this.bindingStore.updateFeishuConfig((config) => ({
          ...config,
          defaultAgentId: nextDefaultAgentId
        }))
      }
    } else if (channel === 'qqbot') {
      if (this.bindingStore.getQQBotDefaultAgentId() !== nextDefaultAgentId) {
        this.bindingStore.updateQQBotConfig((config) => ({
          ...config,
          defaultAgentId: nextDefaultAgentId
        }))
      }
    } else if (channel === 'discord') {
      if (this.bindingStore.getDiscordDefaultAgentId() !== nextDefaultAgentId) {
        this.bindingStore.updateDiscordConfig((config) => ({
          ...config,
          defaultAgentId: nextDefaultAgentId
        }))
      }
    } else if (this.bindingStore.getWeixinIlinkDefaultAgentId() !== nextDefaultAgentId) {
      this.bindingStore.updateWeixinIlinkConfig((config) => ({
        ...config,
        defaultAgentId: nextDefaultAgentId
      }))
    }

    return nextDefaultAgentId
  }

  private async registerTelegramCommands(client: TelegramClient): Promise<void> {
    try {
      await client.setMyCommands([...TELEGRAM_REMOTE_COMMANDS])
    } catch (error) {
      console.warn('[RemoteControlPresenter] Failed to register Telegram commands:', error)
    }
  }
}
