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
import type { RemoteControlPresenterDeps } from './interface'
import logger from '@shared/logger'
import { RemoteBindingStore } from './services/remoteBindingStore'
import { FeishuAuthGuard } from './services/feishuAuthGuard'
import { FeishuCommandRouter } from './services/feishuCommandRouter'
import { RemoteAuthGuard } from './services/remoteAuthGuard'
import { RemoteConversationRunner } from './services/remoteConversationRunner'
import { RemoteCommandRouter } from './services/remoteCommandRouter'
import { FeishuClient } from './feishu/feishuClient'
import { FeishuParser } from './feishu/feishuParser'
import { FeishuRuntime } from './feishu/feishuRuntime'
import { TelegramClient } from './telegram/telegramClient'
import { TelegramParser } from './telegram/telegramParser'
import { TelegramPoller } from './telegram/telegramPoller'

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
  private telegramPoller: TelegramPoller | null = null
  private telegramPollerStatus: TelegramPollerStatusSnapshot = { ...DEFAULT_TELEGRAM_POLLER_STATUS }
  private activeBotToken: string | null = null
  private feishuRuntime: FeishuRuntime | null = null
  private feishuRuntimeStatus: FeishuRuntimeStatusSnapshot = { ...DEFAULT_FEISHU_RUNTIME_STATUS }
  private activeFeishuRuntimeKey: string | null = null
  private runtimeOperation: Promise<void> = Promise.resolve()

  constructor(private readonly deps: RemoteControlPresenterDeps) {
    this.bindingStore = new RemoteBindingStore(this.deps.configPresenter)
  }

  async initialize(): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await Promise.all([this.rebuildTelegramRuntime(), this.rebuildFeishuRuntime()])
    })
  }

  async destroy(): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await Promise.all([this.stopTelegramRuntime(), this.stopFeishuRuntime()])
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

    if (!settings.remoteEnabled) {
      await this.stopTelegramRuntime()
      this.telegramPollerStatus = {
        state: 'disabled',
        lastError: null,
        botUser: null
      }
      return
    }

    if (!botToken) {
      await this.stopTelegramRuntime()
      this.telegramPollerStatus = {
        state: 'error',
        lastError: 'Bot token is required.',
        botUser: null
      }
      return
    }

    if (this.telegramPoller && this.activeBotToken === botToken) {
      return
    }

    await this.stopTelegramRuntime()
    this.activeBotToken = botToken
    this.telegramPollerStatus = {
      state: 'starting',
      lastError: null,
      botUser: null
    }

    const client = new TelegramClient(botToken)
    await this.registerTelegramCommands(client)

    const authGuard = new RemoteAuthGuard(this.bindingStore)
    const runner = this.createConversationRunner('telegram')
    const router = new RemoteCommandRouter({
      authGuard,
      runner,
      bindingStore: this.bindingStore,
      getPollerStatus: () => this.getEffectiveTelegramStatus(botToken, true, null)
    })

    this.telegramPoller = new TelegramPoller({
      client,
      parser: new TelegramParser(),
      router,
      bindingStore: this.bindingStore,
      onStatusChange: (snapshot) => {
        this.telegramPollerStatus = snapshot
      },
      onFatalError: (message) => {
        void this.enqueueRuntimeOperation(async () => {
          await this.disableTelegramRuntimeForFatalError(botToken, message)
        })
      }
    })

    try {
      await this.telegramPoller.start()
    } catch (error) {
      this.telegramPollerStatus = {
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error),
        botUser: null
      }
      await this.stopTelegramRuntime()
    }
  }

  private async rebuildFeishuRuntime(): Promise<void> {
    const settings = this.buildFeishuSettingsSnapshot()
    const runtimeKey = this.buildFeishuRuntimeKey(settings)

    if (!settings.remoteEnabled) {
      await this.stopFeishuRuntime()
      this.feishuRuntimeStatus = {
        state: 'disabled',
        lastError: null,
        botUser: null
      }
      return
    }

    if (!settings.appId.trim() || !settings.appSecret.trim()) {
      await this.stopFeishuRuntime()
      this.feishuRuntimeStatus = {
        state: 'error',
        lastError: 'App ID and App Secret are required.',
        botUser: null
      }
      return
    }

    if (this.feishuRuntime && this.activeFeishuRuntimeKey === runtimeKey) {
      return
    }

    await this.stopFeishuRuntime()
    this.activeFeishuRuntimeKey = runtimeKey
    this.feishuRuntimeStatus = {
      state: 'starting',
      lastError: null,
      botUser: null
    }

    const client = new FeishuClient({
      appId: settings.appId,
      appSecret: settings.appSecret,
      verificationToken: settings.verificationToken,
      encryptKey: settings.encryptKey
    })
    const runner = this.createConversationRunner('feishu')
    const router = new FeishuCommandRouter({
      authGuard: new FeishuAuthGuard(this.bindingStore),
      runner,
      bindingStore: this.bindingStore,
      getRuntimeStatus: () =>
        this.getEffectiveFeishuStatus(true, null, settings.appId, settings.appSecret)
    })

    this.feishuRuntime = new FeishuRuntime({
      client,
      parser: new FeishuParser(),
      router,
      logger,
      onStatusChange: (snapshot) => {
        this.feishuRuntimeStatus = snapshot
      },
      onFatalError: (message) => {
        void this.enqueueRuntimeOperation(async () => {
          await this.disableFeishuRuntimeForFatalError(runtimeKey, message)
        })
      }
    })

    try {
      await this.feishuRuntime.start()
    } catch (error) {
      this.feishuRuntimeStatus = {
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error),
        botUser: null
      }
      await this.stopFeishuRuntime()
    }
  }

  private async stopTelegramRuntime(): Promise<void> {
    const poller = this.telegramPoller
    this.telegramPoller = null
    this.activeBotToken = null

    if (!poller) {
      return
    }

    await poller.stop()
  }

  private async stopFeishuRuntime(): Promise<void> {
    const runtime = this.feishuRuntime
    this.feishuRuntime = null
    this.activeFeishuRuntimeKey = null

    if (!runtime) {
      return
    }

    await runtime.stop()
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

    return { ...this.telegramPollerStatus }
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

    return { ...this.feishuRuntimeStatus }
  }

  private async disableTelegramRuntimeForFatalError(
    botToken: string,
    errorMessage: string
  ): Promise<void> {
    const currentHooksConfig = this.deps.getHooksNotificationsConfig().telegram
    const currentRemoteConfig = this.bindingStore.getTelegramConfig()

    if (!currentRemoteConfig.enabled || currentHooksConfig.botToken.trim() !== botToken) {
      return
    }

    this.bindingStore.updateTelegramConfig((config) => ({
      ...config,
      enabled: false,
      lastFatalError: errorMessage
    }))

    await this.stopTelegramRuntime()
    this.telegramPollerStatus = {
      state: 'error',
      lastError: errorMessage,
      botUser: null
    }
  }

  private async disableFeishuRuntimeForFatalError(
    runtimeKey: string,
    errorMessage: string
  ): Promise<void> {
    const currentRemoteConfig = this.bindingStore.getFeishuConfig()
    if (
      !currentRemoteConfig.enabled ||
      this.buildFeishuRuntimeKey({
        appId: currentRemoteConfig.appId,
        appSecret: currentRemoteConfig.appSecret,
        verificationToken: currentRemoteConfig.verificationToken,
        encryptKey: currentRemoteConfig.encryptKey
      }) !== runtimeKey
    ) {
      return
    }

    this.bindingStore.updateFeishuConfig((config) => ({
      ...config,
      enabled: false,
      lastFatalError: errorMessage
    }))

    await this.stopFeishuRuntime()
    this.feishuRuntimeStatus = {
      state: 'error',
      lastError: errorMessage,
      botUser: null
    }
  }

  private createConversationRunner(channel: RemoteChannel): RemoteConversationRunner {
    return new RemoteConversationRunner(
      {
        configPresenter: this.deps.configPresenter,
        newAgentPresenter: this.deps.newAgentPresenter,
        deepchatAgentPresenter: this.deps.deepchatAgentPresenter,
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

  private buildFeishuRuntimeKey(settings: {
    appId: string
    appSecret: string
    verificationToken: string
    encryptKey: string
  }): string {
    return [
      settings.appId.trim(),
      settings.appSecret.trim(),
      settings.verificationToken.trim(),
      settings.encryptKey.trim()
    ].join('::')
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
    const normalizedCandidate = candidate?.trim() || TELEGRAM_REMOTE_DEFAULT_AGENT_ID
    const agents = await this.deps.configPresenter.listAgents()
    const enabledDeepChatAgents = agents.filter(
      (agent) => agent.type === 'deepchat' && agent.enabled !== false
    )
    const enabledAgentIds = new Set(enabledDeepChatAgents.map((agent) => agent.id))
    const nextDefaultAgentId = enabledAgentIds.has(normalizedCandidate)
      ? normalizedCandidate
      : enabledAgentIds.has(TELEGRAM_REMOTE_DEFAULT_AGENT_ID)
        ? TELEGRAM_REMOTE_DEFAULT_AGENT_ID
        : enabledDeepChatAgents[0]?.id || TELEGRAM_REMOTE_DEFAULT_AGENT_ID

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
