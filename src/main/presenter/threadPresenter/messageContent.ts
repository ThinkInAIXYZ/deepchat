import type {
  MessageFile,
  UserMessageContent,
  UserMessageCodeBlock,
  UserMessageMentionBlock,
  UserMessageTextBlock
} from '@shared/chat'

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
            if (promptData && Array.isArray(promptData.messages)) {
              const messageTexts = promptData.messages
                .map((msg: any) => {
                  if (typeof msg.content === 'string') {
                    return msg.content
                  } else if (msg.content && msg.content.type === 'text') {
                    return msg.content.text
                  }
                  return `[${msg.content?.type || 'content'}]`
                })
                .filter(Boolean)
                .join('\n')
              return `@${block.id} <prompts>${messageTexts || block.content}</prompts>`
            }
          } catch (e) {
            console.log('解析prompt内容失败:', e)
          }
          return `@${block.id} <prompts>${block.content}</prompts>`
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
      <name>${file.name}</name>
      <mimeType>${file.mimeType}</mimeType>
      <size>${file.metadata.fileSize}</size>
      <path>${file.path}</path>
      <content>${!file.mimeType.startsWith('image') ? file.content : ''}</content>
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
