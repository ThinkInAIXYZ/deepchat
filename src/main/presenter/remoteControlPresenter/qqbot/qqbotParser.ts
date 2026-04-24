import type { TelegramCommandPayload, QQBotInboundMessage } from '../types'

type QQBotDispatchEnvelope = {
  t?: string | null
  d?: unknown
}

type QQBotRawAuthor = {
  user_openid?: string
  member_openid?: string
  username?: string
}

type QQBotRawMessage = {
  id?: string
  content?: string
  author?: QQBotRawAuthor
  group_openid?: string
  attachments?: Array<{
    id?: string
    filename?: string
    content_type?: string
    url?: string
    size?: number
  }>
}

const QQBOT_COMMAND_REGEX = /^\/([a-zA-Z0-9_]+)(?:\s+([\s\S]*))?$/

const parseCommand = (text: string): TelegramCommandPayload | null => {
  const match = QQBOT_COMMAND_REGEX.exec(text)
  if (!match) {
    return null
  }

  return {
    name: match[1].toLowerCase(),
    args: match[2]?.trim() ?? ''
  }
}

const normalizeAttachments = (payload: QQBotRawMessage) =>
  (payload.attachments ?? [])
    .map((attachment, index) => ({
      id: attachment.id?.trim() || attachment.url?.trim() || '',
      filename: attachment.filename?.trim() || `attachment-${index + 1}`,
      mediaType: attachment.content_type?.trim() || 'application/octet-stream',
      size: typeof attachment.size === 'number' ? attachment.size : null,
      url: attachment.url?.trim() || '',
      resourceType: attachment.content_type?.startsWith('image/')
        ? ('image' as const)
        : ('file' as const)
    }))
    .filter((attachment) => attachment.url)

export class QQBotParser {
  parseDispatch(input: QQBotDispatchEnvelope): QQBotInboundMessage | null {
    const eventType = input.t?.trim()
    if (!eventType) {
      return null
    }

    if (eventType !== 'C2C_MESSAGE_CREATE' && eventType !== 'GROUP_AT_MESSAGE_CREATE') {
      return null
    }

    const payload = (input.d ?? {}) as QQBotRawMessage
    const rawText = payload.content?.trim() || ''
    const attachments = normalizeAttachments(payload)
    if (!rawText && attachments.length === 0) {
      return null
    }

    if (eventType === 'C2C_MESSAGE_CREATE') {
      const userOpenId = payload.author?.user_openid?.trim() || ''
      if (!userOpenId) {
        return null
      }

      return {
        kind: 'message',
        eventId: payload.id?.trim() || userOpenId,
        chatId: userOpenId,
        chatType: 'c2c',
        messageId: payload.id?.trim() || userOpenId,
        messageSeq: 1,
        senderUserId: userOpenId,
        senderUserName: payload.author?.username?.trim() || userOpenId,
        text: rawText,
        command: rawText ? parseCommand(rawText) : null,
        mentionedBot: false,
        attachments
      }
    }

    const groupOpenId = payload.group_openid?.trim() || ''
    const memberOpenId = payload.author?.member_openid?.trim() || ''
    if (!groupOpenId || !memberOpenId) {
      return null
    }

    return {
      kind: 'message',
      eventId: payload.id?.trim() || `${groupOpenId}:${memberOpenId}`,
      chatId: groupOpenId,
      chatType: 'group',
      messageId: payload.id?.trim() || `${groupOpenId}:${memberOpenId}`,
      messageSeq: 1,
      senderUserId: memberOpenId,
      senderUserName: payload.author?.username?.trim() || memberOpenId,
      text: rawText,
      command: rawText ? parseCommand(rawText) : null,
      mentionedBot: true,
      attachments
    }
  }
}
