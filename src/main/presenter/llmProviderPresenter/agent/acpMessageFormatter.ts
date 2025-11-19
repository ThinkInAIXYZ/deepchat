import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { ChatMessage, ModelConfig } from '@shared/presenter'

interface NormalizedContent {
  type: 'text' | 'resource_link'
  value: string
}

export class AcpMessageFormatter {
  format(messages: ChatMessage[], modelConfig: ModelConfig): schema.ContentBlock[] {
    const blocks: schema.ContentBlock[] = []
    const configLine = this.buildConfigLine(modelConfig)
    if (configLine) {
      blocks.push({ type: 'text', text: configLine })
    }

    messages.forEach((message) => {
      const prefix = (message.role || 'unknown').toUpperCase()
      const normalized = this.normalizeContent(message)
      if (normalized.length === 0) {
        blocks.push({ type: 'text', text: `${prefix}:` })
        return
      }

      normalized.forEach((item, index) => {
        if (item.type === 'text') {
          const label = index === 0 ? `${prefix}: ` : ''
          blocks.push({ type: 'text', text: `${label}${item.value}` })
        } else if (item.type === 'resource_link') {
          blocks.push({ type: 'resource_link', uri: item.value, name: prefix })
        }
      })

      if (message.tool_calls && message.tool_calls.length > 0) {
        message.tool_calls.forEach((toolCall) => {
          blocks.push({
            type: 'text',
            text: `${prefix} TOOL CALL ${toolCall.id || ''}: ${toolCall.function?.name || 'unknown'} ${toolCall.function?.arguments || ''}`
          })
        })
      }

      if (message.role === 'tool' && typeof message.content === 'string') {
        blocks.push({
          type: 'text',
          text: `TOOL RESPONSE${message.tool_call_id ? ` (${message.tool_call_id})` : ''}: ${message.content}`
        })
      }
    })

    return blocks
  }

  private buildConfigLine(modelConfig: ModelConfig): string {
    const temperature = modelConfig.temperature ?? 0.6
    const maxTokens = modelConfig.maxTokens ?? modelConfig.maxCompletionTokens ?? 4096
    return `temperature=${temperature}, maxTokens=${maxTokens}`
  }

  private normalizeContent(message: ChatMessage): NormalizedContent[] {
    const normalized: NormalizedContent[] = []
    const content = message.content as unknown

    if (typeof content === 'string') {
      if (content.trim().length > 0) {
        normalized.push({ type: 'text', value: content })
      }
    } else if (Array.isArray(content)) {
      content.forEach((rawPart) => {
        const part = rawPart as Record<string, unknown>
        const type = typeof part.type === 'string' ? part.type : undefined

        if ((type === 'text' || type === 'input_text') && typeof part.text === 'string') {
          normalized.push({ type: 'text', value: part.text })
        } else if (type === 'image_url') {
          const imageUrl = part['image_url'] as { url?: string } | undefined
          if (imageUrl?.url) {
            normalized.push({ type: 'resource_link', value: imageUrl.url })
          }
        } else if (type === 'input_image') {
          const imageUrl = part['image_url'] as { url?: string } | undefined
          if (imageUrl?.url) {
            normalized.push({ type: 'resource_link', value: imageUrl.url })
          }
        } else if (typeof part.text === 'string') {
          normalized.push({ type: 'text', value: part.text })
        }
      })
    }

    return normalized
  }
}
