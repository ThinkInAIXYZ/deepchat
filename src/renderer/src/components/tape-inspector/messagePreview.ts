import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type {
  DisplayAssistantMessageBlock,
  DisplayUserMessageContent
} from '@/features/chat-page/model/displayMessage'
import { collectVisibleUserMessageText } from '@/features/chat-page/model/displayUserMessageText'

const PREVIEW_SOURCE_CHARACTERS = 2_048
const PREVIEW_OUTPUT_CHARACTERS = 220
const REQUEST_ACTIVITY_CHARACTERS = 4_096
const REQUEST_CONTEXT_ITEMS = 8

export interface TapeInspectorMessagePreview {
  role: ChatMessageRecord['role']
  text: string
}

export type TapeInspectorRequestActivityKind = 'user' | 'assistant' | 'tool' | 'error'

export interface TapeInspectorRequestActivity {
  key: string
  kind: TapeInspectorRequestActivityKind
  text: string
  preview: string
  timestamp: number
  truncated: boolean
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

function boundedActivityText(
  text: string
): Pick<TapeInspectorRequestActivity, 'text' | 'preview' | 'truncated'> {
  const normalized = text.trim()
  const bounded = safeSlice(normalized, REQUEST_ACTIVITY_CHARACTERS).trimEnd()
  return {
    text: bounded,
    preview: compactPreview(bounded),
    truncated: bounded.length < normalized.length
  }
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

export function projectTapeInspectorAssistantActivities(
  record: ChatMessageRecord,
  cachedBlocks?: readonly DisplayAssistantMessageBlock[]
): TapeInspectorRequestActivity[] {
  if (record.role !== 'assistant') return []
  let blocks = cachedBlocks
  if (!blocks) {
    try {
      const parsed = JSON.parse(record.content) as DisplayAssistantMessageBlock[]
      if (!Array.isArray(parsed)) return []
      blocks = parsed
    } catch {
      return []
    }
  }

  return blocks
    .flatMap((block, index): TapeInspectorRequestActivity[] => {
      if (!Number.isFinite(block.timestamp)) return []
      const base = {
        key: `${block.id ?? block.type}:${index}:${block.timestamp}`,
        timestamp: block.timestamp
      }
      if (
        (block.type === 'content' || block.type === 'search') &&
        typeof block.content === 'string' &&
        block.content.trim()
      ) {
        return [{ ...base, kind: 'assistant', ...boundedActivityText(block.content) }]
      }
      if (block.type === 'tool_call' || block.action_type === 'tool_call_permission') {
        const toolName = [block.tool_call?.server_name, block.tool_call?.name]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join(' / ')
        return [{ ...base, kind: 'tool', ...boundedActivityText(toolName) }]
      }
      if (block.type === 'error') {
        return [{ ...base, kind: 'error', ...boundedActivityText('') }]
      }
      if (block.type === 'image' || block.type === 'video' || block.type === 'audio') {
        return [{ ...base, kind: 'assistant', ...boundedActivityText('') }]
      }
      return []
    })
    .sort((left, right) => left.timestamp - right.timestamp)
}

export function selectTapeInspectorRequestContext(input: {
  activities: readonly TapeInspectorRequestActivity[]
  before: number
  precedingUser?: ChatMessageRecord | null
}): TapeInspectorRequestActivity[] {
  const context = input.activities
    .filter((activity) => activity.timestamp < input.before)
    .slice(-REQUEST_CONTEXT_ITEMS)
    .reverse()
  if (context.length > 0 || !input.precedingUser || input.precedingUser.role !== 'user') {
    return context
  }

  const text = userMessageText(input.precedingUser.content)
  if (!text || input.precedingUser.createdAt >= input.before) return []
  return [
    {
      key: `user:${input.precedingUser.id}`,
      kind: 'user',
      timestamp: input.precedingUser.createdAt,
      ...boundedActivityText(text)
    }
  ]
}
