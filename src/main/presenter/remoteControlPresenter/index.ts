import type { HookTestResult, TelegramNotificationsConfig } from '@shared/hooksNotifications'
import type {
  TelegramPairingSnapshot,
  TelegramRemoteBindingSummary,
  TelegramRemoteSettings,
  TelegramRemoteStatus
} from '@shared/presenter'
import {
  TELEGRAM_REMOTE_COMMANDS,
  TELEGRAM_REMOTE_DEFAULT_AGENT_ID,
  normalizeTelegramSettingsInput,
  parseTelegramEndpointKey,
  type TelegramPollerStatusSnapshot
} from './types'
import type { RemoteControlPresenterDeps } from './interface'
import { RemoteBindingStore } from './services/remoteBindingStore'
import { RemoteAuthGuard } from './services/remoteAuthGuard'
import { RemoteConversationRunner } from './services/remoteConversationRunner'
import { RemoteCommandRouter } from './services/remoteCommandRouter'
import { TelegramClient } from './telegram/telegramClient'
import { TelegramParser } from './telegram/telegramParser'
import { TelegramPoller } from './telegram/telegramPoller'

const DEFAULT_POLLER_STATUS: TelegramPollerStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

export class RemoteControlPresenter {
  private readonly bindingStore: RemoteBindingStore
  private telegramPoller: TelegramPoller | null = null
  private telegramPollerStatus: TelegramPollerStatusSnapshot = { ...DEFAULT_POLLER_STATUS }
  private activeBotToken: string | null = null
  private runtimeOperation: Promise<void> = Promise.resolve()

  constructor(private readonly deps: RemoteControlPresenterDeps) {
    this.bindingStore = new RemoteBindingStore(this.deps.configPresenter)
  }

  async initialize(): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await this.rebuildTelegramRuntime()
    })
  }

  async destroy(): Promise<void> {
    await this.enqueueRuntimeOperation(async () => {
      await this.stopTelegramRuntime()
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

  async getTelegramSettings(): Promise<TelegramRemoteSettings> {
    const snapshot = this.buildTelegramSettingsSnapshot()
    const defaultAgentId = await this.sanitizeDefaultAgentId(snapshot.defaultAgentId)
    return {
      ...snapshot,
      defaultAgentId
    }
  }

  async saveTelegramSettings(input: TelegramRemoteSettings): Promise<TelegramRemoteSettings> {
    const normalized = normalizeTelegramSettingsInput(input)
    const defaultAgentId = await this.sanitizeDefaultAgentId(normalized.defaultAgentId)
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
      streamMode: 'draft',
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
    const runtimeStatus = this.getEffectivePollerStatus(
      hooksConfig.botToken,
      remoteConfig.enabled,
      remoteConfig.lastFatalError
    )

    return {
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
      .listBindings()
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
    this.bindingStore.clearBinding(endpointKey)
  }

  async getTelegramPairingSnapshot(): Promise<TelegramPairingSnapshot> {
    return this.bindingStore.getPairingSnapshot()
  }

  async createTelegramPairCode(): Promise<{ code: string; expiresAt: number }> {
    return this.bindingStore.createPairCode()
  }

  async clearTelegramPairCode(): Promise<void> {
    this.bindingStore.clearPairCode()
  }

  async clearTelegramBindings(): Promise<number> {
    return this.bindingStore.clearBindings()
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
    const runner = new RemoteConversationRunner(
      {
        newAgentPresenter: this.deps.newAgentPresenter,
        deepchatAgentPresenter: this.deps.deepchatAgentPresenter,
        windowPresenter: this.deps.windowPresenter,
        tabPresenter: this.deps.tabPresenter,
        resolveDefaultAgentId: async () =>
          await this.sanitizeDefaultAgentId(this.bindingStore.getDefaultAgentId())
      },
      this.bindingStore
    )
    const router = new RemoteCommandRouter({
      authGuard,
      runner,
      bindingStore: this.bindingStore,
      getPollerStatus: () => this.getEffectivePollerStatus(botToken, true, null)
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

  private async stopTelegramRuntime(): Promise<void> {
    const poller = this.telegramPoller
    this.telegramPoller = null
    this.activeBotToken = null

    if (!poller) {
      return
    }

    await poller.stop()
  }

  private getEffectivePollerStatus(
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

  private enqueueRuntimeOperation(operation: () => Promise<void>): Promise<void> {
    const nextOperation = this.runtimeOperation.then(operation, operation)
    this.runtimeOperation = nextOperation.catch(() => {})
    return nextOperation
  }

  private async sanitizeDefaultAgentId(candidate: string | null | undefined): Promise<string> {
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

    if (this.bindingStore.getDefaultAgentId() !== nextDefaultAgentId) {
      this.bindingStore.updateTelegramConfig((config) => ({
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
