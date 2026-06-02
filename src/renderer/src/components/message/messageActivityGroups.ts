import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

export type AssistantRenderItem =
  | {
      kind: 'block'
      key: string
      block: DisplayAssistantMessageBlock
    }
  | {
      kind: 'activity-group'
      key: string
      blocks: DisplayAssistantMessageBlock[]
      startedAt: number
      endedAt: number
      durationMs: number
      reasoningCount: number
      toolCallCount: number
    }

export type BuildAssistantRenderItemsOptions = {
  blocks: DisplayAssistantMessageBlock[]
  messageId: string
  messageUpdatedAt: number
  shouldGroup: boolean
  isInternalToolCall?: (block: DisplayAssistantMessageBlock) => boolean
}

type BufferedActivityBlock = {
  block: DisplayAssistantMessageBlock
  index: number
}

const ACTIVITY_BLOCK_TYPES = new Set<DisplayAssistantMessageBlock['type']>([
  'reasoning_content',
  'artifact-thinking',
  'tool_call'
])

const isFiniteTimestamp = (value: number): boolean => Number.isFinite(value) && value >= 0

const normalizeTimestamp = (value: number, fallback: number): number =>
  isFiniteTimestamp(value) ? value : fallback

const isReasoningActivityBlock = (block: DisplayAssistantMessageBlock): boolean =>
  (block.type === 'reasoning_content' || block.type === 'artifact-thinking') &&
  typeof block.content === 'string' &&
  block.content.trim().length > 0

export const isCompletedActivityBlock = (block: DisplayAssistantMessageBlock): boolean => {
  if (!ACTIVITY_BLOCK_TYPES.has(block.type)) {
    return false
  }

  if (block.status === 'loading' || block.status === 'pending') {
    return false
  }

  if (block.type === 'tool_call') {
    return true
  }

  return isReasoningActivityBlock(block)
}

const buildBlockKey = (
  block: DisplayAssistantMessageBlock,
  messageId: string,
  index: number
): string => {
  const stableId = block.id ?? block.tool_call?.id
  return stableId ? `${messageId}:${stableId}` : `${messageId}:${index}`
}

const buildGroupKey = (messageId: string, buffer: BufferedActivityBlock[]): string => {
  const first = buffer[0]?.index ?? 0
  const last = buffer[buffer.length - 1]?.index ?? first
  return `activity:${messageId}:${first}:${last}`
}

const countReasoningBlocks = (blocks: DisplayAssistantMessageBlock[]): number =>
  blocks.filter((block) => block.type === 'reasoning_content' || block.type === 'artifact-thinking')
    .length

const countToolCallBlocks = (blocks: DisplayAssistantMessageBlock[]): number =>
  blocks.filter((block) => block.type === 'tool_call').length

const buildActivityGroupItem = (
  messageId: string,
  messageUpdatedAt: number,
  buffer: BufferedActivityBlock[]
): AssistantRenderItem | null => {
  const firstBlock = buffer[0]?.block
  if (!firstBlock) {
    return null
  }

  const startedAt = normalizeTimestamp(firstBlock.timestamp, messageUpdatedAt)
  const endedAt = Math.max(startedAt, normalizeTimestamp(messageUpdatedAt, startedAt))
  const blocks = buffer.map((item) => item.block)

  return {
    kind: 'activity-group',
    key: buildGroupKey(messageId, buffer),
    blocks,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    reasoningCount: countReasoningBlocks(blocks),
    toolCallCount: countToolCallBlocks(blocks)
  }
}

export const buildAssistantRenderItems = ({
  blocks,
  messageId,
  messageUpdatedAt,
  shouldGroup,
  isInternalToolCall
}: BuildAssistantRenderItemsOptions): AssistantRenderItem[] => {
  const items: AssistantRenderItem[] = []
  let activityBuffer: BufferedActivityBlock[] = []

  const flushActivityBuffer = () => {
    if (activityBuffer.length === 0) {
      return
    }

    const group = buildActivityGroupItem(messageId, messageUpdatedAt, activityBuffer)
    if (group) {
      items.push(group)
    }
    activityBuffer = []
  }

  blocks.forEach((block, index) => {
    if (block.type === 'tool_call' && isInternalToolCall?.(block)) {
      return
    }

    if (shouldGroup && isCompletedActivityBlock(block)) {
      activityBuffer.push({ block, index })
      return
    }

    flushActivityBuffer()
    items.push({
      kind: 'block',
      key: buildBlockKey(block, messageId, index),
      block
    })
  })

  flushActivityBuffer()
  return items
}

export const formatActivityDuration = (durationMs: number, locale: string): string => {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  let remainingSeconds = Math.floor(safeDurationMs / 1000)
  const days = Math.floor(remainingSeconds / 86_400)
  remainingSeconds %= 86_400
  const hours = Math.floor(remainingSeconds / 3_600)
  remainingSeconds %= 3_600
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60

  const isChineseLocale =
    locale.toLowerCase().startsWith('zh') || locale.toLowerCase().startsWith('yue')

  if (isChineseLocale) {
    const parts = [
      days > 0 ? `${days}天` : '',
      hours > 0 ? `${hours}小时` : '',
      minutes > 0 ? `${minutes}分钟` : '',
      seconds > 0 || (days === 0 && hours === 0 && minutes === 0) ? `${seconds}秒` : ''
    ]
    return parts.filter(Boolean).join('')
  }

  const parts = [
    days > 0 ? `${days}d` : '',
    hours > 0 ? `${hours}h` : '',
    minutes > 0 ? `${minutes}m` : '',
    seconds > 0 || (days === 0 && hours === 0 && minutes === 0) ? `${seconds}s` : ''
  ]
  return parts.filter(Boolean).join(' ')
}
