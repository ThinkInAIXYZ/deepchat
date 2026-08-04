import { normalizeDisabledAgentTools } from '@/agent/shared/agentSessionNormalization'

export interface SubagentAuthoritySource {
  disabledAgentTools?: readonly string[] | null
  enabledMcpServerIds?: readonly string[] | null
}

export interface ComposedSubagentAuthority {
  disabledAgentTools: string[]
  enabledMcpServerIds: string[] | undefined
}

export function composeSubagentAuthority(
  ...sources: readonly SubagentAuthoritySource[]
): ComposedSubagentAuthority {
  return {
    disabledAgentTools: normalizeDisabledAgentTools(
      sources.flatMap((source) => source.disabledAgentTools ?? [])
    ),
    enabledMcpServerIds: intersectMcpAllowLists(sources.map((source) => source.enabledMcpServerIds))
  }
}

function intersectMcpAllowLists(
  allowLists: ReadonlyArray<readonly string[] | null | undefined>
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
