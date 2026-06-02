import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { ChatMessage } from '@shared/presenter'

interface FormatOptions {
  promptCapabilities?: schema.PromptCapabilities
  includeSystemPrompt?: boolean
}

interface FormatResult {
  blocks: schema.ContentBlock[]
  includedSystemPrompt: boolean
}

type NormalizedContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; uri?: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name?: string; mimeType?: string }
  | { type: 'resource'; uri: string; text: string; mimeType?: string }

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.*)$/s

export class AcpMessageFormatter {
  format(messages: ChatMessage[], options: FormatOptions = {}): FormatResult {
    const blocks: schema.ContentBlock[] = []
    const systemPrompt = options.includeSystemPrompt ? this.extractSystemPrompt(messages) : null
    if (systemPrompt) {
      blocks.push({
        type: 'text',
        text: `System instructions:\n${systemPrompt}`
      })
    }

    const userMessage = this.findLastUserMessage(messages)
    if (userMessage) {
      this.normalizeContent(userMessage).forEach((item) => {
        blocks.push(this.toContentBlock(item, options.promptCapabilities))
      })
    }

    if (!blocks.length) {
      blocks.push({ type: 'text', text: '' })
    }

    return {
      blocks,
      includedSystemPrompt: Boolean(systemPrompt)
    }
  }

  private findLastUserMessage(messages: ChatMessage[]): ChatMessage | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        return messages[index]
      }
    }
    return null
  }

  private extractSystemPrompt(messages: ChatMessage[]): string | null {
    const systemMessage = messages.find((message) => message.role === 'system')
    if (!systemMessage) return null

    const text = this.normalizeContent(systemMessage)
      .filter((item): item is Extract<NormalizedContent, { type: 'text' }> => item.type === 'text')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n')

    return text || null
  }

  private normalizeContent(message: ChatMessage): NormalizedContent[] {
    const normalized: NormalizedContent[] = []
    const content = message.content as unknown

    if (typeof content === 'string') {
      if (content.trim().length > 0) {
        normalized.push({ type: 'text', text: content })
      }
      return normalized
    }

    if (!Array.isArray(content)) {
      return normalized
    }

    content.forEach((rawPart) => {
      const part = rawPart as Record<string, unknown>
      const type = typeof part.type === 'string' ? part.type : undefined

      if ((type === 'text' || type === 'input_text') && typeof part.text === 'string') {
        normalized.push({ type: 'text', text: part.text })
        return
      }

      if (type === 'image_url' || type === 'input_image') {
        const url = this.extractImageUrl(part)
        if (!url) return
        const image = this.parseDataUrl(url)
        if (image) {
          normalized.push({ type: 'image', data: image.data, mimeType: image.mimeType, uri: url })
        } else {
          normalized.push({ type: 'resource_link', uri: url, name: 'image' })
        }
        return
      }

      if (type === 'input_audio' || type === 'audio') {
        const data = typeof part.data === 'string' ? part.data : undefined
        const mimeType =
          typeof part.mimeType === 'string'
            ? part.mimeType
            : typeof part.mime_type === 'string'
              ? part.mime_type
              : 'audio/mpeg'
        if (data) {
          normalized.push({ type: 'audio', data, mimeType })
        }
        return
      }

      if (type === 'resource_link' && typeof part.uri === 'string') {
        normalized.push({
          type: 'resource_link',
          uri: part.uri,
          name: typeof part.name === 'string' ? part.name : undefined,
          mimeType: typeof part.mimeType === 'string' ? part.mimeType : undefined
        })
        return
      }

      if (typeof part.text === 'string') {
        normalized.push({ type: 'text', text: part.text })
      }
    })

    return normalized
  }

  private extractImageUrl(part: Record<string, unknown>): string | undefined {
    const imageUrl = part.image_url as { url?: unknown } | undefined
    const source = part.source as { data?: unknown; url?: unknown } | undefined
    const candidates = [imageUrl?.url, source?.data, source?.url, part.data, part.url, part.uri]
    return candidates.find((candidate): candidate is string => {
      return typeof candidate === 'string' && candidate.trim().length > 0
    })
  }

  private toContentBlock(
    item: NormalizedContent,
    capabilities?: schema.PromptCapabilities
  ): schema.ContentBlock {
    switch (item.type) {
      case 'text':
        return { type: 'text', text: item.text }
      case 'image':
        if (capabilities?.image) {
          return {
            type: 'image',
            data: item.data,
            mimeType: item.mimeType,
            ...(item.uri ? { uri: item.uri } : {})
          }
        }
        return item.uri
          ? { type: 'resource_link', uri: item.uri, name: 'image', mimeType: item.mimeType }
          : { type: 'text', text: `[image ${item.mimeType}]` }
      case 'audio':
        if (capabilities?.audio) {
          return { type: 'audio', data: item.data, mimeType: item.mimeType }
        }
        return { type: 'text', text: `[audio ${item.mimeType}]` }
      case 'resource':
        if (capabilities?.embeddedContext) {
          return {
            type: 'resource',
            resource: {
              uri: item.uri,
              text: item.text,
              ...(item.mimeType ? { mimeType: item.mimeType } : {})
            }
          }
        }
        return { type: 'text', text: item.text }
      case 'resource_link':
        return {
          type: 'resource_link',
          uri: item.uri,
          name: item.name ?? item.uri,
          ...(item.mimeType ? { mimeType: item.mimeType } : {})
        }
    }
  }

  private parseDataUrl(value: string): { mimeType: string; data: string } | null {
    const match = DATA_URL_PATTERN.exec(value)
    if (!match) return null
    return {
      mimeType: match[1],
      data: match[2]
    }
  }
}
