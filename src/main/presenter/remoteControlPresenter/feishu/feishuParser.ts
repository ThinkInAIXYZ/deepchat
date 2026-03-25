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
    const rawText = parseTextContent(event.message?.content ?? '')
    if (!rawText) {
      return null
    }

    const mentions = event.message?.mentions ?? []
    const mentionedBot = Boolean(
      botOpenId &&
      mentions.some((mention) => mention.id?.open_id && mention.id.open_id === botOpenId)
    )

    const normalizedText = stripLeadingMentions(rawText)
    if (!normalizedText) {
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
      command: parseCommand(normalizedText),
      mentionedBot,
      mentions
    }
  }
}
