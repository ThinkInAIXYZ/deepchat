import type { HookTestResult, TelegramNotificationsConfig } from '@shared/hooksNotifications'
import type { TelegramRemoteSettings, TelegramRemoteStatus } from '@shared/presenter'
import { normalizeTelegramSettingsInput, type TelegramPollerStatusSnapshot } from './types'
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
      streamMode: remoteConfig.streamMode,
      pairCode: remoteConfig.pairing.code,
      pairCodeExpiresAt: remoteConfig.pairing.expiresAt,
      hookNotifications: {
        enabled: hooksConfig.enabled,
        chatId: hooksConfig.chatId,
        threadId: hooksConfig.threadId,
        events: hooksConfig.events
      }
    }
  }

  async getTelegramSettings(): Promise<TelegramRemoteSettings> {
    return this.buildTelegramSettingsSnapshot()
  }

  async saveTelegramSettings(input: TelegramRemoteSettings): Promise<TelegramRemoteSettings> {
    const normalized = normalizeTelegramSettingsInput(input)
    const currentHooksConfig = this.deps.getHooksNotificationsConfig()

    this.deps.setHooksNotificationsConfig({
      ...currentHooksConfig,
      telegram: this.buildTelegramHookConfig(normalized, currentHooksConfig.telegram)
    })

    this.bindingStore.updateTelegramConfig((config) => ({
      ...config,
      enabled: normalized.remoteEnabled,
      allowlist: normalized.allowedUserIds,
      streamMode: normalized.streamMode,
      pairing: {
        code: normalized.pairCode,
        expiresAt: normalized.pairCodeExpiresAt
      }
    }))

    await this.enqueueRuntimeOperation(async () => {
      await this.rebuildTelegramRuntime()
    })
    return this.buildTelegramSettingsSnapshot()
  }

  async getTelegramStatus(): Promise<TelegramRemoteStatus> {
    const remoteConfig = this.bindingStore.getTelegramConfig()
    const hooksConfig = this.deps.getHooksNotificationsConfig().telegram
    const runtimeStatus = this.getEffectivePollerStatus(hooksConfig.botToken, remoteConfig.enabled)

    return {
      state: runtimeStatus.state,
      pollOffset: remoteConfig.pollOffset,
      bindingCount: Object.keys(remoteConfig.bindings).length,
      allowedUserCount: remoteConfig.allowlist.length,
      lastError: runtimeStatus.lastError,
      botUser: runtimeStatus.botUser
    }
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

    const authGuard = new RemoteAuthGuard(this.bindingStore)
    const runner = new RemoteConversationRunner(
      {
        newAgentPresenter: this.deps.newAgentPresenter,
        deepchatAgentPresenter: this.deps.deepchatAgentPresenter,
        windowPresenter: this.deps.windowPresenter,
        tabPresenter: this.deps.tabPresenter
      },
      this.bindingStore
    )
    const router = new RemoteCommandRouter({
      authGuard,
      runner,
      bindingStore: this.bindingStore,
      getPollerStatus: () => this.getEffectivePollerStatus(botToken, true)
    })

    this.telegramPoller = new TelegramPoller({
      client: new TelegramClient(botToken),
      parser: new TelegramParser(),
      router,
      bindingStore: this.bindingStore,
      onStatusChange: (snapshot) => {
        this.telegramPollerStatus = snapshot
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
    remoteEnabled: boolean
  ): TelegramPollerStatusSnapshot {
    if (!remoteEnabled) {
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

  private enqueueRuntimeOperation(operation: () => Promise<void>): Promise<void> {
    const nextOperation = this.runtimeOperation.then(operation, operation)
    this.runtimeOperation = nextOperation.catch(() => {})
    return nextOperation
  }
}
