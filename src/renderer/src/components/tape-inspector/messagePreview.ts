import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type {
  DisplayAssistantMessageBlock,
  DisplayUserMessageContent
} from '@/features/chat-page/model/displayMessage'
import { collectVisibleUserMessageText } from '@/features/chat-page/model/displayUserMessageText'

const PREVIEW_SOURCE_CHARACTERS = 2_048
const PREVIEW_OUTPUT_CHARACTERS = 220

export interface TapeInspectorMessagePreview {
  role: ChatMessageRecord['role']
  text: string
}

function safeSlice(text: string, maxCharacters: number): string {
  const sliced = text.slice(0, maxCharacters)
  return /[\uD800-\uDBFF]$/u.test(sliced) ? sliced.slice(0, -1) : sliced
}

function compactPreview(text: string): string {
  const source = safeSlice(text, PREVIEW_SOURCE_CHARACTERS)
  const compact = source.replace(/\s+/gu, ' ').trim()
  const preview = safeSlice(compact, PREVIEW_OUTPUT_CHARACTERS).trimEnd()
  if (!preview) return ''
  return source.length < text.length || preview.length < compact.length ? `${preview}…` : preview
}

function userMessageText(content: string): string {
  try {
    const parsed = JSON.parse(content) as DisplayUserMessageContent
    return parsed && typeof parsed === 'object' ? collectVisibleUserMessageText(parsed) : ''
  } catch {
    return ''
  }
}

function assistantMessageText(content: string): string {
  try {
    const parsed = JSON.parse(content) as DisplayAssistantMessageBlock[]
    if (!Array.isArray(parsed)) return ''
    return parsed
      .filter(
        (block) =>
          block.type === 'content' &&
          typeof block.content === 'string' &&
          block.content.trim().length > 0
      )
      .map((block) => block.content)
      .join('\n\n')
  } catch {
    return ''
  }
}

export function projectTapeInspectorMessagePreview(
  record: ChatMessageRecord
): TapeInspectorMessagePreview | null {
  const text = compactPreview(
    record.role === 'user' ? userMessageText(record.content) : assistantMessageText(record.content)
  )
  return text ? { role: record.role, text } : null
}
