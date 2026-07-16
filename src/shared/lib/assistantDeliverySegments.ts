import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { summarizeToolCallPreview } from '@shared/lib/toolCallSummary'

const TRACE_PREVIEW_LIMIT = 160

export interface AssistantDeliverySegment {
  key: string
  kind: 'process' | 'answer' | 'terminal'
  text: string
  sourceMessageId: string
}

const normalizeText = (value: string | undefined | null): string =>
  (value ?? '').replace(/\r\n/g, '\n').trim()

const truncateSingleLine = (value: string, limit: number): string => {
  const normalized = value.trim()
  if (!normalized) return ''
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`
}

const escapeTracePreview = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

const getTracePreview = (
  value: string | undefined | null,
  toolName?: string,
  fallback: string = '(none)',
  limit: number = TRACE_PREVIEW_LIMIT
): string => {
  const preview = summarizeToolCallPreview(value, { toolName }) || fallback
  return escapeTracePreview(truncateSingleLine(preview, limit))
}

const getTraceEmoji = (toolName: string): string => {
  const normalized = toolName.trim().toLowerCase()
  if (!normalized) return '🛠'
  if (normalized.includes('cron') || normalized.includes('schedule')) return '⏰'
  if (
    normalized === 'grep' ||
    normalized === 'find' ||
    normalized.includes('search') ||
    normalized.includes('grep')
  ) {
    return '🔎'
  }
  if (
    normalized === 'read' ||
    normalized === 'cat' ||
    normalized.includes('read') ||
    normalized.includes('open')
  ) {
    return '📖'
  }
  if (
    normalized === 'write' ||
    normalized === 'edit' ||
    normalized.includes('write') ||
    normalized.includes('edit')
  ) {
    return '📝'
  }
  if (normalized === 'ls' || normalized.includes('list') || normalized.includes('directory')) {
    return '📂'
  }
  if (
    normalized === 'exec' ||
    normalized === 'process' ||
    normalized.includes('exec') ||
    normalized.includes('process') ||
    normalized.includes('terminal') ||
    normalized.includes('shell') ||
    normalized.includes('command')
  ) {
    return '💻'
  }
  return '🛠'
}

export const getAssistantProcessLogLines = (block: AssistantMessageBlock): string[] => {
  if (
    block.type !== 'tool_call' ||
    (block.status === 'pending' && block.extra?.toolCallArgsComplete !== true)
  ) {
    return []
  }

  const toolName = normalizeText(block.tool_call?.name) || 'unknown_tool'
  const lines = [
    `${getTraceEmoji(toolName)} ${toolName}: "${getTracePreview(block.tool_call?.params, toolName)}"`
  ]
  if (block.status === 'error') {
    lines.push(
      `❌ ${toolName}: "${getTracePreview(
        block.tool_call?.response || block.content,
        undefined,
        'error'
      )}"`
    )
  }
  return lines
}

export function buildAssistantDeliverySegments(
  messageId: string,
  blocks: AssistantMessageBlock[]
): AssistantDeliverySegment[] {
  const segments: AssistantDeliverySegment[] = []
  let current: { key: string; kind: 'process' | 'answer'; parts: string[] } | null = null

  const flushCurrent = () => {
    if (!current) return
    const text = current.parts.join(current.kind === 'process' ? '\n' : '\n\n').trim()
    if (text) {
      segments.push({
        key: current.key,
        kind: current.kind,
        text,
        sourceMessageId: messageId
      })
    }
    current = null
  }

  for (const [index, block] of blocks.entries()) {
    const processLines = getAssistantProcessLogLines(block)
    if (processLines.length > 0) {
      if (!current || current.kind !== 'process') {
        flushCurrent()
        current = { key: `${messageId}:${index}:process`, kind: 'process', parts: [] }
      }
      current.parts.push(...processLines)
      continue
    }

    if (block.type !== 'content') continue
    const content = normalizeText(block.content)
    if (!content) continue
    if (!current || current.kind !== 'answer') {
      flushCurrent()
      current = { key: `${messageId}:${index}:answer`, kind: 'answer', parts: [] }
    }
    current.parts.push(content)
  }

  flushCurrent()
  return segments
}
