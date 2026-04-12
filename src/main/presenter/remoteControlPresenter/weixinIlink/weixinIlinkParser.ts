import type { TelegramCommandPayload, WeixinIlinkInboundMessage } from '../types'
import type { WeixinIlinkInboundApiMessage, WeixinIlinkMessageItem } from './weixinIlinkClient'

const parseCommand = (text: string): TelegramCommandPayload | null => {
  const match = /^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) {
    return null
  }

  return {
    name: match[1].toLowerCase(),
    args: match[2]?.trim() || ''
  }
}

const extractTextFromItem = (item: WeixinIlinkMessageItem): string => {
  if (item.type === 1) {
    return item.text_item?.text?.trim() || ''
  }

  if (item.type === 3) {
    return item.voice_item?.text?.trim() || ''
  }

  return ''
}

export class WeixinIlinkParser {
  parseMessage(
    accountId: string,
    raw: WeixinIlinkInboundApiMessage
  ): WeixinIlinkInboundMessage | null {
    const userId = raw.from_user_id?.trim()
    if (!userId || Number(raw.message_type ?? 0) !== 1) {
      return null
    }

    const text = (raw.item_list ?? [])
      .map((item) => extractTextFromItem(item))
      .filter(Boolean)
      .join('\n')
      .trim()
    const command = text ? parseCommand(text) : null

    if (!text && !command) {
      return null
    }

    return {
      kind: 'message',
      accountId,
      userId,
      text,
      messageId:
        String(raw.message_id ?? '').trim() ||
        `${userId}:${String(raw.seq ?? raw.create_time_ms ?? Date.now())}`,
      contextToken: raw.context_token?.trim() || null,
      command,
      createdAt: typeof raw.create_time_ms === 'number' ? raw.create_time_ms : null
    }
  }
}
