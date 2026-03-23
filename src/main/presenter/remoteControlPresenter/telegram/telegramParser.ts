import type { TelegramInboundMessage } from '../types'
import type { TelegramRawUpdate } from './telegramClient'

const TELEGRAM_COMMAND_REGEX = /^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/

export class TelegramParser {
  parseUpdate(update: TelegramRawUpdate): TelegramInboundMessage | null {
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
