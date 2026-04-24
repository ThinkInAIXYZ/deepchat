import type { TelegramCommandPayload } from '../types'
import type { FeishuRawMessageEvent } from './feishuClient'
import type { FeishuInboundMessage } from '../types'

const FEISHU_COMMAND_REGEX = /^\/([a-zA-Z0-9_]+)(?:\s+([\s\S]*))?$/
const FEISHU_LEADING_AT_TAG_REGEX = /^(?:\s*<at\b[^>]*>.*?<\/at>\s*)+/i
const FEISHU_LEADING_AT_TEXT_REGEX = /^(?:\s*@[\w.-]+\s*)+/i

const parseTextContent = (content: string): string => {
  try {
    const parsed = JSON.parse(content) as { text?: string }
    if (typeof parsed?.text === 'string') {
      return parsed.text.trim()
    }
  } catch {
    // Fall through to raw content.
  }

  return content.trim()
}

const parseMessageContent = (content: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const stripLeadingMentions = (text: string): string =>
  text.replace(FEISHU_LEADING_AT_TAG_REGEX, '').replace(FEISHU_LEADING_AT_TEXT_REGEX, '').trim()

const parseCommand = (text: string): TelegramCommandPayload | null => {
  const match = FEISHU_COMMAND_REGEX.exec(text)
  if (!match) {
    return null
  }

  return {
    name: match[1].toLowerCase(),
    args: match[2]?.trim() ?? ''
  }
}

export class FeishuParser {
  parseEvent(event: FeishuRawMessageEvent, botOpenId?: string): FeishuInboundMessage | null {
    const messageType = event.message?.message_type?.trim() || 'text'
    const content = parseMessageContent(event.message?.content ?? '')
    const rawText = messageType === 'text' ? parseTextContent(event.message?.content ?? '') : ''
    const attachments =
      messageType === 'image' && typeof content.image_key === 'string'
        ? [
            {
              id: content.image_key,
              filename: content.image_key,
              resourceKey: content.image_key,
              resourceType: 'image' as const
            }
          ]
        : messageType === 'file' && typeof content.file_key === 'string'
          ? [
              {
                id: content.file_key,
                filename:
                  typeof content.file_name === 'string' && content.file_name.trim()
                    ? content.file_name.trim()
                    : content.file_key,
                mediaType: 'application/octet-stream',
                resourceKey: content.file_key,
                resourceType: 'file' as const
              }
            ]
          : []

    if (!rawText && attachments.length === 0) {
      return null
    }

    const mentions = event.message?.mentions ?? []
    const mentionedBot = Boolean(
      botOpenId &&
      mentions.some((mention) => mention.id?.open_id && mention.id.open_id === botOpenId)
    )

    const normalizedText = stripLeadingMentions(rawText)
    if (!normalizedText && attachments.length === 0) {
      return null
    }

    return {
      kind: 'message',
      eventId: event.event_id?.trim() || event.uuid?.trim() || event.message.message_id,
      chatId: event.message.chat_id,
      threadId: event.message.thread_id || event.message.root_id || null,
      messageId: event.message.message_id,
      chatType: event.message.chat_type === 'p2p' ? 'p2p' : 'group',
      senderOpenId: event.sender?.sender_id?.open_id?.trim() || null,
      text: normalizedText,
      command: normalizedText ? parseCommand(normalizedText) : null,
      mentionedBot,
      mentions,
      attachments
    }
  }
}
