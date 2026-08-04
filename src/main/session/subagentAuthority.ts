import { normalizeDisabledAgentTools } from '@/agent/shared/agentSessionNormalization'

export function mergeSubagentToolRestrictions(...disabledToolLists: string[][]): string[] {
  return normalizeDisabledAgentTools(disabledToolLists.flat())
}

export function intersectSubagentMcpAllowLists(
  ...allowLists: Array<string[] | null | undefined>
): string[] | undefined {
  let intersection: Set<string> | null = null

  for (const allowList of allowLists) {
    if (allowList === null || allowList === undefined) continue
    const normalized = new Set(
      allowList
        .filter((serverId): serverId is string => typeof serverId === 'string')
        .map((serverId) => serverId.trim())
        .filter(Boolean)
    )
    if (intersection === null) {
      intersection = normalized
      continue
    }
    const current = intersection as Set<string>
    intersection = new Set([...current].filter((serverId) => normalized.has(serverId)))
  }

  return intersection === null
    ? undefined
    : [...intersection].sort((left, right) => left.localeCompare(right))
}
