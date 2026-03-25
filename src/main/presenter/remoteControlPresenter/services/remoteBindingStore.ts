import type { IConfigPresenter, RemoteChannel } from '@shared/presenter'
import {
  REMOTE_CONTROL_SETTING_KEY,
  TELEGRAM_MODEL_MENU_TTL_MS,
  normalizeRemoteControlConfig,
  createPairCode,
  createTelegramCallbackToken,
  buildFeishuPairingSnapshot,
  buildTelegramEndpointKey,
  buildTelegramPairingSnapshot,
  type FeishuPairingState,
  type FeishuRemoteRuntimeConfig,
  type RemoteControlConfig,
  type RemoteEndpointBinding,
  type RemoteEndpointBindingMeta,
  type TelegramInboundEvent,
  type TelegramModelMenuState,
  type TelegramPairingState,
  type TelegramRemoteRuntimeConfig
} from '../types'

export class RemoteBindingStore {
  private readonly activeEvents = new Map<string, string>()
  private readonly sessionSnapshots = new Map<string, string[]>()
  private readonly modelMenuStates = new Map<string, TelegramModelMenuState>()

  constructor(private readonly configPresenter: IConfigPresenter) {}

  getConfig(): RemoteControlConfig {
    return normalizeRemoteControlConfig(
      this.configPresenter.getSetting<RemoteControlConfig>(REMOTE_CONTROL_SETTING_KEY)
    )
  }

  getChannelConfig(channel: 'telegram'): TelegramRemoteRuntimeConfig
  getChannelConfig(channel: 'feishu'): FeishuRemoteRuntimeConfig
  getChannelConfig(channel: RemoteChannel): TelegramRemoteRuntimeConfig | FeishuRemoteRuntimeConfig
  getChannelConfig(channel: RemoteChannel) {
    const config = this.getConfig()
    return config[channel]
  }

  getTelegramConfig(): TelegramRemoteRuntimeConfig {
    return this.getChannelConfig('telegram')
  }

  getFeishuConfig(): FeishuRemoteRuntimeConfig {
    return this.getChannelConfig('feishu')
  }

  updateTelegramConfig(
    updater: (config: TelegramRemoteRuntimeConfig) => TelegramRemoteRuntimeConfig
  ): TelegramRemoteRuntimeConfig {
    const current = this.getConfig()
    const next = normalizeRemoteControlConfig({
      ...current,
      telegram: updater(current.telegram)
    })
    this.configPresenter.setSetting(REMOTE_CONTROL_SETTING_KEY, next)
    return next.telegram
  }

  updateFeishuConfig(
    updater: (config: FeishuRemoteRuntimeConfig) => FeishuRemoteRuntimeConfig
  ): FeishuRemoteRuntimeConfig {
    const current = this.getConfig()
    const next = normalizeRemoteControlConfig({
      ...current,
      feishu: updater(current.feishu)
    })
    this.configPresenter.setSetting(REMOTE_CONTROL_SETTING_KEY, next)
    return next.feishu
  }

  getEndpointKey(
    target: { chatId: number; messageThreadId?: number } | TelegramInboundEvent
  ): string {
    return buildTelegramEndpointKey(target.chatId, target.messageThreadId ?? 0)
  }

  getBinding(endpointKey: string): RemoteEndpointBinding | null {
    const channel = this.resolveChannelFromEndpointKey(endpointKey)
    if (!channel) {
      return null
    }

    return this.getChannelBindings(channel)[endpointKey] ?? null
  }

  setBinding(endpointKey: string, sessionId: string, meta?: RemoteEndpointBindingMeta): void {
    const channel = meta?.channel ?? this.resolveChannelFromEndpointKey(endpointKey)
    if (!channel) {
      return
    }

    this.updateBindings(channel, (bindings) => ({
      ...bindings,
      [endpointKey]: {
        sessionId,
        updatedAt: Date.now(),
        meta: meta ?? bindings[endpointKey]?.meta
      }
    }))
    this.activeEvents.delete(endpointKey)
    this.clearModelMenuStatesForEndpoint(endpointKey)
  }

  clearBinding(endpointKey: string): void {
    const channel = this.resolveChannelFromEndpointKey(endpointKey)
    if (!channel) {
      return
    }

    this.updateBindings(channel, (bindings) => {
      const nextBindings = { ...bindings }
      delete nextBindings[endpointKey]
      return nextBindings
    })
    this.clearTransientStateForEndpoint(endpointKey)
  }

  listBindings(channel?: RemoteChannel): Array<{
    endpointKey: string
    binding: RemoteEndpointBinding
  }> {
    const configs =
      channel === undefined
        ? (['telegram', 'feishu'] as const).map(
            (key) => [key, this.getChannelBindings(key)] as const
          )
        : ([[channel, this.getChannelBindings(channel)]] as const)

    return configs.flatMap((entry) => {
      const bindings = entry[1]
      return Object.entries(bindings).map(([endpointKey, binding]) => ({
        endpointKey,
        binding
      }))
    })
  }

  clearBindings(channel?: RemoteChannel): number {
    const entries = this.listBindings(channel)
    if (channel === 'telegram') {
      this.updateTelegramConfig((config) => ({
        ...config,
        bindings: {}
      }))
    } else if (channel === 'feishu') {
      this.updateFeishuConfig((config) => ({
        ...config,
        bindings: {}
      }))
    } else {
      this.updateTelegramConfig((config) => ({
        ...config,
        bindings: {}
      }))
      this.updateFeishuConfig((config) => ({
        ...config,
        bindings: {}
      }))
    }

    for (const { endpointKey } of entries) {
      this.clearTransientStateForEndpoint(endpointKey)
    }

    if (channel === undefined) {
      this.modelMenuStates.clear()
    }

    return entries.length
  }

  countBindings(channel?: RemoteChannel): number {
    return this.listBindings(channel).length
  }

  getPollOffset(): number {
    return this.getTelegramConfig().pollOffset
  }

  setPollOffset(offset: number): void {
    this.updateTelegramConfig((config) => ({
      ...config,
      pollOffset: Math.max(0, Math.trunc(offset))
    }))
  }

  getAllowedUserIds(): number[] {
    return this.getTelegramConfig().allowlist
  }

  getTelegramDefaultAgentId(): string {
    return this.getTelegramConfig().defaultAgentId
  }

  getDefaultAgentId(): string {
    return this.getTelegramDefaultAgentId()
  }

  getFeishuDefaultAgentId(): string {
    return this.getFeishuConfig().defaultAgentId
  }

  isAllowedUser(userId: number | null | undefined): boolean {
    if (!userId) {
      return false
    }
    return this.getAllowedUserIds().includes(userId)
  }

  addAllowedUser(userId: number): void {
    this.updateTelegramConfig((config) => ({
      ...config,
      allowlist: Array.from(new Set([...config.allowlist, userId])).sort(
        (left, right) => left - right
      )
    }))
  }

  getFeishuPairedUserOpenIds(): string[] {
    return this.getFeishuConfig().pairedUserOpenIds
  }

  isFeishuPairedUser(openId: string | null | undefined): boolean {
    if (!openId) {
      return false
    }
    return this.getFeishuPairedUserOpenIds().includes(openId.trim())
  }

  addFeishuPairedUser(openId: string): void {
    const normalized = openId.trim()
    if (!normalized) {
      return
    }

    this.updateFeishuConfig((config) => ({
      ...config,
      pairedUserOpenIds: Array.from(new Set([...config.pairedUserOpenIds, normalized])).sort(
        (left, right) => left.localeCompare(right)
      )
    }))
  }

  getTelegramPairingState(): TelegramPairingState {
    return this.getTelegramConfig().pairing
  }

  getPairingState(): TelegramPairingState {
    return this.getTelegramPairingState()
  }

  getFeishuPairingState(): FeishuPairingState {
    return this.getFeishuConfig().pairing
  }

  getTelegramPairingSnapshot() {
    return buildTelegramPairingSnapshot(this.getTelegramConfig())
  }

  getFeishuPairingSnapshot() {
    return buildFeishuPairingSnapshot(this.getFeishuConfig())
  }

  createPairCode(channel: RemoteChannel = 'telegram'): { code: string; expiresAt: number } {
    const pairing = createPairCode()
    if (channel === 'telegram') {
      this.updateTelegramConfig((config) => ({
        ...config,
        pairing
      }))
    } else {
      this.updateFeishuConfig((config) => ({
        ...config,
        pairing
      }))
    }
    return pairing
  }

  clearPairCode(channel: RemoteChannel = 'telegram'): void {
    if (channel === 'telegram') {
      this.updateTelegramConfig((config) => ({
        ...config,
        pairing: {
          code: null,
          expiresAt: null
        }
      }))
      return
    }

    this.updateFeishuConfig((config) => ({
      ...config,
      pairing: {
        code: null,
        expiresAt: null
      }
    }))
  }

  rememberActiveEvent(endpointKey: string, eventId: string): void {
    this.activeEvents.set(endpointKey, eventId)
  }

  getActiveEvent(endpointKey: string): string | null {
    return this.activeEvents.get(endpointKey) ?? null
  }

  clearActiveEvent(endpointKey: string): void {
    this.activeEvents.delete(endpointKey)
  }

  rememberSessionSnapshot(endpointKey: string, sessionIds: string[]): void {
    this.sessionSnapshots.set(endpointKey, [...sessionIds])
  }

  getSessionSnapshot(endpointKey: string): string[] {
    return this.sessionSnapshots.get(endpointKey) ?? []
  }

  createModelMenuState(
    endpointKey: string,
    sessionId: string,
    providers: TelegramModelMenuState['providers']
  ): string {
    this.clearExpiredModelMenuStates()
    this.clearModelMenuStatesForEndpoint(endpointKey)
    const token = createTelegramCallbackToken()
    this.modelMenuStates.set(token, {
      endpointKey,
      sessionId,
      createdAt: Date.now(),
      providers: providers.map((provider) => ({
        ...provider,
        models: provider.models.map((model) => ({ ...model }))
      }))
    })
    return token
  }

  getModelMenuState(token: string, ttlMs: number): TelegramModelMenuState | null {
    this.clearExpiredModelMenuStates()
    const state = this.modelMenuStates.get(token)
    if (!state) {
      return null
    }

    if (Date.now() - state.createdAt > ttlMs) {
      this.modelMenuStates.delete(token)
      return null
    }

    return {
      ...state,
      providers: state.providers.map((provider) => ({
        ...provider,
        models: provider.models.map((model) => ({ ...model }))
      }))
    }
  }

  clearModelMenuState(token: string): void {
    this.modelMenuStates.delete(token)
  }

  private getChannelBindings(channel: RemoteChannel): Record<string, RemoteEndpointBinding> {
    const config = this.getChannelConfig(channel)
    return config.bindings
  }

  private updateBindings(
    channel: RemoteChannel,
    updater: (
      bindings: Record<string, RemoteEndpointBinding>
    ) => Record<string, RemoteEndpointBinding>
  ): void {
    if (channel === 'telegram') {
      this.updateTelegramConfig((config) => ({
        ...config,
        bindings: updater(config.bindings)
      }))
      return
    }

    this.updateFeishuConfig((config) => ({
      ...config,
      bindings: updater(config.bindings)
    }))
  }

  private resolveChannelFromEndpointKey(endpointKey: string): RemoteChannel | null {
    if (endpointKey.startsWith('telegram:')) {
      return 'telegram'
    }
    if (endpointKey.startsWith('feishu:')) {
      return 'feishu'
    }
    return null
  }

  private clearTransientStateForEndpoint(endpointKey: string): void {
    this.activeEvents.delete(endpointKey)
    this.sessionSnapshots.delete(endpointKey)
    this.clearModelMenuStatesForEndpoint(endpointKey)
  }

  private clearExpiredModelMenuStates(): void {
    const now = Date.now()
    for (const [token, state] of this.modelMenuStates.entries()) {
      if (now - state.createdAt > TELEGRAM_MODEL_MENU_TTL_MS) {
        this.modelMenuStates.delete(token)
      }
    }
  }

  private clearModelMenuStatesForEndpoint(endpointKey: string): void {
    for (const [token, state] of this.modelMenuStates.entries()) {
      if (state.endpointKey === endpointKey) {
        this.modelMenuStates.delete(token)
      }
    }
  }
}
