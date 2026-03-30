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

export type TelegramRawMessage = {
  message_id: number
  message_thread_id?: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
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

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`
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
