import type { IConfigPresenter, PairableRemoteChannel, RemoteChannel } from '@shared/presenter'
import {
  REMOTE_CONTROL_SETTING_KEY,
  TELEGRAM_INTERACTION_CALLBACK_TTL_MS,
  TELEGRAM_MODEL_MENU_TTL_MS,
  buildQQBotPairingSnapshot,
  normalizeRemoteControlConfig,
  createPairCode,
  createTelegramCallbackToken,
  buildFeishuPairingSnapshot,
  buildTelegramEndpointKey,
  buildTelegramPairingSnapshot,
  parseWeixinIlinkEndpointKey,
  type FeishuPairingState,
  type FeishuRemoteRuntimeConfig,
  type QQBotPairingState,
  type QQBotRemoteRuntimeConfig,
  type RemoteControlConfig,
  type RemoteEndpointBinding,
  type RemoteEndpointBindingMeta,
  type RemotePendingInteraction,
  type TelegramInboundEvent,
  type TelegramPendingInteractionState,
  type TelegramModelMenuState,
  type TelegramPairingState,
  type TelegramRemoteRuntimeConfig,
  type WeixinIlinkAccountRuntimeConfig,
  type WeixinIlinkRemoteRuntimeConfig
} from '../types'

export interface RemoteDeliveryState {
  sourceMessageId: string
  segments: Array<{
    key: string
    kind: 'process' | 'answer' | 'terminal'
    messageIds: Array<string | number | null>
    lastText: string
  }>
}

export class RemoteBindingStore {
  private readonly activeEvents = new Map<string, string>()
  private readonly sessionSnapshots = new Map<string, string[]>()
  private readonly modelMenuStates = new Map<string, TelegramModelMenuState>()
  private readonly pendingInteractionStates = new Map<string, TelegramPendingInteractionState>()
  private readonly remoteDeliveryStates = new Map<string, RemoteDeliveryState>()

  constructor(private readonly configPresenter: IConfigPresenter) {}

  getConfig(): RemoteControlConfig {
    return normalizeRemoteControlConfig(
      this.configPresenter.getSetting<RemoteControlConfig>(REMOTE_CONTROL_SETTING_KEY)
    )
  }

  getChannelConfig(channel: 'telegram'): TelegramRemoteRuntimeConfig
  getChannelConfig(channel: 'feishu'): FeishuRemoteRuntimeConfig
  getChannelConfig(channel: 'qqbot'): QQBotRemoteRuntimeConfig
  getChannelConfig(channel: 'weixin-ilink'): WeixinIlinkRemoteRuntimeConfig
  getChannelConfig(
    channel: RemoteChannel
  ):
    | TelegramRemoteRuntimeConfig
    | FeishuRemoteRuntimeConfig
    | QQBotRemoteRuntimeConfig
    | WeixinIlinkRemoteRuntimeConfig
  getChannelConfig(channel: RemoteChannel) {
    const config = this.getConfig()
    return channel === 'weixin-ilink' ? config.weixinIlink : config[channel]
  }

  getTelegramConfig(): TelegramRemoteRuntimeConfig {
    return this.getChannelConfig('telegram')
  }

  getFeishuConfig(): FeishuRemoteRuntimeConfig {
    return this.getChannelConfig('feishu')
  }

  getQQBotConfig(): QQBotRemoteRuntimeConfig {
    return this.getChannelConfig('qqbot')
  }

  getWeixinIlinkConfig(): WeixinIlinkRemoteRuntimeConfig {
    return this.getChannelConfig('weixin-ilink')
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

  updateQQBotConfig(
    updater: (config: QQBotRemoteRuntimeConfig) => QQBotRemoteRuntimeConfig
  ): QQBotRemoteRuntimeConfig {
    const current = this.getConfig()
    const next = normalizeRemoteControlConfig({
      ...current,
      qqbot: updater(current.qqbot)
    })
    this.configPresenter.setSetting(REMOTE_CONTROL_SETTING_KEY, next)
    return next.qqbot
  }

  updateWeixinIlinkConfig(
    updater: (config: WeixinIlinkRemoteRuntimeConfig) => WeixinIlinkRemoteRuntimeConfig
  ): WeixinIlinkRemoteRuntimeConfig {
    const current = this.getConfig()
    const next = normalizeRemoteControlConfig({
      ...current,
      weixinIlink: updater(current.weixinIlink)
    })
    this.configPresenter.setSetting(REMOTE_CONTROL_SETTING_KEY, next)
    return next.weixinIlink
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
    const resolvedChannel = this.resolveChannelFromEndpointKey(endpointKey)
    if (!resolvedChannel) {
      return
    }

    if (resolvedChannel === 'weixin-ilink') {
      const parsed = parseWeixinIlinkEndpointKey(endpointKey)
      if (!parsed) {
        return
      }

      this.updateWeixinIlinkAccount(parsed.accountId, (account) => ({
        ...account,
        bindings: {
          ...account.bindings,
          [endpointKey]: {
            sessionId,
            updatedAt: Date.now(),
            meta: meta
              ? {
                  ...meta,
                  channel: resolvedChannel
                }
              : account.bindings[endpointKey]?.meta
                ? {
                    ...account.bindings[endpointKey].meta,
                    channel: resolvedChannel
                  }
                : undefined
          }
        }
      }))
      this.clearTransientStateForEndpoint(endpointKey)
      return
    }

    this.updateBindings(resolvedChannel, (bindings) => ({
      ...bindings,
      [endpointKey]: {
        sessionId,
        updatedAt: Date.now(),
        meta: meta
          ? {
              ...meta,
              channel: resolvedChannel
            }
          : bindings[endpointKey]?.meta
            ? {
                ...bindings[endpointKey].meta,
                channel: resolvedChannel
              }
            : undefined
      }
    }))
    this.activeEvents.delete(endpointKey)
    this.clearModelMenuStatesForEndpoint(endpointKey)
    this.clearPendingInteractionStatesForEndpoint(endpointKey)
    this.clearRemoteDeliveryState(endpointKey)
  }

  clearBinding(endpointKey: string): void {
    const channel = this.resolveChannelFromEndpointKey(endpointKey)
    if (!channel) {
      return
    }

    if (channel === 'weixin-ilink') {
      const parsed = parseWeixinIlinkEndpointKey(endpointKey)
      if (!parsed) {
        return
      }

      this.updateWeixinIlinkAccount(parsed.accountId, (account) => {
        const nextBindings = { ...account.bindings }
        delete nextBindings[endpointKey]
        return {
          ...account,
          bindings: nextBindings
        }
      })
      this.clearTransientStateForEndpoint(endpointKey)
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
        ? (['telegram', 'feishu', 'qqbot', 'weixin-ilink'] as const).map(
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
    } else if (channel === 'qqbot') {
      this.updateQQBotConfig((config) => ({
        ...config,
        bindings: {}
      }))
    } else if (channel === 'weixin-ilink') {
      this.updateWeixinIlinkConfig((config) => ({
        ...config,
        accounts: config.accounts.map((account) => ({
          ...account,
          bindings: {}
        }))
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
      this.updateQQBotConfig((config) => ({
        ...config,
        bindings: {}
      }))
      this.updateWeixinIlinkConfig((config) => ({
        ...config,
        accounts: config.accounts.map((account) => ({
          ...account,
          bindings: {}
        }))
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

  getQQBotDefaultAgentId(): string {
    return this.getQQBotConfig().defaultAgentId
  }

  getWeixinIlinkDefaultAgentId(): string {
    return this.getWeixinIlinkConfig().defaultAgentId
  }

  getWeixinIlinkAccounts(): WeixinIlinkAccountRuntimeConfig[] {
    return this.getWeixinIlinkConfig().accounts.map((account) => ({
      ...account,
      bindings: { ...account.bindings }
    }))
  }

  getWeixinIlinkAccount(accountId: string): WeixinIlinkAccountRuntimeConfig | null {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) {
      return null
    }

    const account = this.getWeixinIlinkConfig().accounts.find(
      (entry) => entry.accountId === normalizedAccountId
    )
    return account
      ? {
          ...account,
          bindings: { ...account.bindings }
        }
      : null
  }

  upsertWeixinIlinkAccount(
    input: Pick<
      WeixinIlinkAccountRuntimeConfig,
      'accountId' | 'ownerUserId' | 'baseUrl' | 'botToken'
    > &
      Partial<
        Pick<
          WeixinIlinkAccountRuntimeConfig,
          'enabled' | 'syncCursor' | 'lastFatalError' | 'bindings'
        >
      >
  ): WeixinIlinkAccountRuntimeConfig {
    const normalizedAccountId = input.accountId.trim()
    const normalizedOwnerUserId = input.ownerUserId.trim()
    if (!normalizedAccountId || !normalizedOwnerUserId) {
      throw new Error('Weixin iLink accountId and ownerUserId are required.')
    }

    let nextAccount: WeixinIlinkAccountRuntimeConfig | null = null
    this.updateWeixinIlinkConfig((config) => {
      const accounts = [...config.accounts]
      const existingIndex = accounts.findIndex(
        (account) => account.accountId === normalizedAccountId
      )
      const existing = existingIndex >= 0 ? accounts[existingIndex] : null
      const merged: WeixinIlinkAccountRuntimeConfig = {
        accountId: normalizedAccountId,
        ownerUserId: normalizedOwnerUserId,
        baseUrl: input.baseUrl.trim() || existing?.baseUrl || 'https://ilinkai.weixin.qq.com',
        botToken: input.botToken.trim() || existing?.botToken || '',
        enabled: input.enabled ?? existing?.enabled ?? true,
        syncCursor: input.syncCursor ?? existing?.syncCursor ?? '',
        lastFatalError: input.lastFatalError ?? existing?.lastFatalError ?? null,
        bindings: input.bindings ?? existing?.bindings ?? {}
      }

      if (existingIndex >= 0) {
        accounts[existingIndex] = merged
      } else {
        accounts.push(merged)
      }

      nextAccount = merged
      return {
        ...config,
        accounts: accounts.sort((left, right) => left.accountId.localeCompare(right.accountId))
      }
    })

    return nextAccount!
  }

  updateWeixinIlinkAccount(
    accountId: string,
    updater: (account: WeixinIlinkAccountRuntimeConfig) => WeixinIlinkAccountRuntimeConfig
  ): WeixinIlinkAccountRuntimeConfig | null {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) {
      return null
    }

    let updatedAccount: WeixinIlinkAccountRuntimeConfig | null = null
    this.updateWeixinIlinkConfig((config) => {
      const index = config.accounts.findIndex(
        (account) => account.accountId === normalizedAccountId
      )
      if (index < 0) {
        return config
      }

      const nextAccounts = [...config.accounts]
      const nextAccount = updater(nextAccounts[index])
      updatedAccount = nextAccount
      nextAccounts[index] = nextAccount
      return {
        ...config,
        accounts: nextAccounts.sort((left, right) => left.accountId.localeCompare(right.accountId))
      }
    })

    return updatedAccount
  }

  removeWeixinIlinkAccount(accountId: string): void {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) {
      return
    }

    const bindings = this.getWeixinIlinkBindingsForAccount(normalizedAccountId)

    this.updateWeixinIlinkConfig((config) => ({
      ...config,
      accounts: config.accounts.filter((account) => account.accountId !== normalizedAccountId)
    }))

    for (const [endpointKey] of Object.entries(bindings)) {
      this.clearTransientStateForEndpoint(endpointKey)
    }
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

  getQQBotPairedUserIds(): string[] {
    return this.getQQBotConfig().pairedUserIds
  }

  getQQBotPairedGroupIds(): string[] {
    return this.getQQBotConfig().pairedGroupIds
  }

  isQQBotPairedUser(userId: string | null | undefined): boolean {
    if (!userId) {
      return false
    }

    return this.getQQBotPairedUserIds().includes(userId.trim())
  }

  isQQBotPairedGroup(groupId: string | null | undefined): boolean {
    if (!groupId) {
      return false
    }

    return this.getQQBotPairedGroupIds().includes(groupId.trim())
  }

  addQQBotPairedUser(userId: string): void {
    const normalized = userId.trim()
    if (!normalized) {
      return
    }

    this.updateQQBotConfig((config) => ({
      ...config,
      pairedUserIds: Array.from(new Set([...config.pairedUserIds, normalized])).sort((a, b) =>
        a.localeCompare(b)
      )
    }))
  }

  addQQBotPairedGroup(groupId: string): void {
    const normalized = groupId.trim()
    if (!normalized) {
      return
    }

    this.updateQQBotConfig((config) => ({
      ...config,
      pairedGroupIds: Array.from(new Set([...config.pairedGroupIds, normalized])).sort((a, b) =>
        a.localeCompare(b)
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

  getQQBotPairingState(): QQBotPairingState {
    return this.getQQBotConfig().pairing
  }

  getTelegramPairingSnapshot() {
    return buildTelegramPairingSnapshot(this.getTelegramConfig())
  }

  getFeishuPairingSnapshot() {
    return buildFeishuPairingSnapshot(this.getFeishuConfig())
  }

  getQQBotPairingSnapshot() {
    return buildQQBotPairingSnapshot(this.getQQBotConfig())
  }

  createPairCode(channel: PairableRemoteChannel = 'telegram'): { code: string; expiresAt: number } {
    const pairing = createPairCode()
    if (channel === 'telegram') {
      this.updateTelegramConfig((config) => ({
        ...config,
        pairing
      }))
    } else if (channel === 'feishu') {
      this.updateFeishuConfig((config) => ({
        ...config,
        pairing
      }))
    } else {
      this.updateQQBotConfig((config) => ({
        ...config,
        pairing
      }))
    }
    return {
      code: pairing.code!,
      expiresAt: pairing.expiresAt!
    }
  }

  clearPairCode(channel: PairableRemoteChannel = 'telegram'): void {
    if (channel === 'telegram') {
      this.updateTelegramConfig((config) => ({
        ...config,
        pairing: {
          code: null,
          expiresAt: null,
          failedAttempts: 0
        }
      }))
      return
    }

    if (channel === 'feishu') {
      this.updateFeishuConfig((config) => ({
        ...config,
        pairing: {
          code: null,
          expiresAt: null,
          failedAttempts: 0
        }
      }))
      return
    }

    this.updateQQBotConfig((config) => ({
      ...config,
      pairing: {
        code: null,
        expiresAt: null,
        failedAttempts: 0
      }
    }))
  }

  recordPairCodeFailure(
    channel: PairableRemoteChannel,
    maxAttempts: number
  ): { attempts: number; exhausted: boolean } {
    let result = {
      attempts: 0,
      exhausted: false
    }

    if (channel === 'telegram') {
      this.updateTelegramConfig((config) => {
        const attempts = config.pairing.failedAttempts + 1
        const exhausted = attempts >= maxAttempts
        result = {
          attempts,
          exhausted
        }

        return {
          ...config,
          pairing: exhausted
            ? {
                code: null,
                expiresAt: null,
                failedAttempts: 0
              }
            : {
                ...config.pairing,
                failedAttempts: attempts
              }
        }
      })
    } else if (channel === 'feishu') {
      this.updateFeishuConfig((config) => {
        const attempts = config.pairing.failedAttempts + 1
        const exhausted = attempts >= maxAttempts
        result = {
          attempts,
          exhausted
        }

        return {
          ...config,
          pairing: exhausted
            ? {
                code: null,
                expiresAt: null,
                failedAttempts: 0
              }
            : {
                ...config.pairing,
                failedAttempts: attempts
              }
        }
      })
    } else {
      this.updateQQBotConfig((config) => {
        const attempts = config.pairing.failedAttempts + 1
        const exhausted = attempts >= maxAttempts
        result = {
          attempts,
          exhausted
        }

        return {
          ...config,
          pairing: exhausted
            ? {
                code: null,
                expiresAt: null,
                failedAttempts: 0
              }
            : {
                ...config.pairing,
                failedAttempts: attempts
              }
        }
      })
    }

    return result
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

  rememberRemoteDeliveryState(endpointKey: string, state: RemoteDeliveryState): void {
    this.remoteDeliveryStates.set(endpointKey, {
      sourceMessageId: state.sourceMessageId,
      segments: state.segments.map((segment) => ({
        key: segment.key,
        kind: segment.kind,
        messageIds: [...segment.messageIds],
        lastText: segment.lastText
      }))
    })
  }

  getRemoteDeliveryState(endpointKey: string): RemoteDeliveryState | null {
    const state = this.remoteDeliveryStates.get(endpointKey)
    if (!state) {
      return null
    }

    return {
      sourceMessageId: state.sourceMessageId,
      segments: state.segments.map((segment) => ({
        key: segment.key,
        kind: segment.kind,
        messageIds: [...segment.messageIds],
        lastText: segment.lastText
      }))
    }
  }

  clearRemoteDeliveryState(endpointKey: string): void {
    this.remoteDeliveryStates.delete(endpointKey)
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

  createPendingInteractionState(
    endpointKey: string,
    interaction: Pick<RemotePendingInteraction, 'messageId' | 'toolCallId'>
  ): string {
    this.clearExpiredPendingInteractionStates()
    this.clearPendingInteractionStatesForEndpoint(endpointKey)
    const token = createTelegramCallbackToken()
    this.pendingInteractionStates.set(token, {
      endpointKey,
      createdAt: Date.now(),
      messageId: interaction.messageId,
      toolCallId: interaction.toolCallId
    })
    return token
  }

  getPendingInteractionState(token: string, ttlMs: number = TELEGRAM_INTERACTION_CALLBACK_TTL_MS) {
    this.clearExpiredPendingInteractionStates()
    const state = this.pendingInteractionStates.get(token)
    if (!state) {
      return null
    }

    if (Date.now() - state.createdAt > ttlMs) {
      this.pendingInteractionStates.delete(token)
      return null
    }

    return {
      ...state
    }
  }

  clearPendingInteractionState(token: string): void {
    this.pendingInteractionStates.delete(token)
  }

  private getChannelBindings(channel: RemoteChannel): Record<string, RemoteEndpointBinding> {
    if (channel === 'weixin-ilink') {
      return this.getWeixinIlinkAccounts().reduce<Record<string, RemoteEndpointBinding>>(
        (bindings, account) => ({
          ...bindings,
          ...account.bindings
        }),
        {}
      )
    }

    if (channel === 'telegram') {
      return this.getTelegramConfig().bindings
    }

    if (channel === 'feishu') {
      return this.getFeishuConfig().bindings
    }

    return this.getQQBotConfig().bindings
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

    if (channel === 'feishu') {
      this.updateFeishuConfig((config) => ({
        ...config,
        bindings: updater(config.bindings)
      }))
      return
    }

    if (channel === 'qqbot') {
      this.updateQQBotConfig((config) => ({
        ...config,
        bindings: updater(config.bindings)
      }))
      return
    }
  }

  private resolveChannelFromEndpointKey(endpointKey: string): RemoteChannel | null {
    if (endpointKey.startsWith('telegram:')) {
      return 'telegram'
    }
    if (endpointKey.startsWith('feishu:')) {
      return 'feishu'
    }
    if (endpointKey.startsWith('qqbot:')) {
      return 'qqbot'
    }
    if (endpointKey.startsWith('weixin-ilink:')) {
      return 'weixin-ilink'
    }
    return null
  }

  private getWeixinIlinkBindingsForAccount(
    accountId: string
  ): Record<string, RemoteEndpointBinding> {
    return this.getWeixinIlinkAccount(accountId)?.bindings ?? {}
  }

  private clearTransientStateForEndpoint(endpointKey: string): void {
    this.activeEvents.delete(endpointKey)
    this.sessionSnapshots.delete(endpointKey)
    this.clearModelMenuStatesForEndpoint(endpointKey)
    this.clearPendingInteractionStatesForEndpoint(endpointKey)
    this.clearRemoteDeliveryState(endpointKey)
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

  private clearExpiredPendingInteractionStates(): void {
    const now = Date.now()
    for (const [token, state] of this.pendingInteractionStates.entries()) {
      if (now - state.createdAt > TELEGRAM_INTERACTION_CALLBACK_TTL_MS) {
        this.pendingInteractionStates.delete(token)
      }
    }
  }

  private clearPendingInteractionStatesForEndpoint(endpointKey: string): void {
    for (const [token, state] of this.pendingInteractionStates.entries()) {
      if (state.endpointKey === endpointKey) {
        this.pendingInteractionStates.delete(token)
      }
    }
  }
}
