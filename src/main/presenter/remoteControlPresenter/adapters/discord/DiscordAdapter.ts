import type { ChannelAdapterConfig, SendMessageOptions } from '../../types/channel'
import { ChannelAdapter } from '../../channelAdapter'
import type { DiscordRuntimeStatusSnapshot, DiscordTransportTarget } from '../../types'
import { DiscordAuthGuard } from '../../services/discordAuthGuard'
import { RemoteBindingStore } from '../../services/remoteBindingStore'
import { RemoteConversationRunner } from '../../services/remoteConversationRunner'
import { DiscordCommandRouter } from '../../services/discordCommandRouter'
import { DiscordClient } from '../../discord/discordClient'
import { DiscordParser } from '../../discord/discordParser'
import { DiscordRuntime } from '../../discord/discordRuntime'
import logger from '@shared/logger'

const DEFAULT_STATUS: DiscordRuntimeStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

type DiscordAdapterDeps = {
  bindingStore: RemoteBindingStore
  createConversationRunner: () => RemoteConversationRunner
  onFatalError?: (message: string) => Promise<void> | void
  configSignature?: string
}

export class DiscordAdapter extends ChannelAdapter {
  private readonly bindingStore: RemoteBindingStore
  private readonly createConversationRunner: () => RemoteConversationRunner
  private readonly onFatalError?: (message: string) => Promise<void> | void
  private readonly credentials: {
    botToken: string
  }
  private client: DiscordClient | null = null
  private runtime: DiscordRuntime | null = null
  private discordStatus: DiscordRuntimeStatusSnapshot = { ...DEFAULT_STATUS }

  constructor(config: ChannelAdapterConfig, deps: DiscordAdapterDeps) {
    super(config, {
      configSignature: deps.configSignature
    })
    this.bindingStore = deps.bindingStore
    this.createConversationRunner = deps.createConversationRunner
    this.onFatalError = deps.onFatalError
    this.credentials = {
      botToken: String(config.channelConfig.botToken ?? '').trim()
    }
  }

  protected async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.credentials.botToken) {
      throw new Error('Bot token is required.')
    }

    const client = new DiscordClient(this.credentials)
    const runtime = new DiscordRuntime({
      client,
      parser: new DiscordParser(),
      router: new DiscordCommandRouter({
        authGuard: new DiscordAuthGuard(this.bindingStore),
        runner: this.createConversationRunner(),
        bindingStore: this.bindingStore,
        getRuntimeStatus: () => ({ ...this.discordStatus })
      }),
      bindingStore: this.bindingStore,
      logger,
      onStatusChange: (snapshot) => {
        this.handleStatusChange(snapshot)
      },
      onFatalError: (message) => {
        void this.onFatalError?.(message)
      }
    })

    this.client = client
    this.runtime = runtime
    this.handleStatusChange({
      state: 'starting',
      lastError: null,
      botUser: null
    })

    try {
      await runtime.start()
    } catch (error) {
      this.client = null
      this.runtime = null
      throw error
    }
  }

  protected async performDisconnect(): Promise<void> {
    const runtime = this.runtime
    this.runtime = null
    this.client = null

    if (!runtime) {
      return
    }

    await runtime.stop()
    this.handleStatusChange(runtime.getStatusSnapshot())
  }

  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('Discord adapter is not connected.')
    }

    const target = this.parseTransportTarget(chatId)
    await this.client.sendMessage(target.channelId, text)
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Discord adapter is not connected.')
    }

    const target = this.parseTransportTarget(chatId)
    await this.client.sendTypingIndicator(target.channelId)
  }

  private handleStatusChange(snapshot: DiscordRuntimeStatusSnapshot): void {
    this.discordStatus = { ...snapshot }
    this.setStatus({
      connected:
        snapshot.state === 'starting' ||
        snapshot.state === 'running' ||
        snapshot.state === 'backoff',
      state: snapshot.state,
      lastError: snapshot.lastError,
      botUser: snapshot.botUser
    })
  }

  private parseTransportTarget(chatId: string): DiscordTransportTarget {
    const parts = chatId.split(':')
    if (parts.length !== 2) {
      throw new Error(`Invalid Discord transport target "${chatId}".`)
    }

    const [chatTypePart, channelIdPart] = parts
    const normalizedChatType = chatTypePart?.trim()
    const normalizedChannelId = channelIdPart?.trim() || ''

    if ((normalizedChatType !== 'dm' && normalizedChatType !== 'channel') || !normalizedChannelId) {
      throw new Error(`Invalid Discord transport target "${chatId}".`)
    }

    return {
      chatType: normalizedChatType,
      channelId: normalizedChannelId
    }
  }
}
