import * as Lark from '@larksuiteoapi/node-sdk'
import type { EventHandles } from '@larksuiteoapi/node-sdk'
import {
  FEISHU_OUTBOUND_TEXT_LIMIT,
  type FeishuInteractiveCardPayload,
  type FeishuTransportTarget
} from '../types'

export type FeishuRawMessageEvent = Parameters<
  NonNullable<EventHandles['im.message.receive_v1']>
>[0]

export interface FeishuBotIdentity {
  openId: string
  name?: string
}

const createTextPayload = (text: string): string =>
  JSON.stringify({
    text
  })

const createCardPayload = (card: FeishuInteractiveCardPayload): string => JSON.stringify(card)

export const chunkFeishuText = (
  text: string,
  limit: number = FEISHU_OUTBOUND_TEXT_LIMIT
): string[] => {
  const normalized = text.trim() || '(No text output)'
  if (normalized.length <= limit) {
    return [normalized]
  }

  const chunks: string[] = []
  let remaining = normalized

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit)
    const splitIndex = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'))
    const nextIndex = splitIndex > Math.floor(limit * 0.55) ? splitIndex : limit
    chunks.push(remaining.slice(0, nextIndex).trim())
    remaining = remaining.slice(nextIndex).trim()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}

export class FeishuClient {
  private readonly sdk: Lark.Client
  private wsClient: Lark.WSClient | null = null

  constructor(
    private readonly credentials: {
      appId: string
      appSecret: string
      verificationToken: string
      encryptKey: string
    }
  ) {
    this.sdk = new Lark.Client({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      appType: Lark.AppType.SelfBuild
    })
  }

  async probeBot(): Promise<FeishuBotIdentity> {
    const response = await (this.sdk as any).request({
      method: 'GET',
      url: '/open-apis/bot/v3/info',
      data: {}
    })

    if (response?.code !== 0) {
      throw new Error(response?.msg?.trim() || 'Failed to fetch Feishu bot info.')
    }

    const bot = response?.bot || response?.data?.bot
    const openId = bot?.open_id?.trim()
    if (!openId) {
      throw new Error('Feishu bot open_id is missing from bot/v3/info response.')
    }

    return {
      openId,
      name: bot?.bot_name?.trim() || undefined
    }
  }

  async startMessageStream(params: {
    onMessage: (event: FeishuRawMessageEvent) => Promise<void>
  }): Promise<void> {
    this.stop()

    const dispatcherOptions: {
      encryptKey?: string
      verificationToken?: string
    } = {}

    if (this.credentials.encryptKey.trim()) {
      dispatcherOptions.encryptKey = this.credentials.encryptKey
    }

    if (this.credentials.verificationToken.trim()) {
      dispatcherOptions.verificationToken = this.credentials.verificationToken
    }

    const dispatcher = new Lark.EventDispatcher(dispatcherOptions)

    dispatcher.register({
      'im.message.receive_v1': async (event: FeishuRawMessageEvent) => {
        await params.onMessage(event)
      }
    })

    this.wsClient = new Lark.WSClient({
      appId: this.credentials.appId,
      appSecret: this.credentials.appSecret,
      loggerLevel: Lark.LoggerLevel.info
    })

    await this.wsClient.start({
      eventDispatcher: dispatcher
    })
  }

  stop(): void {
    this.wsClient?.close({ force: true })
    this.wsClient = null
  }

  async sendText(target: FeishuTransportTarget, text: string): Promise<void> {
    for (const chunk of chunkFeishuText(text)) {
      if (target.replyToMessageId) {
        await this.sdk.im.message.reply({
          path: {
            message_id: target.replyToMessageId
          },
          data: {
            content: createTextPayload(chunk),
            msg_type: 'text',
            reply_in_thread: Boolean(target.threadId)
          }
        })
        continue
      }

      await this.sdk.im.message.create({
        params: {
          receive_id_type: 'chat_id'
        },
        data: {
          receive_id: target.chatId,
          msg_type: 'text',
          content: createTextPayload(chunk)
        }
      })
    }
  }

  async sendCard(target: FeishuTransportTarget, card: FeishuInteractiveCardPayload): Promise<void> {
    const content = createCardPayload(card)
    if (target.replyToMessageId) {
      await this.sdk.im.message.reply({
        path: {
          message_id: target.replyToMessageId
        },
        data: {
          content,
          msg_type: 'interactive',
          reply_in_thread: Boolean(target.threadId)
        }
      })
      return
    }

    await this.sdk.im.message.create({
      params: {
        receive_id_type: 'chat_id'
      },
      data: {
        receive_id: target.chatId,
        msg_type: 'interactive',
        content
      }
    })
  }
}
