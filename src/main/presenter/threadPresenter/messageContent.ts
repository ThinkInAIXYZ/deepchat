import type {
  MessageFile,
  UserMessageContent,
  UserMessageCodeBlock,
  UserMessageMentionBlock,
  UserMessageTextBlock
} from '@shared/chat'

const FILE_CONTENT_MAX_CHARS = 8000
const FILE_CONTENT_TRUNCATION_SUFFIX = '…(truncated)'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTextBlock(content: unknown): content is { type: 'text'; text: string } {
  return isRecord(content) && content.type === 'text' && typeof content.text === 'string'
}

function extractPromptMessageText(message: unknown): string {
  if (!isRecord(message)) {
    return ''
  }

  const content = message.content

  if (typeof content === 'string') {
    return content
  }

  if (isTextBlock(content)) {
    return content.text
  }

  if (isRecord(content) && typeof content.type === 'string') {
    return `[${content.type}]`
  }

  return '[content]'
}

function truncateFileContent(content: string): string {
  if (content.length <= FILE_CONTENT_MAX_CHARS) {
    return content
  }

  return `${content.slice(0, FILE_CONTENT_MAX_CHARS)}${FILE_CONTENT_TRUNCATION_SUFFIX}`
}

function escapeTagContent(value: string): string {
  return String(value).replace(/[&<>\u0000-\u001F]/g, (ch) => {
    switch (ch) {
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

export type UserMessageRichBlock =
  | UserMessageTextBlock
  | UserMessageMentionBlock
  | UserMessageCodeBlock

export function formatUserMessageContent(msgContentBlock: UserMessageRichBlock[]): string {
  if (!Array.isArray(msgContentBlock)) {
    return ''
  }

  return msgContentBlock
    .map((block) => {
      if (block.type === 'mention') {
        if (block.category === 'resources') {
          return `@${block.content}`
        } else if (block.category === 'tools') {
          return `@${block.id}`
        } else if (block.category === 'files') {
          return `@${block.id}`
        } else if (block.category === 'prompts') {
          try {
            const promptData = JSON.parse(block.content)
            if (isRecord(promptData) && Array.isArray(promptData.messages)) {
              const messageTexts = promptData.messages
                .map(extractPromptMessageText)
                .filter((text) => text)
              const escapedContent = messageTexts.length
                ? messageTexts.map(escapeTagContent).join('\n')
                : escapeTagContent(block.content ?? '')
              return `@${block.id} <prompts>${escapedContent}</prompts>`
            }
          } catch (e) {
            console.warn('Failed to parse prompt content:', e)
          }
          return `@${block.id} <prompts>${escapeTagContent(block.content ?? '')}</prompts>`
        }
        return `@${block.id}`
      } else if (block.type === 'text') {
        return block.content
      } else if (block.type === 'code') {
        return `\`\`\`${block.content}\`\`\``
      }
      return ''
    })
    .join('')
}

export function getFileContext(files?: MessageFile[]): string {
  if (!files || files.length === 0) {
    return ''
  }

  return `
  <files>
    ${files
      .map(
        (file) => `<file>
      <name>${file.name ?? ''}</name>
      <mimeType>${file.mimeType ?? ''}</mimeType>
      <size>${file.metadata?.fileSize ?? 0}</size>
      <content>${
        file.mimeType && !file.mimeType.startsWith('image')
          ? truncateFileContent(String(file.content ?? ''))
          : ''
      }</content>
    </file>`
      )
      .join('\n')}
  </files>
  `
}

export function getNormalizedUserMessageText(content: UserMessageContent | undefined): string {
  if (!content) {
    return ''
  }

  if (content.content && Array.isArray(content.content) && content.content.length > 0) {
    return formatUserMessageContent(content.content)
  }

  return content.text || ''
}

export function buildUserMessageContext(content: UserMessageContent | undefined): string {
  if (!content) {
    return ''
  }

  const messageText = getNormalizedUserMessageText(content)
  const fileContext = getFileContext(content.files)

  return `${messageText}${fileContext}`
}
