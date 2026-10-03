import type {
  DisplayUserMessageContent,
  DisplayUserMessageInlineBlock,
  DisplayUserMessageMentionBlock
} from './displayMessage'
import { getValidInlineItems } from '@shared/messageInlineItems'

export function getVisibleMentionLabel(block: DisplayUserMessageMentionBlock): string {
  if (block.category === 'prompts') {
    return block.id || block.content
  }

  if (block.category === 'context') {
    return block.id || block.category
  }

  return block.content
}

/**
 * Returns the structured blocks shown in a user message body. Rich persisted blocks
 * replace raw text and inline items; otherwise valid inline items are inserted into
 * the raw text at their recorded offsets.
 */
export function getVisibleUserContentBlocks(
  content: DisplayUserMessageContent
): DisplayUserMessageInlineBlock[] {
  const richBlocks = content.content
  if (richBlocks && richBlocks.length > 0) {
    return richBlocks
  }

  const text = content.text || ''
  const inlineItems = getValidInlineItems(text, content.inlineItems)

  if (inlineItems.length === 0) {
    return []
  }

  const blocks: DisplayUserMessageInlineBlock[] = []
  let cursor = 0

  for (const item of inlineItems) {
    if (item.offset > cursor) {
      blocks.push({ type: 'text', content: text.slice(cursor, item.offset) })
    }

    if (item.type === 'skill') {
      blocks.push({ type: 'skill', skillName: item.skillName })
    } else if (item.type === 'file') {
      blocks.push({
        type: 'file',
        fileName: item.fileName,
        filePath: item.filePath,
        mimeType: item.mimeType
      })
    } else if (item.type === 'file-reference') {
      blocks.push({
        type: 'file-reference',
        filePath: item.filePath,
        relativePath: item.relativePath
      })
    } else {
      blocks.push({
        type: 'session',
        sessionId: item.sessionId,
        title: item.title,
        projectDir: item.projectDir,
        tapeIncarnationId: item.tapeIncarnationId
      })
    }

    cursor = item.offset + (item.type === 'file-reference' ? `@${item.relativePath}`.length : 0)
  }

  if (cursor < text.length) {
    blocks.push({ type: 'text', content: text.slice(cursor) })
  }

  return blocks
}

/** Returns the text rendered in a user message body for collapse measurement and search indexing. */
export function collectVisibleUserMessageText(content: DisplayUserMessageContent): string {
  const blocks = getVisibleUserContentBlocks(content)
  if (blocks.length === 0) {
    return content.text || ''
  }

  return blocks
    .map((block) => {
      if (block.type === 'mention') {
        return getVisibleMentionLabel(block)
      }
      if (block.type === 'skill') {
        return block.skillName
      }
      if (block.type === 'file') {
        return block.fileName
      }
      if (block.type === 'file-reference') {
        return block.relativePath
      }
      if (block.type === 'session') {
        return block.title
      }
      return block.content
    })
    .join('')
}
