import type { MessageMetadata } from '@shared/types/agent-interface'

export function incrementToolCallAccounting(metadata: MessageMetadata): MessageMetadata {
  const currentToolCalls =
    typeof metadata.toolCalls === 'number' &&
    Number.isFinite(metadata.toolCalls) &&
    metadata.toolCalls >= 0
      ? Math.floor(metadata.toolCalls)
      : 0
  return { ...metadata, toolCalls: currentToolCalls + 1 }
}

export function stampTerminalMetadata(
  metadata: MessageMetadata,
  runOutcome: 'completed' | 'aborted' | 'error',
  runStopReason: string,
  runId?: string
): MessageMetadata {
  return { ...metadata, ...(runId ? { runId } : {}), runOutcome, runStopReason }
}

export function buildUsageFromMetadata(
  metadata: MessageMetadata
): Record<string, number> | undefined {
  const usage: Record<string, number> = {}
  for (const key of [
    'totalTokens',
    'inputTokens',
    'outputTokens',
    'cachedInputTokens',
    'cacheWriteInputTokens'
  ] as const) {
    const value = metadata[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      usage[key] = value
    }
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}
