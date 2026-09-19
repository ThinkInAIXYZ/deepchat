import type { ChannelAdapterConfig, SendMessageOptions } from '../../runtime/types'
import { ChannelAdapter } from '../../runtime/adapter'
import type { FeishuRuntimeStatusSnapshot, FeishuTransportTarget } from '../../types'
import type { FeishuBrand } from '@shared/types/remote'
import { FeishuAuthGuard } from './authGuard'
import { RemoteBindingStore } from '../../binding/store'
import { RemoteConversationRunner } from '../../conversation/runner'
import { FeishuCommandRouter } from './commandRouter'
import { FeishuClient } from './feishuClient'
import { FeishuParser } from './feishuParser'
import { FeishuRuntime } from './feishuRuntime'
import logger from '@shared/logger'

const DEFAULT_STATUS: FeishuRuntimeStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

type FeishuAdapterDeps = {
  bindingStore: RemoteBindingStore
  createConversationRunner: () => RemoteConversationRunner
  onFatalError?: (message: string) => Promise<void> | void
  onDeliveryError?: (message: string) => void
  configSignature?: string
}

export class FeishuAdapter extends ChannelAdapter {
  private readonly bindingStore: RemoteBindingStore
  private readonly createConversationRunner: () => RemoteConversationRunner
  private readonly onFatalError?: (message: string) => Promise<void> | void
  private readonly onDeliveryError?: (message: string) => void
  private readonly credentials: {
    brand: FeishuBrand
    appId: string
    appSecret: string
    verificationToken: string
    encryptKey: string
  }
  private readonly enableStreamingCards: boolean
  private client: FeishuClient | null = null
  private runtime: FeishuRuntime | null = null
  private feishuStatus: FeishuRuntimeStatusSnapshot = { ...DEFAULT_STATUS }

  constructor(config: ChannelAdapterConfig, deps: FeishuAdapterDeps) {
    super(config, {
      configSignature: deps.configSignature
    })
    this.bindingStore = deps.bindingStore
    this.createConversationRunner = deps.createConversationRunner
    this.onFatalError = deps.onFatalError
    this.onDeliveryError = deps.onDeliveryError
    this.credentials = {
      brand: config.channelConfig.brand === 'lark' ? 'lark' : 'feishu',
      appId: String(config.channelConfig.appId ?? '').trim(),
      appSecret: String(config.channelConfig.appSecret ?? '').trim(),
      verificationToken: String(config.channelConfig.verificationToken ?? '').trim(),
      encryptKey: String(config.channelConfig.encryptKey ?? '').trim()
    }
    this.enableStreamingCards = config.channelConfig.enableStreamingCards === true
  }

  protected async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.credentials.appId || !this.credentials.appSecret) {
      throw new Error('App ID and App Secret are required.')
    }

    const client = new FeishuClient(this.credentials)
    const runtime = new FeishuRuntime({
      client,
      parser: new FeishuParser(),
      router: new FeishuCommandRouter({
        authGuard: new FeishuAuthGuard(this.bindingStore),
        runner: this.createConversationRunner(),
        bindingStore: this.bindingStore,
        getRuntimeStatus: () => ({ ...this.feishuStatus })
      }),
      bindingStore: this.bindingStore,
      enableStreamingCards: this.enableStreamingCards,
      logger,
      onStatusChange: (snapshot) => {
        this.handleStatusChange(snapshot)
      },
      onFatalError: (message) => {
        void this.onFatalError?.(message)
      },
      onDeliveryError: (message) => {
        this.onDeliveryError?.(message)
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

  async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('Feishu adapter is not connected.')
    }

    await this.client.sendText(this.parseTransportTarget(chatId, opts?.replyToMessageId), text)
  }

  async sendImage(chatId: string, imagePath: string, opts?: SendMessageOptions): Promise<string> {
    if (!this.client) {
      throw new Error('Feishu adapter is not connected.')
    }

    const messageId = await this.client.sendImage(
      this.parseTransportTarget(chatId, opts?.replyToMessageId),
      imagePath
    )
    if (!messageId) {
      throw new Error('Feishu image message_id is missing.')
    }

    return messageId
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    return
  }

  private handleStatusChange(snapshot: FeishuRuntimeStatusSnapshot): void {
    this.feishuStatus = { ...snapshot }
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

  private parseTransportTarget(
    chatId: string,
    replyToMessageId?: number | string
  ): FeishuTransportTarget {
    const [chatIdPart, threadIdPart] = chatId.split(':')
    const normalizedChatId = chatIdPart.trim()

    if (!normalizedChatId) {
      throw new Error(`Invalid Feishu chat id "${chatId}".`)
    }

    return {
      chatId: normalizedChatId,
      threadId: threadIdPart?.trim() || null,
      replyToMessageId:
        replyToMessageId === undefined || replyToMessageId === null
          ? null
          : String(replyToMessageId).trim() || null
    }
  }
}
