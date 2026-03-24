import type { IConfigPresenter } from '@shared/presenter'
import {
  REMOTE_CONTROL_SETTING_KEY,
  TELEGRAM_MODEL_MENU_TTL_MS,
  buildTelegramEndpointKey,
  normalizeRemoteControlConfig,
  createPairCode,
  createTelegramCallbackToken,
  buildTelegramPairingSnapshot,
  type RemoteControlConfig,
  type TelegramEndpointBinding,
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

  getTelegramConfig(): TelegramRemoteRuntimeConfig {
    return this.getConfig().telegram
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

  getEndpointKey(
    target: { chatId: number; messageThreadId?: number } | TelegramInboundEvent
  ): string {
    return buildTelegramEndpointKey(target.chatId, target.messageThreadId ?? 0)
  }

  getBinding(endpointKey: string): TelegramEndpointBinding | null {
    return this.getTelegramConfig().bindings[endpointKey] ?? null
  }

  setBinding(endpointKey: string, sessionId: string): void {
    this.updateTelegramConfig((config) => ({
      ...config,
      bindings: {
        ...config.bindings,
        [endpointKey]: {
          sessionId,
          updatedAt: Date.now()
        }
      }
    }))
    this.activeEvents.delete(endpointKey)
    this.clearModelMenuStatesForEndpoint(endpointKey)
  }

  clearBinding(endpointKey: string): void {
    this.updateTelegramConfig((config) => {
      const bindings = { ...config.bindings }
      delete bindings[endpointKey]
      return {
        ...config,
        bindings
      }
    })
    this.activeEvents.delete(endpointKey)
    this.sessionSnapshots.delete(endpointKey)
    this.clearModelMenuStatesForEndpoint(endpointKey)
  }

  listBindings(): Array<{
    endpointKey: string
    binding: TelegramEndpointBinding
  }> {
    return Object.entries(this.getTelegramConfig().bindings).map(([endpointKey, binding]) => ({
      endpointKey,
      binding
    }))
  }

  clearBindings(): number {
    const count = Object.keys(this.getTelegramConfig().bindings).length
    this.updateTelegramConfig((config) => ({
      ...config,
      bindings: {}
    }))
    this.activeEvents.clear()
    this.sessionSnapshots.clear()
    this.modelMenuStates.clear()
    return count
  }

  countBindings(): number {
    return Object.keys(this.getTelegramConfig().bindings).length
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

  getDefaultAgentId(): string {
    return this.getTelegramConfig().defaultAgentId
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

  getPairingState(): TelegramPairingState {
    return this.getTelegramConfig().pairing
  }

  getPairingSnapshot() {
    return buildTelegramPairingSnapshot(this.getTelegramConfig())
  }

  createPairCode(): { code: string; expiresAt: number } {
    const pairing = createPairCode()
    this.updateTelegramConfig((config) => ({
      ...config,
      pairing
    }))
    return pairing
  }

  clearPairCode(): void {
    this.updateTelegramConfig((config) => ({
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
