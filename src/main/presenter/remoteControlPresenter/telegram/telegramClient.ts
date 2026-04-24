import fs from 'node:fs/promises'
import path from 'node:path'
import type { TelegramInlineKeyboardMarkup, TelegramTransportTarget } from '../types'

type TelegramApiErrorParameters = {
  retry_after?: number
}

type TelegramApiResponse<T> = {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: TelegramApiErrorParameters
}

type TelegramChat = {
  id: number
  type: string
}

type TelegramUser = {
  id: number
  username?: string
}

export type TelegramRawPhotoSize = {
  file_id: string
  file_unique_id?: string
  width?: number
  height?: number
  file_size?: number
}

export type TelegramRawDocument = {
  file_id: string
  file_unique_id?: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

export type TelegramRawMessage = {
  message_id: number
  message_thread_id?: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
  caption?: string
  photo?: TelegramRawPhotoSize[]
  document?: TelegramRawDocument
}

export type TelegramRawCallbackQuery = {
  id: string
  from?: TelegramUser
  message?: TelegramRawMessage
  data?: string
}

type TelegramSentMessage = {
  message_id: number
}

type TelegramFile = {
  file_id: string
  file_unique_id?: string
  file_size?: number
  file_path?: string
}

export type TelegramRawUpdate = {
  update_id: number
  message?: TelegramRawMessage
  callback_query?: TelegramRawCallbackQuery
}

export type TelegramBotUser = {
  id: number
  username?: string
}

export type TelegramBotCommand = {
  command: string
  description: string
}

const buildReplyMarkup = (
  replyMarkup?: TelegramInlineKeyboardMarkup | null
): TelegramInlineKeyboardMarkup | undefined =>
  replyMarkup === null ? { inline_keyboard: [] } : replyMarkup

const TELEGRAM_FILE_REQUEST_TIMEOUT_MS = 35_000

const fetchWithTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = TELEGRAM_FILE_REQUEST_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

export class TelegramApiRequestError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly retryAfter?: number
  ) {
    super(message)
    this.name = 'TelegramApiRequestError'
  }
}

export class TelegramClient {
  private readonly baseUrl: string
  private readonly fileBaseUrl: string

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`
    this.fileBaseUrl = `https://api.telegram.org/file/bot${botToken}`
  }

  async getMe(): Promise<TelegramBotUser> {
    return await this.request<TelegramBotUser>('getMe')
  }

  async getUpdates(params: {
    offset?: number
    limit?: number
    timeout?: number
    allowedUpdates?: string[]
    signal?: AbortSignal
  }): Promise<TelegramRawUpdate[]> {
    return await this.request<TelegramRawUpdate[]>(
      'getUpdates',
      {
        offset: params.offset,
        limit: params.limit,
        timeout: params.timeout,
        allowed_updates: params.allowedUpdates
      },
      {
        signal: params.signal
      }
    )
  }

  async sendMessage(
    target: TelegramTransportTarget,
    text: string,
    replyMarkup?: TelegramInlineKeyboardMarkup
  ): Promise<number> {
    const message = await this.request<TelegramSentMessage>('sendMessage', {
      chat_id: target.chatId,
      message_thread_id: target.messageThreadId || undefined,
      text,
      reply_markup: buildReplyMarkup(replyMarkup)
    })
    return message.message_id
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return await this.request<TelegramFile>('getFile', {
      file_id: fileId
    })
  }

  async downloadFileBase64(fileId: string): Promise<{
    data: string
    size: number
  }> {
    const file = await this.getFile(fileId)
    const filePath = file.file_path?.trim()
    if (!filePath) {
      throw new Error('Telegram file_path is missing from getFile response.')
    }

    const response = await fetchWithTimeout(`${this.fileBaseUrl}/${filePath}`)
    if (!response.ok) {
      throw new TelegramApiRequestError(`Telegram file download failed: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return {
      data: buffer.toString('base64'),
      size: buffer.byteLength
    }
  }

  async sendPhoto(
    target: TelegramTransportTarget,
    filePath: string,
    caption?: string
  ): Promise<number> {
    const form = new FormData()
    form.set('chat_id', String(target.chatId))
    if (target.messageThreadId) {
      form.set('message_thread_id', String(target.messageThreadId))
    }
    if (caption?.trim()) {
      form.set('caption', caption.trim())
    }
    const fileBuffer = await fs.readFile(filePath)
    const fileName = path.basename(filePath) || 'image'
    form.set('photo', new Blob([fileBuffer]), fileName)

    const response = await fetchWithTimeout(`${this.baseUrl}/sendPhoto`, {
      method: 'POST',
      body: form
    })
    const payload = (await response
      .json()
      .catch(() => ({}))) as TelegramApiResponse<TelegramSentMessage>
    if (!response.ok || !payload.ok || payload.result === undefined) {
      const description = payload.description?.trim() || 'Telegram sendPhoto failed.'
      throw new TelegramApiRequestError(
        description,
        payload.error_code,
        payload.parameters?.retry_after
      )
    }
    return payload.result.message_id
  }

  async sendMessageDraft(
    target: TelegramTransportTarget,
    draftId: number,
    text: string
  ): Promise<void> {
    await this.request('sendMessageDraft', {
      chat_id: target.chatId,
      message_thread_id: target.messageThreadId || undefined,
      draft_id: draftId,
      text
    })
  }

  async sendChatAction(
    target: TelegramTransportTarget,
    action: 'typing' = 'typing'
  ): Promise<void> {
    await this.request('sendChatAction', {
      chat_id: target.chatId,
      message_thread_id: target.messageThreadId || undefined,
      action
    })
  }

  async setMyCommands(commands: TelegramBotCommand[]): Promise<void> {
    await this.request('setMyCommands', {
      commands
    })
  }

  async editMessageText(params: {
    target: TelegramTransportTarget
    messageId: number
    text: string
    replyMarkup?: TelegramInlineKeyboardMarkup | null
  }): Promise<void> {
    await this.request('editMessageText', {
      chat_id: params.target.chatId,
      message_id: params.messageId,
      text: params.text,
      reply_markup: buildReplyMarkup(params.replyMarkup)
    })
  }

  async editMessageReplyMarkup(params: {
    target: TelegramTransportTarget
    messageId: number
    replyMarkup?: TelegramInlineKeyboardMarkup | null
  }): Promise<void> {
    await this.request('editMessageReplyMarkup', {
      chat_id: params.target.chatId,
      message_id: params.messageId,
      reply_markup: buildReplyMarkup(params.replyMarkup)
    })
  }

  async deleteMessage(params: {
    target: TelegramTransportTarget
    messageId: number
  }): Promise<void> {
    await this.request('deleteMessage', {
      chat_id: params.target.chatId,
      message_id: params.messageId
    })
  }

  async answerCallbackQuery(params: {
    callbackQueryId: string
    text?: string
    showAlert?: boolean
  }): Promise<void> {
    await this.request('answerCallbackQuery', {
      callback_query_id: params.callbackQueryId,
      text: params.text,
      show_alert: params.showAlert
    })
  }

  async setMessageReaction(params: {
    chatId: number
    messageId: number
    emoji?: string | null
  }): Promise<void> {
    await this.request('setMessageReaction', {
      chat_id: params.chatId,
      message_id: params.messageId,
      reaction: params.emoji
        ? [
            {
              type: 'emoji',
              emoji: params.emoji
            }
          ]
        : []
    })
  }

  private async request<T>(
    method: string,
    body?: Record<string, unknown>,
    options?: {
      timeoutMs?: number
      signal?: AbortSignal
    }
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(options?.timeoutMs ?? 35_000)
    const signal = options?.signal
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal
    })

    const payload = (await response.json().catch(() => ({}))) as TelegramApiResponse<T>
    if (!response.ok || !payload.ok || payload.result === undefined) {
      const description = payload.description?.trim() || `Telegram API request failed: ${method}`
      const retryAfter = payload.parameters?.retry_after
      const retrySuffix =
        typeof retryAfter === 'number' && retryAfter > 0 ? ` (retry_after=${retryAfter})` : ''
      throw new TelegramApiRequestError(
        `${description}${retrySuffix}`,
        payload.error_code,
        retryAfter
      )
    }

    return payload.result
  }
}
