import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type {
  DisplayAssistantMessageBlock,
  DisplayUserMessageContent
} from '@/features/chat-page/model/displayMessage'
import { collectVisibleUserMessageText } from '@/features/chat-page/model/displayUserMessageText'

const PREVIEW_SOURCE_CHARACTERS = 2_048
const PREVIEW_OUTPUT_CHARACTERS = 220
const REQUEST_ACTIVITY_CHARACTERS = 32_768
const REQUEST_CONTEXT_ITEMS = 8
const REQUEST_OUTPUT_ITEMS = 12

export interface TapeInspectorMessagePreview {
  role: ChatMessageRecord['role']
  text: string
}

export type TapeInspectorRequestActivityKind =
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool'
  | 'error'
  | 'media'

export interface TapeInspectorRequestActivity {
  key: string
  kind: TapeInspectorRequestActivityKind
  text: string
  preview: string
  contextText?: string
  timestamp: number
  blockIndex: number
  providerLogicalRound?: number
  providerRequestSeq?: number
  providerPhysicalAttempt?: number
  truncated: boolean
}

export type TapeInspectorRequestAfterBasis = 'identity' | 'chronological'

export interface TapeInspectorRequestObservation {
  before: TapeInspectorRequestActivity[]
  after: TapeInspectorRequestActivity[]
  afterBasis: TapeInspectorRequestAfterBasis | null
  afterTruncated: boolean
}

export interface TapeInspectorRequestRowActivity {
  activity: TapeInspectorRequestActivity
  relation: 'input' | 'output' | 'later'
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

  return blocks.flatMap((block, index): TapeInspectorRequestActivity[] => {
    if (!Number.isFinite(block.timestamp)) return []
    const base = {
      key: `${block.id ?? block.type}:${index}:${block.timestamp}`,
      timestamp: block.timestamp,
      blockIndex: index,
      ...(typeof block.extra?.providerLogicalRound === 'number' &&
      Number.isSafeInteger(block.extra.providerLogicalRound) &&
      block.extra.providerLogicalRound >= 0
        ? { providerLogicalRound: block.extra.providerLogicalRound }
        : {}),
      ...(typeof block.extra?.providerRequestSeq === 'number' &&
      Number.isSafeInteger(block.extra.providerRequestSeq) &&
      block.extra.providerRequestSeq > 0
        ? { providerRequestSeq: block.extra.providerRequestSeq }
        : {}),
      ...(typeof block.extra?.providerPhysicalAttempt === 'number' &&
      Number.isSafeInteger(block.extra.providerPhysicalAttempt) &&
      block.extra.providerPhysicalAttempt > 0
        ? { providerPhysicalAttempt: block.extra.providerPhysicalAttempt }
        : {})
    }
    if (
      (block.type === 'content' || block.type === 'search') &&
      typeof block.content === 'string' &&
      block.content.trim()
    ) {
      return [{ ...base, kind: 'assistant', ...boundedActivityText(block.content) }]
    }
    if (
      block.type === 'reasoning_content' &&
      typeof block.content === 'string' &&
      block.content.trim()
    ) {
      return [{ ...base, kind: 'reasoning', ...boundedActivityText(block.content) }]
    }
    if (block.type === 'tool_call' || block.action_type === 'tool_call_permission') {
      const toolName = [block.tool_call?.server_name, block.tool_call?.name]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' / ')
      const parameters =
        typeof block.tool_call?.params === 'string' ? block.tool_call.params.trim() : ''
      return [
        {
          ...base,
          kind: 'tool',
          contextText: toolName,
          ...boundedActivityText([toolName, parameters].filter(Boolean).join('\n'))
        }
      ]
    }
    if (block.type === 'error') {
      return [
        {
          ...base,
          kind: 'error',
          ...boundedActivityText(typeof block.content === 'string' ? block.content : '')
        }
      ]
    }
    if (block.type === 'image' || block.type === 'video' || block.type === 'audio') {
      return [{ ...base, kind: 'media', ...boundedActivityText('') }]
    }
    return []
  })
}

function compareActivityTime(
  left: TapeInspectorRequestActivity,
  right: TapeInspectorRequestActivity
): number {
  return left.timestamp - right.timestamp || left.blockIndex - right.blockIndex
}

function selectRequestContext(input: {
  activities: readonly TapeInspectorRequestActivity[]
  before: number
  precedingUser?: ChatMessageRecord | null
}): TapeInspectorRequestActivity[] {
  const context = input.activities
    .filter((activity) => activity.timestamp < input.before)
    .flatMap((activity): TapeInspectorRequestActivity[] => {
      if (activity.kind === 'assistant') return [activity]
      if (activity.kind !== 'tool') return []
      const toolName = activity.contextText ?? activity.text.split('\n', 1)[0] ?? ''
      return [{ ...activity, ...boundedActivityText(toolName) }]
    })
    .sort(compareActivityTime)
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
      blockIndex: -1,
      ...boundedActivityText(text)
    }
  ]
}

export function selectTapeInspectorRequestContext(input: {
  activities: readonly TapeInspectorRequestActivity[]
  before: number
  precedingUser?: ChatMessageRecord | null
}): TapeInspectorRequestActivity[] {
  return selectRequestContext(input)
}

export function selectTapeInspectorRequestObservation(input: {
  activities: readonly TapeInspectorRequestActivity[]
  createdAt: number
  requestSeq: number
  logicalRound?: number
  physicalAttempt?: number
  nextTraceCreatedAt?: number
  precedingUser?: ChatMessageRecord | null
}): TapeInspectorRequestObservation {
  const before = selectRequestContext({
    activities: input.activities,
    before: input.createdAt,
    precedingUser: input.precedingUser
  })
  const exact = input.activities
    .filter(
      (activity) =>
        activity.providerRequestSeq === input.requestSeq &&
        (input.logicalRound === undefined ||
          activity.providerLogicalRound === input.logicalRound) &&
        (input.physicalAttempt === undefined ||
          activity.providerPhysicalAttempt === input.physicalAttempt)
    )
    .sort((left, right) => right.blockIndex - left.blockIndex)
  if (exact.length > 0) {
    return {
      before,
      after: exact.slice(0, REQUEST_OUTPUT_ITEMS),
      afterBasis: 'identity',
      afterTruncated: exact.length > REQUEST_OUTPUT_ITEMS
    }
  }

  const chronological = input.activities
    .filter(
      (activity) =>
        activity.timestamp > input.createdAt &&
        (input.nextTraceCreatedAt === undefined || activity.timestamp < input.nextTraceCreatedAt)
    )
    .sort((left, right) => compareActivityTime(right, left))
  return {
    before,
    after: chronological.slice(0, REQUEST_OUTPUT_ITEMS),
    afterBasis: chronological.length > 0 ? 'chronological' : null,
    afterTruncated: chronological.length > REQUEST_OUTPUT_ITEMS
  }
}

export function selectTapeInspectorRequestRowActivity(
  observation: TapeInspectorRequestObservation
): TapeInspectorRequestRowActivity | null {
  if (observation.after.length > 0) {
    const selectedActivity = observation.after[0]
    const activity =
      selectedActivity?.kind === 'tool'
        ? {
            ...selectedActivity,
            ...boundedActivityText(selectedActivity.contextText ?? '')
          }
        : selectedActivity
    if (activity) {
      return {
        activity,
        relation: observation.afterBasis === 'identity' ? 'output' : 'later'
      }
    }
  }
  return observation.before[0] ? { activity: observation.before[0], relation: 'input' } : null
}
