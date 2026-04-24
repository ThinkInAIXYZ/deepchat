import * as Lark from '@larksuiteoapi/node-sdk'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import type { EventHandles } from '@larksuiteoapi/node-sdk'
import type { FeishuBrand } from '@shared/presenter'
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

type FeishuMessageResponse = {
  data?: {
    message_id?: string
  }
}

const createTextPayload = (text: string): string =>
  JSON.stringify({
    text
  })

const createCardPayload = (card: FeishuInteractiveCardPayload): string => JSON.stringify(card)

const readHeaderValue = (headers: unknown, name: string): string | undefined => {
  if (!headers) {
    return undefined
  }

  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (
      ((headers as { get: (key: string) => string | null }).get(name) ?? '').trim() || undefined
    )
  }

  if (typeof headers === 'object') {
    const record = headers as Record<string, string | string[] | undefined>
    const value = record[name] ?? record[name.toLowerCase()]
    if (Array.isArray(value)) {
      return value.find((entry) => entry.trim())?.trim()
    }
    return value?.trim() || undefined
  }

  return undefined
}

const readResponseContentType = (response: unknown): string | undefined => {
  const record = response as
    | {
        headers?: unknown
        data?: {
          headers?: unknown
        }
        response?: {
          headers?: unknown
        }
      }
    | null
    | undefined

  return (
    readHeaderValue(record?.headers, 'content-type') ||
    readHeaderValue(record?.data?.headers, 'content-type') ||
    readHeaderValue(record?.response?.headers, 'content-type')
  )
}

const resolveLarkDomain = (brand: FeishuBrand): string | undefined => {
  if (brand === 'lark') {
    return ((Lark as any).Domain?.Lark as string | undefined) ?? 'https://open.larksuite.com'
  }

  return ((Lark as any).Domain?.Feishu as string | undefined) ?? 'https://open.feishu.cn'
}

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
      brand: FeishuBrand
      appId: string
      appSecret: string
      verificationToken: string
      encryptKey: string
    }
  ) {
    this.sdk = new Lark.Client({
      domain: resolveLarkDomain(credentials.brand),
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
      domain: resolveLarkDomain(this.credentials.brand),
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

  async sendText(target: FeishuTransportTarget, text: string): Promise<string | null> {
    let messageId: string | null = null

    for (const chunk of chunkFeishuText(text)) {
      if (target.replyToMessageId) {
        const response = (await this.sdk.im.message.reply({
          path: {
            message_id: target.replyToMessageId
          },
          data: {
            content: createTextPayload(chunk),
            msg_type: 'text',
            reply_in_thread: Boolean(target.threadId)
          }
        })) as FeishuMessageResponse
        messageId = response.data?.message_id?.trim() || messageId
        continue
      }

      const response = (await this.sdk.im.message.create({
        params: {
          receive_id_type: 'chat_id'
        },
        data: {
          receive_id: target.chatId,
          msg_type: 'text',
          content: createTextPayload(chunk)
        }
      })) as FeishuMessageResponse
      messageId = response.data?.message_id?.trim() || messageId
    }

    return messageId
  }

  async downloadMessageResource(params: {
    messageId: string
    fileKey: string
    type: 'image' | 'file'
  }): Promise<{
    data: string
    mediaType?: string
  }> {
    const response = await (this.sdk as any).im.messageResource.get({
      path: {
        message_id: params.messageId,
        file_key: params.fileKey
      },
      params: {
        type: params.type
      }
    })

    const stream = response?.data?.file || response?.file || response?.data
    const chunks: Buffer[] = []
    if (stream && typeof stream.on === 'function') {
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        stream.on('end', () => resolve())
        stream.on('error', reject)
      })
    } else if (Buffer.isBuffer(stream)) {
      chunks.push(stream)
    }

    if (chunks.length === 0) {
      throw new Error('Feishu message resource response did not contain file data.')
    }

    return {
      data: Buffer.concat(chunks).toString('base64'),
      mediaType: readResponseContentType(response)
    }
  }

  async sendImage(target: FeishuTransportTarget, imagePath: string): Promise<string | null> {
    try {
      await access(imagePath)
    } catch {
      throw new Error(`Feishu image file is missing: ${imagePath}`)
    }

    const upload = await (this.sdk as any).im.image.create({
      data: {
        image_type: 'message',
        image: createReadStream(imagePath)
      }
    })
    const imageKey = upload?.data?.image_key || upload?.image_key
    if (!imageKey) {
      throw new Error('Feishu image upload did not return image_key.')
    }

    const imageContent = JSON.stringify({
      image_key: imageKey
    })
    const response = target.replyToMessageId
      ? await (this.sdk.im.message.reply as any)({
          path: {
            message_id: target.replyToMessageId
          },
          params: {
            receive_id_type: 'chat_id'
          },
          data: {
            receive_id: target.chatId,
            msg_type: 'image',
            content: imageContent,
            reply_in_thread: Boolean(target.threadId)
          }
        })
      : await this.sdk.im.message.create({
          params: {
            receive_id_type: 'chat_id'
          },
          data: {
            receive_id: target.chatId,
            msg_type: 'image',
            content: imageContent
          }
        })

    return ((response as FeishuMessageResponse).data?.message_id ?? '').trim() || null
  }

  async updateText(messageId: string, text: string): Promise<void> {
    await this.sdk.im.message.update({
      path: {
        message_id: messageId
      },
      data: {
        msg_type: 'text',
        content: createTextPayload(text)
      }
    })
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.sdk.im.message.delete({
      path: {
        message_id: messageId
      }
    })
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
