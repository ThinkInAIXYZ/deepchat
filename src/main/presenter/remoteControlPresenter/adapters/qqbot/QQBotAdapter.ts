import type { ChannelAdapterConfig, SendMessageOptions } from '../../types/channel'
import { ChannelAdapter } from '../../channelAdapter'
import type { QQBotRuntimeStatusSnapshot, QQBotTransportTarget } from '../../types'
import { QQBotAuthGuard } from '../../services/qqbotAuthGuard'
import { RemoteBindingStore } from '../../services/remoteBindingStore'
import { RemoteConversationRunner } from '../../services/remoteConversationRunner'
import { QQBotCommandRouter } from '../../services/qqbotCommandRouter'
import { QQBotClient } from '../../qqbot/qqbotClient'
import { QQBotParser } from '../../qqbot/qqbotParser'
import { QQBotRuntime } from '../../qqbot/qqbotRuntime'
import logger from '@shared/logger'

const DEFAULT_STATUS: QQBotRuntimeStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}

type QQBotAdapterDeps = {
  bindingStore: RemoteBindingStore
  createConversationRunner: () => RemoteConversationRunner
  onFatalError?: (message: string) => Promise<void> | void
  configSignature?: string
}

export class QQBotAdapter extends ChannelAdapter {
  private readonly bindingStore: RemoteBindingStore
  private readonly createConversationRunner: () => RemoteConversationRunner
  private readonly onFatalError?: (message: string) => Promise<void> | void
  private readonly credentials: {
    appId: string
    clientSecret: string
  }
  private client: QQBotClient | null = null
  private runtime: QQBotRuntime | null = null
  private qqbotStatus: QQBotRuntimeStatusSnapshot = { ...DEFAULT_STATUS }

  constructor(config: ChannelAdapterConfig, deps: QQBotAdapterDeps) {
    super(config, {
      configSignature: deps.configSignature
    })
    this.bindingStore = deps.bindingStore
    this.createConversationRunner = deps.createConversationRunner
    this.onFatalError = deps.onFatalError
    this.credentials = {
      appId: String(config.channelConfig.appId ?? '').trim(),
      clientSecret: String(config.channelConfig.clientSecret ?? '').trim()
    }
  }

  protected async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.credentials.appId || !this.credentials.clientSecret) {
      throw new Error('App ID and Client Secret are required.')
    }

    const client = new QQBotClient(this.credentials)
    const runtime = new QQBotRuntime({
      client,
      parser: new QQBotParser(),
      router: new QQBotCommandRouter({
        authGuard: new QQBotAuthGuard(this.bindingStore),
        runner: this.createConversationRunner(),
        bindingStore: this.bindingStore,
        getRuntimeStatus: () => ({ ...this.qqbotStatus })
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

  async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('QQBot adapter is not connected.')
    }

    const target = this.parseTransportTarget(chatId, opts?.replyToMessageId)
    if (target.chatType === 'c2c') {
      await this.client.sendC2CMessage({
        openId: target.openId,
        msgId: target.msgId,
        msgSeq: 1,
        content: text
      })
      return
    }

    await this.client.sendGroupMessage({
      groupOpenId: target.openId,
      msgId: target.msgId,
      msgSeq: 1,
      content: text
    })
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    return
  }

  private handleStatusChange(snapshot: QQBotRuntimeStatusSnapshot): void {
    this.qqbotStatus = { ...snapshot }
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
  ): QQBotTransportTarget {
    const [chatTypePart, openIdPart, msgIdPart] = chatId.split(':')
    const chatType = chatTypePart?.trim()
    const openId = openIdPart?.trim() || ''
    const msgId =
      replyToMessageId === undefined || replyToMessageId === null
        ? msgIdPart?.trim() || ''
        : String(replyToMessageId).trim()

    if ((chatType !== 'c2c' && chatType !== 'group') || !openId || !msgId) {
      throw new Error(`Invalid QQBot transport target "${chatId}".`)
    }

    return {
      chatType,
      openId,
      msgId
    }
  }
}
