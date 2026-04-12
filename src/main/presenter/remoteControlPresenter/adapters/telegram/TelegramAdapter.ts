import type { ChannelAdapterConfig, SendMessageOptions } from '../../types/channel'
import { ChannelAdapter } from '../../channelAdapter'
import type { TelegramPollerStatusSnapshot, TelegramTransportTarget } from '../../types'
import { RemoteAuthGuard } from '../../services/remoteAuthGuard'
import { RemoteBindingStore } from '../../services/remoteBindingStore'
import { RemoteConversationRunner } from '../../services/remoteConversationRunner'
import { RemoteCommandRouter } from '../../services/remoteCommandRouter'
import { TelegramClient } from '../../telegram/telegramClient'
import { TelegramParser } from '../../telegram/telegramParser'
import { TelegramPoller } from '../../telegram/telegramPoller'

const DEFAULT_STATUS: TelegramPollerStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

type TelegramAdapterDeps = {
  bindingStore: RemoteBindingStore
  createConversationRunner: () => RemoteConversationRunner
  registerTelegramCommands: (client: TelegramClient) => Promise<void>
  onFatalError?: (message: string) => Promise<void> | void
  configSignature?: string
}

export class TelegramAdapter extends ChannelAdapter {
  private readonly bindingStore: RemoteBindingStore
  private readonly createConversationRunner: () => RemoteConversationRunner
  private readonly registerTelegramCommands: (client: TelegramClient) => Promise<void>
  private readonly onFatalError?: (message: string) => Promise<void> | void
  private readonly botToken: string
  private client: TelegramClient | null = null
  private poller: TelegramPoller | null = null
  private telegramStatus: TelegramPollerStatusSnapshot = { ...DEFAULT_STATUS }

  constructor(config: ChannelAdapterConfig, deps: TelegramAdapterDeps) {
    super(config, {
      configSignature: deps.configSignature
    })
    this.bindingStore = deps.bindingStore
    this.createConversationRunner = deps.createConversationRunner
    this.registerTelegramCommands = deps.registerTelegramCommands
    this.onFatalError = deps.onFatalError
    this.botToken = String(config.channelConfig.botToken ?? '').trim()
  }

  protected async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.botToken) {
      throw new Error('Bot token is required.')
    }

    const client = new TelegramClient(this.botToken)
    await this.registerTelegramCommands(client)

    const router = new RemoteCommandRouter({
      authGuard: new RemoteAuthGuard(this.bindingStore),
      runner: this.createConversationRunner(),
      bindingStore: this.bindingStore,
      getPollerStatus: () => ({ ...this.telegramStatus })
    })

    const poller = new TelegramPoller({
      client,
      parser: new TelegramParser(),
      router,
      bindingStore: this.bindingStore,
      onStatusChange: (snapshot) => {
        this.handleStatusChange(snapshot)
      },
      onFatalError: (message) => {
        void this.onFatalError?.(message)
      }
    })

    this.client = client
    this.poller = poller
    this.handleStatusChange({
      state: 'starting',
      lastError: null,
      botUser: null
    })

    try {
      await poller.start()
    } catch (error) {
      this.client = null
      this.poller = null
      throw error
    }
  }

  protected async performDisconnect(): Promise<void> {
    const poller = this.poller
    this.poller = null
    this.client = null

    if (!poller) {
      return
    }

    await poller.stop()
    this.handleStatusChange(poller.getStatusSnapshot())
  }

  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('Telegram adapter is not connected.')
    }

    await this.client.sendMessage(this.parseTransportTarget(chatId), text)
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Telegram adapter is not connected.')
    }

    await this.client.sendChatAction(this.parseTransportTarget(chatId), 'typing')
  }

  private handleStatusChange(snapshot: TelegramPollerStatusSnapshot): void {
    this.telegramStatus = { ...snapshot }
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

  private parseTransportTarget(chatId: string): TelegramTransportTarget {
    const [chatIdPart, messageThreadIdPart] = chatId.split(':')
    const normalizedChatIdPart = chatIdPart.trim()
    const normalizedMessageThreadIdPart = messageThreadIdPart?.trim() ?? ''

    if (!/^-?\d+$/.test(normalizedChatIdPart)) {
      throw new Error(`Invalid Telegram chat id "${chatId}".`)
    }

    if (normalizedMessageThreadIdPart && !/^\d+$/.test(normalizedMessageThreadIdPart)) {
      throw new Error(`Invalid Telegram chat id "${chatId}".`)
    }

    return {
      chatId: Number.parseInt(normalizedChatIdPart, 10),
      messageThreadId: normalizedMessageThreadIdPart
        ? Number.parseInt(normalizedMessageThreadIdPart, 10)
        : 0
    }
  }
}
