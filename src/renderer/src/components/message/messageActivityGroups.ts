import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import { parseLiveDelegationSpawnBlock } from '@/lib/liveDelegationToolCall'

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
  | {
      kind: 'mcp-app'
      key: string
      block: DisplayAssistantMessageBlock
    }

export type BuildAssistantRenderItemsOptions = {
  blocks: DisplayAssistantMessageBlock[]
  messageId: string
  messageUpdatedAt: number
  shouldGroup: boolean
  isInternalToolCall?: (block: DisplayAssistantMessageBlock) => boolean
}

export type ActivityDurationLabels = {
  day: string
  hour: string
  minute: string
  second: string
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

export const isProviderSearchBlock = (block: DisplayAssistantMessageBlock): boolean => {
  if (block.type !== 'search') return false
  const actionType = block.extra?.actionType
  return actionType === 'search' || actionType === 'open_page' || actionType === 'find_in_page'
}

const isFiniteTimestamp = (value: number): boolean => Number.isFinite(value) && value >= 0

const normalizeTimestamp = (value: number, fallback: number): number =>
  isFiniteTimestamp(value) ? value : fallback

const isReasoningActivityBlock = (block: DisplayAssistantMessageBlock): boolean =>
  (block.type === 'reasoning_content' || block.type === 'artifact-thinking') &&
  typeof block.content === 'string' &&
  block.content.trim().length > 0

const isEmptyReasoningBlock = (block: DisplayAssistantMessageBlock): boolean =>
  (block.type === 'reasoning_content' || block.type === 'artifact-thinking') &&
  (typeof block.content !== 'string' || block.content.trim().length === 0)

export const isCompletedActivityBlock = (block: DisplayAssistantMessageBlock): boolean => {
  if (!ACTIVITY_BLOCK_TYPES.has(block.type) && !isProviderSearchBlock(block)) {
    return false
  }

  if (block.status === 'loading' || block.status === 'pending') {
    return false
  }

  if (block.type === 'tool_call' || isProviderSearchBlock(block)) {
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
  return stableId ? `${messageId}:${stableId}:${index}` : `${messageId}:${index}`
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

  const pushStandaloneBlock = (block: DisplayAssistantMessageBlock, index: number) => {
    const key = buildBlockKey(block, messageId, index)
    const hasMcpApp = block.type === 'tool_call' && Boolean(block.tool_call?.mcpResult?.app)
    items.push({
      kind: 'block',
      key: hasMcpApp ? `${key}:tool` : key,
      block
    })
    if (hasMcpApp) {
      items.push({
        kind: 'mcp-app',
        key: `${key}:app`,
        block
      })
    }
  }

  const flushActivityBuffer = () => {
    if (activityBuffer.length === 0) {
      return
    }

    const group = buildActivityGroupItem(messageId, messageUpdatedAt, activityBuffer)
    if (group) {
      items.push(group)
    }
    for (const { block, index } of activityBuffer) {
      if (block.type === 'tool_call' && block.tool_call?.mcpResult?.app) {
        items.push({
          kind: 'mcp-app',
          key: `${buildBlockKey(block, messageId, index)}:app`,
          block
        })
      }
    }
    activityBuffer = []
  }

  blocks.forEach((block, index) => {
    if (block.type === 'tool_call' && isInternalToolCall?.(block)) {
      return
    }

    if (shouldGroup && isEmptyReasoningBlock(block)) {
      return
    }

    if (shouldGroup && parseLiveDelegationSpawnBlock(block)) {
      flushActivityBuffer()
      items.push({
        kind: 'block',
        key: buildBlockKey(block, messageId, index),
        block
      })
      return
    }

    if (shouldGroup && isCompletedActivityBlock(block)) {
      activityBuffer.push({ block, index })
      return
    }

    flushActivityBuffer()
    pushStandaloneBlock(block, index)
  })

  flushActivityBuffer()
  return items
}

export const formatActivityDuration = (
  durationMs: number,
  labels: ActivityDurationLabels
): string => {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  let remainingSeconds = Math.floor(safeDurationMs / 1000)
  const days = Math.floor(remainingSeconds / 86_400)
  remainingSeconds %= 86_400
  const hours = Math.floor(remainingSeconds / 3_600)
  remainingSeconds %= 3_600
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60

  const parts = [
    days > 0 ? `${days}${labels.day}` : '',
    hours > 0 ? `${hours}${labels.hour}` : '',
    minutes > 0 ? `${minutes}${labels.minute}` : '',
    seconds > 0 || (days === 0 && hours === 0 && minutes === 0) ? `${seconds}${labels.second}` : ''
  ]
  return parts.filter(Boolean).join('').trimEnd()
}
