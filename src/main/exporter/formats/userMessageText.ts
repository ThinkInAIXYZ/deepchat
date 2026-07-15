import type {
  UserMessageCodeBlock,
  UserMessageContent,
  UserMessageMentionBlock,
  UserMessageTextBlock
} from '@shared/chat'

type UserMessageRichBlock = UserMessageTextBlock | UserMessageMentionBlock | UserMessageCodeBlock

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractPromptMessageText(message: unknown): string {
  if (!isRecord(message)) return ''
  if (typeof message.content === 'string') return message.content
  if (
    isRecord(message.content) &&
    message.content.type === 'text' &&
    typeof message.content.text === 'string'
  ) {
    return message.content.text
  }
  if (isRecord(message.content) && typeof message.content.type === 'string') {
    return `[${message.content.type}]`
  }
  return '[content]'
}

function escapeTagContent(value: string): string {
  /* eslint-disable no-control-regex */
  return String(value).replace(/[&<>\u0000-\u001F]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '\n':
        return '&#10;'
      case '\r':
        return '&#13;'
      case '\t':
        return '&#9;'
      default:
        return ''
    }
  })
}

export function formatUserMessageContent(blocks: UserMessageRichBlock[]): string {
  if (!Array.isArray(blocks)) return ''

  return blocks
    .map((block) => {
      if (block.type === 'text') return block.content
      if (block.type === 'code') return `\`\`\`${block.content}\`\`\``
      if (block.category === 'resources') return `@${block.content}`
      if (block.category === 'tools' || block.category === 'files') return `@${block.id}`
      if (block.category === 'context') return block.content
      if (block.category !== 'prompts') return `@${block.id}`

      try {
        const prompt = JSON.parse(block.content)
        if (isRecord(prompt) && Array.isArray(prompt.messages)) {
          const messages = prompt.messages.map(extractPromptMessageText).filter(Boolean)
          const content = messages.length
            ? messages.map(escapeTagContent).join('\n')
            : escapeTagContent(block.content ?? '')
          return `@${block.id} <prompts>${content}</prompts>`
        }
      } catch (error) {
        console.warn('Failed to parse prompt content:', error)
      }
      return `@${block.id} <prompts>${escapeTagContent(block.content ?? '')}</prompts>`
    })
    .join('')
}

export function getNormalizedUserMessageText(content: UserMessageContent | undefined): string {
  if (!content) return ''
  if (content.content && Array.isArray(content.content) && content.content.length > 0) {
    return formatUserMessageContent(content.content)
  }
  return content.text || ''
}
