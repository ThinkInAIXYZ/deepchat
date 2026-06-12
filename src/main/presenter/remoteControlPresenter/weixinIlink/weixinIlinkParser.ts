import type { TelegramCommandPayload, WeixinIlinkInboundMessage } from '../types'
import {
  WEIXIN_ILINK_CDN_BASE_URL,
  type WeixinIlinkInboundApiMessage,
  type WeixinIlinkMessageItem
} from './weixinIlinkClient'

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

const normalizeText = (value: string | null | undefined): string | undefined =>
  value?.trim() || undefined

const extractEncryptedMedia = (
  media:
    | {
        encrypt_query_param?: string
        aes_key?: string
        full_url?: string
      }
    | null
    | undefined,
  aesKey: string | null | undefined,
  aesKeyEncoding: 'auto' | 'hex'
) => {
  const encryptedQueryParam = normalizeText(media?.encrypt_query_param)
  const fullUrl = normalizeText(media?.full_url)
  if (!encryptedQueryParam && !fullUrl) {
    return undefined
  }

  return {
    encryptedQueryParam,
    aesKey: normalizeText(aesKey) || normalizeText(media?.aes_key),
    aesKeyEncoding,
    fullUrl,
    cdnBaseUrl: WEIXIN_ILINK_CDN_BASE_URL
  }
}

const parseFileSize = (value: string | number | null | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const extractAttachmentFromItem = (item: WeixinIlinkMessageItem, index: number) => {
  if (item.image_item) {
    const filename = item.image_item.filename?.trim() || `image-${index + 1}.png`
    const encryptedMedia = extractEncryptedMedia(
      item.image_item.media,
      item.image_item.aeskey,
      item.image_item.aeskey ? 'hex' : 'auto'
    )
    const url = normalizeText(item.image_item.url)
    const data = normalizeText(item.image_item.data)
    if (!url && !data && !encryptedMedia) {
      return null
    }

    return {
      id: `${index}`,
      filename,
      mediaType: item.image_item.content_type?.trim() || 'image/png',
      url,
      data,
      size: parseFileSize(item.image_item.mid_size ?? item.image_item.hd_size),
      encryptedMedia,
      resourceType: 'image' as const
    }
  }

  if (item.file_item) {
    const encryptedMedia = extractEncryptedMedia(item.file_item.media, null, 'auto')
    const url = normalizeText(item.file_item.url)
    const data = normalizeText(item.file_item.data)
    if (!url && !data && !encryptedMedia) {
      return null
    }

    const mediaType = item.file_item.content_type?.trim() || 'application/octet-stream'
    return {
      id: `${index}`,
      filename:
        item.file_item.filename?.trim() ||
        item.file_item.file_name?.trim() ||
        `attachment-${index + 1}`,
      mediaType,
      size: parseFileSize(item.file_item.size ?? item.file_item.len),
      url,
      data,
      encryptedMedia,
      resourceType: mediaType.startsWith('image/') ? ('image' as const) : ('file' as const)
    }
  }

  return null
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
    const attachments = (raw.item_list ?? [])
      .map((item, index) => extractAttachmentFromItem(item, index))
      .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment))
    const command = text ? parseCommand(text) : null

    if (!text && !command && attachments.length === 0) {
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
      createdAt: typeof raw.create_time_ms === 'number' ? raw.create_time_ms : null,
      attachments
    }
  }
}
