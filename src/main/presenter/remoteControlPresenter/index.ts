import type { HookTestResult, TelegramNotificationsConfig } from '@shared/hooksNotifications'
import type {
  FeishuPairingSnapshot,
  FeishuRemoteSettings,
  FeishuRemoteStatus,
  RemoteBindingSummary,
  RemoteChannel,
  RemoteChannelSettings,
  RemoteChannelStatus,
  TelegramPairingSnapshot,
  TelegramRemoteBindingSummary,
  TelegramRemoteSettings,
  TelegramRemoteStatus
} from '@shared/presenter'
import {
  TELEGRAM_REMOTE_COMMANDS,
  TELEGRAM_REMOTE_DEFAULT_AGENT_ID,
  buildBindingSummary,
  normalizeFeishuSettingsInput,
  normalizeTelegramSettingsInput,
  parseTelegramEndpointKey,
  type FeishuRuntimeStatusSnapshot,
  type TelegramPollerStatusSnapshot
} from './types'
import type { ChannelAdapterConfig } from './types/channel'
import { resolveAcpAgentAlias } from '../configPresenter/acpRegistryConstants'
import type { RemoteControlPresenterDeps } from './interface'
import { RemoteBindingStore } from './services/remoteBindingStore'
import { RemoteConversationRunner } from './services/remoteConversationRunner'
import { TelegramClient } from './telegram/telegramClient'
import { ChannelManager } from './channelManager'
import { TelegramAdapter } from './adapters/telegram/TelegramAdapter'
import { FeishuAdapter } from './adapters/feishu/FeishuAdapter'

const DEFAULT_CHANNEL_ID = 'default'

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

export class RemoteControlPresenter {
  private readonly bindingStore: RemoteBindingStore
  private readonly channelManager: ChannelManager
  private runtimeOperation: Promise<void> = Promise.resolve()

  constructor(private readonly deps: RemoteControlPresenterDeps) {
    this.bindingStore = new RemoteBindingStore(this.deps.configPresenter)
    this.channelManager = new ChannelManager()
    this.registerBuiltInFactories()
  }

  async initialize(): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await Promise.all([this.rebuildTelegramRuntime(), this.rebuildFeishuRuntime()])
    })
  }

  async destroy(): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await this.channelManager.unregisterAll()
    })
  }

  buildTelegramSettingsSnapshot(): TelegramRemoteSettings {
    const hooksConfig = this.deps.getHooksNotificationsConfig().telegram
    const remoteConfig = this.bindingStore.getTelegramConfig()

    return {
      botToken: hooksConfig.botToken,
      remoteEnabled: remoteConfig.enabled,
      allowedUserIds: remoteConfig.allowlist,
      defaultAgentId: remoteConfig.defaultAgentId,
      defaultWorkdir: remoteConfig.defaultWorkdir,
      hookNotifications: {
        enabled: hooksConfig.enabled,
        chatId: hooksConfig.chatId,
        threadId: hooksConfig.threadId,
        events: hooksConfig.events
      }
    }
  }

  buildFeishuSettingsSnapshot(): FeishuRemoteSettings {
    const remoteConfig = this.bindingStore.getFeishuConfig()
    return {
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

  async getChannelSettings(channel: 'telegram'): Promise<TelegramRemoteSettings>
  async getChannelSettings(channel: 'feishu'): Promise<FeishuRemoteSettings>
  async getChannelSettings(channel: RemoteChannel): Promise<RemoteChannelSettings>
  async getChannelSettings(channel: RemoteChannel): Promise<RemoteChannelSettings> {
    if (channel === 'telegram') {
      return await this.getTelegramSettings()
    }

    return await this.getFeishuSettings()
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

    return await this.saveFeishuSettings(input as FeishuRemoteSettings)
  }

  async getChannelStatus(channel: 'telegram'): Promise<TelegramRemoteStatus>
  async getChannelStatus(channel: 'feishu'): Promise<FeishuRemoteStatus>
  async getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus>
  async getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus> {
    if (channel === 'telegram') {
      return await this.getTelegramStatus()
    }

    return await this.getFeishuStatus()
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

  async getChannelPairingSnapshot(channel: 'telegram'): Promise<TelegramPairingSnapshot>
  async getChannelPairingSnapshot(channel: 'feishu'): Promise<FeishuPairingSnapshot>
  async getChannelPairingSnapshot(
    channel: RemoteChannel
  ): Promise<TelegramPairingSnapshot | FeishuPairingSnapshot>
  async getChannelPairingSnapshot(
    channel: RemoteChannel
  ): Promise<TelegramPairingSnapshot | FeishuPairingSnapshot> {
    if (channel === 'telegram') {
      return this.bindingStore.getTelegramPairingSnapshot()
    }

    return this.bindingStore.getFeishuPairingSnapshot()
  }

  async createChannelPairCode(
    channel: RemoteChannel
  ): Promise<{ code: string; expiresAt: number }> {
    return this.bindingStore.createPairCode(channel)
  }

  async clearChannelPairCode(channel: RemoteChannel): Promise<void> {
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
    const currentHooksConfig = this.deps.getHooksNotificationsConfig()
    const currentRemoteConfig = this.bindingStore.getTelegramConfig()
    const currentBotToken = currentHooksConfig.telegram.botToken.trim()
    const shouldClearFatalError =
      currentRemoteConfig.enabled !== normalized.remoteEnabled ||
      currentBotToken !== normalized.botToken

    this.deps.setHooksNotificationsConfig({
      ...currentHooksConfig,
      telegram: this.buildTelegramHookConfig(normalized, currentHooksConfig.telegram)
    })

    this.bindingStore.updateTelegramConfig((config) => ({
      ...config,
      enabled: normalized.remoteEnabled,
      allowlist: normalized.allowedUserIds,
      defaultAgentId,
      defaultWorkdir: normalized.defaultWorkdir,
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
    const hooksConfig = this.deps.getHooksNotificationsConfig().telegram
    const runtimeStatus = this.getEffectiveTelegramStatus(
      hooksConfig.botToken,
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
      currentRemoteConfig.enabled !== normalized.remoteEnabled ||
      currentRemoteConfig.appId !== normalized.appId ||
      currentRemoteConfig.appSecret !== normalized.appSecret ||
      currentRemoteConfig.verificationToken !== normalized.verificationToken ||
      currentRemoteConfig.encryptKey !== normalized.encryptKey

    this.bindingStore.updateFeishuConfig((config) => ({
      ...config,
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

  async testTelegramHookNotification(): Promise<HookTestResult> {
    return await this.deps.testTelegramHookNotification()
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
  }

  private buildTelegramHookConfig(
    settings: TelegramRemoteSettings,
    previous: TelegramNotificationsConfig
  ): TelegramNotificationsConfig {
    return {
      ...previous,
      enabled: settings.hookNotifications.enabled,
      botToken: settings.botToken,
      chatId: settings.hookNotifications.chatId,
      threadId: settings.hookNotifications.threadId,
      events: settings.hookNotifications.events
    }
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

  private async buildChannelAdapterConfig(
    channel: RemoteChannel,
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

  private buildTelegramAdapterSignature(settings: TelegramRemoteSettings): string {
    return JSON.stringify({
      botToken: settings.botToken.trim(),
      remoteEnabled: settings.remoteEnabled,
      allowedUserIds: [...settings.allowedUserIds],
      defaultAgentId: settings.defaultAgentId.trim(),
      defaultWorkdir: settings.defaultWorkdir.trim(),
      hookNotifications: {
        enabled: settings.hookNotifications.enabled,
        chatId: settings.hookNotifications.chatId.trim(),
        threadId: settings.hookNotifications.threadId?.trim() || '',
        events: [...settings.hookNotifications.events]
      }
    })
  }

  private buildFeishuAdapterSignature(settings: FeishuRemoteSettings): string {
    return JSON.stringify({
      appId: settings.appId.trim(),
      appSecret: settings.appSecret.trim(),
      verificationToken: settings.verificationToken.trim(),
      encryptKey: settings.encryptKey.trim(),
      remoteEnabled: settings.remoteEnabled,
      defaultAgentId: settings.defaultAgentId.trim(),
      defaultWorkdir: settings.defaultWorkdir.trim(),
      pairedUserOpenIds: [...settings.pairedUserOpenIds]
    })
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

  private getDefaultAgentId(channel: RemoteChannel): string {
    return channel === 'telegram'
      ? this.bindingStore.getTelegramDefaultAgentId()
      : this.bindingStore.getFeishuDefaultAgentId()
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
      candidate?.trim() || TELEGRAM_REMOTE_DEFAULT_AGENT_ID
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
    } else if (this.bindingStore.getFeishuDefaultAgentId() !== nextDefaultAgentId) {
      this.bindingStore.updateFeishuConfig((config) => ({
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
