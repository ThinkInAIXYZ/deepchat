import type { RemoteInputAttachment, TelegramInboundEvent } from '../types'
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
    if (!message) {
      return null
    }

    const attachments: RemoteInputAttachment[] = []
    const largestPhoto = [...(message.photo ?? [])].sort(
      (left, right) => (right.file_size ?? 0) - (left.file_size ?? 0)
    )[0]
    if (largestPhoto?.file_id) {
      attachments.push({
        id: largestPhoto.file_unique_id || largestPhoto.file_id,
        filename: `${largestPhoto.file_unique_id || largestPhoto.file_id}.jpg`,
        mediaType: 'image/jpeg',
        size: largestPhoto.file_size ?? null,
        fileId: largestPhoto.file_id,
        resourceType: 'image' as const
      })
    }

    if (message.document?.file_id) {
      attachments.push({
        id: message.document.file_unique_id || message.document.file_id,
        filename: message.document.file_name?.trim() || message.document.file_id,
        mediaType: message.document.mime_type?.trim() || 'application/octet-stream',
        size: message.document.file_size ?? null,
        fileId: message.document.file_id,
        resourceType: message.document.mime_type?.startsWith('image/')
          ? ('image' as const)
          : ('file' as const)
      })
    }

    const text = (message.text ?? message.caption ?? '').trim()
    if (!text && attachments.length === 0) {
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
        : null,
      attachments
    }
  }
}
