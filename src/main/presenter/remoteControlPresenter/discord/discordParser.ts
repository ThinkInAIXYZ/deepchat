import type {
  DiscordInboundAttachment,
  DiscordInboundMessage,
  TelegramCommandPayload
} from '../types'

type DiscordGatewayDispatch = {
  t?: string | null
  d?: unknown
}

type DiscordRawUser = {
  id?: string | number
  username?: string
  global_name?: string | null
  bot?: boolean
}

type DiscordRawAttachment = {
  id?: string | number
  filename?: string
  content_type?: string | null
  size?: number
  url?: string
}

type DiscordRawMessage = {
  id?: string | number
  channel_id?: string | number
  guild_id?: string | number
  content?: string
  author?: DiscordRawUser
  attachments?: DiscordRawAttachment[]
  mentions?: DiscordRawUser[]
}

type DiscordInteractionOption = {
  name?: string
  value?: string
}

type DiscordRawInteraction = {
  id?: string | number
  token?: string
  channel_id?: string | number
  guild_id?: string | number
  application_id?: string | number
  data?: {
    name?: string
    options?: DiscordInteractionOption[]
  }
  member?: {
    user?: DiscordRawUser
  }
  user?: DiscordRawUser
}

const DISCORD_COMMAND_REGEX = /^\/([a-zA-Z0-9_]+)(?:\s+([\s\S]*))?$/

const parseCommand = (text: string): TelegramCommandPayload | null => {
  const match = DISCORD_COMMAND_REGEX.exec(text)
  if (!match) {
    return null
  }

  return {
    name: match[1].toLowerCase(),
    args: match[2]?.trim() ?? ''
  }
}

const normalizeUserName = (user: DiscordRawUser | undefined): string => {
  const displayName = user?.global_name?.trim()
  if (displayName) {
    return displayName
  }

  const username = user?.username?.trim()
  if (username) {
    return username
  }

  return user?.id === undefined ? 'unknown' : String(user.id).trim() || 'unknown'
}

const normalizeAttachments = (
  attachments: DiscordRawAttachment[] | undefined
): DiscordInboundAttachment[] =>
  (attachments ?? [])
    .map((attachment) => ({
      id: attachment.id === undefined ? '' : String(attachment.id).trim(),
      filename: attachment.filename?.trim() || 'attachment',
      contentType: attachment.content_type?.trim() || null,
      size: typeof attachment.size === 'number' ? attachment.size : null,
      url: attachment.url?.trim() || ''
    }))
    .filter((attachment) => attachment.id && attachment.url)

const buildAttachmentFallbackText = (attachments: DiscordInboundAttachment[]): string =>
  attachments.length === 0
    ? ''
    : [
        'Attachments:',
        ...attachments.map((attachment) => `${attachment.filename}: ${attachment.url}`)
      ].join('\n')

const removeLeadingBotMentions = (text: string, botUserId: string | null | undefined): string => {
  if (!botUserId) {
    return text.trim()
  }

  const mentionPattern = new RegExp(`^(?:<@!?${botUserId}>\\s*)+`, 'i')
  return text.replace(mentionPattern, '').trim()
}

export class DiscordParser {
  parseDispatch(
    input: DiscordGatewayDispatch,
    botUserId?: string | null
  ): DiscordInboundMessage | null {
    const eventType = input.t?.trim()
    if (!eventType) {
      return null
    }

    if (eventType === 'MESSAGE_CREATE') {
      return this.parseMessageCreate(input.d as DiscordRawMessage, botUserId)
    }

    if (eventType === 'INTERACTION_CREATE') {
      return this.parseInteractionCreate(input.d as DiscordRawInteraction)
    }

    return null
  }

  private parseMessageCreate(
    payload: DiscordRawMessage,
    botUserId?: string | null
  ): DiscordInboundMessage | null {
    const authorId = payload.author?.id === undefined ? '' : String(payload.author.id).trim()
    if (!authorId || payload.author?.bot) {
      return null
    }

    const channelId = payload.channel_id === undefined ? '' : String(payload.channel_id).trim()
    const messageId = payload.id === undefined ? '' : String(payload.id).trim()
    if (!channelId || !messageId) {
      return null
    }

    const chatType = payload.guild_id === undefined ? 'dm' : 'channel'
    const mentionedBot =
      chatType === 'dm' ||
      (payload.mentions ?? []).some((user) => {
        const mentionId = user.id === undefined ? '' : String(user.id).trim()
        return Boolean(botUserId && mentionId === botUserId)
      })
    const attachments = normalizeAttachments(payload.attachments)
    const strippedText = removeLeadingBotMentions(payload.content?.trim() || '', botUserId)
    const text = strippedText || buildAttachmentFallbackText(attachments)
    if (!text) {
      return null
    }

    return {
      kind: 'message',
      eventId: messageId,
      chatId: channelId,
      chatType,
      messageId,
      senderUserId: authorId,
      senderUserName: normalizeUserName(payload.author),
      text,
      command: parseCommand(text),
      mentionedBot,
      attachments
    }
  }

  private parseInteractionCreate(payload: DiscordRawInteraction): DiscordInboundMessage | null {
    const interactionId = payload.id === undefined ? '' : String(payload.id).trim()
    const interactionToken = payload.token?.trim() || ''
    const channelId = payload.channel_id === undefined ? '' : String(payload.channel_id).trim()
    const applicationId =
      payload.application_id === undefined ? '' : String(payload.application_id).trim()
    if (!interactionId || !interactionToken || !channelId || !applicationId) {
      return null
    }

    const dataName = payload.data?.name?.trim()
    if (!dataName) {
      return null
    }

    const args =
      payload.data?.options?.find((option) => option.name?.trim() === 'args')?.value?.trim() ?? ''
    const user = payload.member?.user ?? payload.user
    const senderUserId = user?.id === undefined ? '' : String(user.id).trim()

    return {
      kind: 'interaction',
      eventId: interactionId,
      chatId: channelId,
      chatType: payload.guild_id === undefined ? 'dm' : 'channel',
      messageId: interactionId,
      senderUserId: senderUserId || null,
      senderUserName: normalizeUserName(user),
      text: `/${dataName}${args ? ` ${args}` : ''}`,
      command: {
        name: dataName.toLowerCase(),
        args
      },
      mentionedBot: true,
      interactionId,
      interactionToken,
      applicationId,
      attachments: []
    }
  }
}
