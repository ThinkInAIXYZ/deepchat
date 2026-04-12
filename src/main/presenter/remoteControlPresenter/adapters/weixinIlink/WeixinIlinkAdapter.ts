import type { ChannelAdapterConfig, SendMessageOptions } from '../../types/channel'
import { ChannelAdapter } from '../../channelAdapter'
import type { WeixinIlinkRuntimeStatusSnapshot } from '../../types'
import { RemoteBindingStore } from '../../services/remoteBindingStore'
import { RemoteConversationRunner } from '../../services/remoteConversationRunner'
import { WeixinIlinkAuthGuard } from '../../services/weixinIlinkAuthGuard'
import { WeixinIlinkCommandRouter } from '../../services/weixinIlinkCommandRouter'
import { WeixinIlinkClient } from '../../weixinIlink/weixinIlinkClient'
import { WeixinIlinkParser } from '../../weixinIlink/weixinIlinkParser'
import { WeixinIlinkRuntime } from '../../weixinIlink/weixinIlinkRuntime'
import logger from '@shared/logger'

const DEFAULT_STATUS: WeixinIlinkRuntimeStatusSnapshot = {
  state: 'stopped',
  lastError: null,
  botUser: null
}
const WEIXIN_TRACE_LOG_ENABLED = process.env.DEEPCHAT_WEIXIN_TRACE === '1'

type WeixinIlinkAdapterDeps = {
  bindingStore: RemoteBindingStore
  createConversationRunner: () => RemoteConversationRunner
  onFatalError?: (accountId: string, message: string) => Promise<void> | void
  configSignature?: string
}

export class WeixinIlinkAdapter extends ChannelAdapter {
  private readonly bindingStore: RemoteBindingStore
  private readonly createConversationRunner: () => RemoteConversationRunner
  private readonly onFatalError?: (accountId: string, message: string) => Promise<void> | void
  private readonly credentials: {
    accountId: string
    ownerUserId: string
    baseUrl: string
    botToken: string
  }
  private client: WeixinIlinkClient | null = null
  private runtime: WeixinIlinkRuntime | null = null
  private weixinStatus: WeixinIlinkRuntimeStatusSnapshot = { ...DEFAULT_STATUS }

  constructor(config: ChannelAdapterConfig, deps: WeixinIlinkAdapterDeps) {
    super(config, {
      configSignature: deps.configSignature
    })
    this.bindingStore = deps.bindingStore
    this.createConversationRunner = deps.createConversationRunner
    this.onFatalError = deps.onFatalError
    this.credentials = {
      accountId: config.channelId,
      ownerUserId: String(config.channelConfig.ownerUserId ?? '').trim(),
      baseUrl:
        String(config.channelConfig.baseUrl ?? '').trim() || WeixinIlinkClient.DEFAULT_BASE_URL,
      botToken: String(config.channelConfig.botToken ?? '').trim()
    }
  }

  protected async performConnect(_signal: AbortSignal): Promise<void> {
    this.emitTraceLog('Connecting Weixin iLink adapter.', {
      accountId: this.credentials.accountId,
      ownerUserId: this.credentials.ownerUserId,
      baseUrl: this.credentials.baseUrl
    })

    if (
      !this.credentials.accountId ||
      !this.credentials.ownerUserId ||
      !this.credentials.botToken
    ) {
      throw new Error('Weixin iLink account credentials are incomplete.')
    }

    const client = new WeixinIlinkClient({
      accountId: this.credentials.accountId,
      baseUrl: this.credentials.baseUrl,
      botToken: this.credentials.botToken
    })
    const runtime = new WeixinIlinkRuntime({
      accountId: this.credentials.accountId,
      ownerUserId: this.credentials.ownerUserId,
      baseUrl: this.credentials.baseUrl,
      client,
      parser: new WeixinIlinkParser(),
      router: new WeixinIlinkCommandRouter({
        authGuard: new WeixinIlinkAuthGuard(this.bindingStore),
        runner: this.createConversationRunner(),
        bindingStore: this.bindingStore,
        getRuntimeStatus: () => ({ ...this.weixinStatus })
      }),
      bindingStore: this.bindingStore,
      logger,
      onStatusChange: (snapshot) => {
        this.handleStatusChange(snapshot)
      },
      onFatalError: (message) => {
        void this.onFatalError?.(this.credentials.accountId, message)
      }
    })

    this.client = client
    this.runtime = runtime
    this.handleStatusChange({
      state: 'starting',
      lastError: null,
      botUser: {
        accountId: this.credentials.accountId,
        ownerUserId: this.credentials.ownerUserId,
        baseUrl: this.credentials.baseUrl
      }
    })

    try {
      await runtime.start()
      this.emitTraceLog('Weixin iLink adapter connected.', {
        accountId: this.credentials.accountId
      })
    } catch (error) {
      this.client = null
      this.runtime = null
      throw error
    }
  }

  protected async performDisconnect(): Promise<void> {
    this.emitTraceLog('Disconnecting Weixin iLink adapter.', {
      accountId: this.credentials.accountId
    })
    const runtime = this.runtime
    this.runtime = null
    this.client = null

    if (!runtime) {
      return
    }

    await runtime.stop()
    this.handleStatusChange(runtime.getStatusSnapshot())
    this.emitTraceLog('Weixin iLink adapter disconnected.', {
      accountId: this.credentials.accountId
    })
  }

  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('Weixin iLink adapter is not connected.')
    }

    const userId = chatId.trim()
    if (!userId) {
      throw new Error('Invalid Weixin iLink transport target.')
    }

    await this.client.sendTextMessage({
      toUserId: userId,
      text
    })
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.client) {
      return
    }

    const userId = chatId.trim()
    if (!userId) {
      return
    }

    const response = await this.client.getConfig({
      ilinkUserId: userId
    })
    const typingTicket = response.typing_ticket?.trim()
    if (!typingTicket) {
      return
    }

    await this.client.sendTyping({
      ilinkUserId: userId,
      typingTicket,
      status: 1
    })
  }

  private handleStatusChange(snapshot: WeixinIlinkRuntimeStatusSnapshot): void {
    this.weixinStatus = {
      ...snapshot,
      botUser: snapshot.botUser ? { ...snapshot.botUser } : null
    }
    this.setStatus({
      connected:
        snapshot.state === 'starting' ||
        snapshot.state === 'running' ||
        snapshot.state === 'backoff',
      state: snapshot.state,
      lastError: snapshot.lastError,
      botUser: snapshot.botUser ? { ...snapshot.botUser } : null
    })
  }

  private emitTraceLog(message: string, context?: Record<string, unknown>): void {
    if (!WEIXIN_TRACE_LOG_ENABLED) {
      return
    }

    this.emitLog('info', message, context)
  }
}
