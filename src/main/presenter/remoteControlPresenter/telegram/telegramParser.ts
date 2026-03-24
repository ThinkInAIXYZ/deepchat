import type { TelegramInboundEvent } from '../types'
import type { TelegramRawUpdate } from './telegramClient'

const TELEGRAM_COMMAND_REGEX = /^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/

export class TelegramParser {
  parseUpdate(update: TelegramRawUpdate): TelegramInboundEvent | null {
    const callbackQuery = update.callback_query
    if (callbackQuery?.message && typeof callbackQuery.data === 'string' && callbackQuery.data) {
      return {
        kind: 'callback_query',
        updateId: update.update_id,
        chatId: Number(callbackQuery.message.chat.id),
        messageThreadId: Number(callbackQuery.message.message_thread_id ?? 0),
        messageId: Number(callbackQuery.message.message_id),
        chatType: callbackQuery.message.chat.type,
        fromId: typeof callbackQuery.from?.id === 'number' ? Number(callbackQuery.from.id) : null,
        callbackQueryId: callbackQuery.id,
        data: callbackQuery.data.trim()
      }
    }

    const message = update.message
    if (!message || typeof message.text !== 'string') {
      return null
    }

    const text = message.text.trim()
    if (!text) {
      return null
    }

    const commandMatch = TELEGRAM_COMMAND_REGEX.exec(text)
    return {
      kind: 'message',
      updateId: update.update_id,
      chatId: Number(message.chat.id),
      messageThreadId: Number(message.message_thread_id ?? 0),
      messageId: Number(message.message_id),
      chatType: message.chat.type,
      fromId: typeof message.from?.id === 'number' ? Number(message.from.id) : null,
      text,
      command: commandMatch
        ? {
            name: commandMatch[1].toLowerCase(),
            args: commandMatch[2]?.trim() ?? ''
          }
        : null
    }
  }
}
