const GUARD_RUN_STOP_REASONS = ['max_tool_calls', 'no_progress', 'max_turns'] as const

export type GuardRunStopReason = (typeof GUARD_RUN_STOP_REASONS)[number]

export function isGuardRunStopReason(value: unknown): value is GuardRunStopReason {
  return (GUARD_RUN_STOP_REASONS as readonly unknown[]).includes(value)
}

export function readRunStopReason(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined
  }
  const value = (metadata as { runStopReason?: unknown }).runStopReason
  if (typeof value !== 'string') return undefined
  const stopReason = value.trim()
  return stopReason.length > 0 ? stopReason : undefined
}
