import type {
  AgentMemoryEmbeddingState,
  AgentMemoryKind,
  AgentMemoryLifecycleState,
  AgentMemoryStatus
} from './types'
import {
  AGENT_MEMORY_EMBEDDING_STATES,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS,
  AGENT_MEMORY_LIFECYCLE_STATES
} from '@shared/types/agent-memory'

export interface CanonicalMemoryState {
  lifecycleState: AgentMemoryLifecycleState
  embeddingState: AgentMemoryEmbeddingState
}

export type MemoryEmbeddingRefsState = 'none' | 'complete' | 'partial'

export interface MemoryTransitionSnapshot extends CanonicalMemoryState {
  kind: AgentMemoryKind
  embeddingRefsState: MemoryEmbeddingRefsState
  supersededBy: string | null
  conflictState: 'challenged' | null
  conflictWith: string | null
}

export interface LegacyMemoryStateSource {
  status: AgentMemoryStatus
  kind: AgentMemoryKind
  embedding_id?: string | null
  embedding_dim?: number | null
  embedding_model?: string | null
}

export interface TolerantLegacyMemoryStateSource {
  status: unknown
  kind: AgentMemoryKind
  embedding_id?: string | null
  embedding_dim?: number | null
  embedding_model?: string | null
}

export interface CanonicalMemoryStateSource {
  lifecycle_state: AgentMemoryLifecycleState
  embedding_state: AgentMemoryEmbeddingState
  kind: AgentMemoryKind
  superseded_by?: string | null
}

export type MemoryTransitionReason =
  | 'archive_active'
  | 'restore_archived'
  | 'revive_superseded'
  | 'activate_challenger'
  | 'archive_challenger'
  | 'archive_conflict_target'
  | 'user_content'
  | 'internal_content'

const LEGACY_STATUS_SET: ReadonlySet<unknown> = new Set(AGENT_MEMORY_HEALTH_STATUS_KEYS)
const MEMORY_KIND_SET: ReadonlySet<unknown> = new Set(AGENT_MEMORY_HEALTH_KIND_KEYS)
const LIFECYCLE_STATE_SET: ReadonlySet<unknown> = new Set(AGENT_MEMORY_LIFECYCLE_STATES)
const EMBEDDING_STATE_SET: ReadonlySet<unknown> = new Set(AGENT_MEMORY_EMBEDDING_STATES)

export function isAgentMemoryKind(value: unknown): value is AgentMemoryKind {
  return MEMORY_KIND_SET.has(value)
}

export function isAgentMemoryLifecycleState(value: unknown): value is AgentMemoryLifecycleState {
  return LIFECYCLE_STATE_SET.has(value)
}

export function isAgentMemoryEmbeddingState(value: unknown): value is AgentMemoryEmbeddingState {
  return EMBEDDING_STATE_SET.has(value)
}

export function isLegacyAgentMemoryStatus(value: unknown): value is AgentMemoryStatus {
  return LEGACY_STATUS_SET.has(value)
}

function hasCompleteEmbeddingRefs(
  row: Pick<TolerantLegacyMemoryStateSource, 'embedding_id' | 'embedding_dim' | 'embedding_model'>
): boolean {
  return (
    row.embedding_id != null &&
    row.embedding_dim != null &&
    row.embedding_dim > 0 &&
    row.embedding_model != null &&
    row.embedding_model.length > 0
  )
}

export function deriveCanonicalStateFromLegacy(row: LegacyMemoryStateSource): CanonicalMemoryState {
  return normalizeCanonicalStateFromLegacy(row).state
}

export function normalizeCanonicalStateFromLegacy(row: TolerantLegacyMemoryStateSource): {
  state: CanonicalMemoryState
  repairedLegacyStatus: boolean
} {
  const status = isLegacyAgentMemoryStatus(row.status) ? row.status : null
  const lifecycleState: AgentMemoryLifecycleState =
    status === 'archived' ? 'archived' : status === 'conflicted' ? 'conflicted' : 'active'

  let embeddingState: AgentMemoryEmbeddingState
  if (row.kind === 'persona' || row.kind === 'working') {
    embeddingState = 'not_applicable'
  } else if (status === 'embedded') {
    embeddingState = 'ready'
  } else if (status === 'error') {
    embeddingState = 'error'
  } else if (status === 'fts_only') {
    embeddingState = 'fts_only'
  } else if (status === 'pending_embedding') {
    embeddingState = 'pending'
  } else {
    embeddingState = hasCompleteEmbeddingRefs(row) ? 'ready' : 'pending'
  }

  return {
    state: { lifecycleState, embeddingState },
    repairedLegacyStatus: status === null
  }
}

export function projectLegacyStatus(
  lifecycleState: AgentMemoryLifecycleState,
  embeddingState: AgentMemoryEmbeddingState
): AgentMemoryStatus {
  if (lifecycleState === 'archived') return 'archived'
  if (lifecycleState === 'conflicted') return 'conflicted'
  if (embeddingState === 'ready') return 'embedded'
  if (embeddingState === 'error') return 'error'
  if (embeddingState === 'fts_only' || embeddingState === 'not_applicable') return 'fts_only'
  return 'pending_embedding'
}

export function isRecallableMemoryState(row: CanonicalMemoryStateSource): boolean {
  return (
    row.lifecycle_state === 'active' &&
    row.superseded_by == null &&
    row.kind !== 'persona' &&
    row.kind !== 'working'
  )
}

export function isEmbeddingEligibleState(row: CanonicalMemoryStateSource): boolean {
  return isRecallableMemoryState(row) && row.embedding_state === 'pending'
}

export function assertValidMemoryInsertState(input: {
  kind: AgentMemoryKind
  lifecycleState: AgentMemoryLifecycleState
  embeddingState: AgentMemoryEmbeddingState
  conflictWith: string | null
}): void {
  const internal = input.kind === 'persona' || input.kind === 'working'
  const valid = internal
    ? input.lifecycleState === 'active' &&
      input.embeddingState === 'not_applicable' &&
      input.conflictWith === null
    : input.lifecycleState === 'conflicted'
      ? input.embeddingState === 'pending' && input.conflictWith !== null
      : input.lifecycleState === 'active' &&
        input.embeddingState === 'pending' &&
        input.conflictWith === null
  if (!valid) {
    throw new Error(
      `Invalid memory insert state: ${input.kind}/${input.lifecycleState}/${input.embeddingState}`
    )
  }
}

export function assertValidMemoryTransition(
  previous: MemoryTransitionSnapshot,
  next: MemoryTransitionSnapshot,
  reason: MemoryTransitionReason
): void {
  const internal = previous.kind === 'persona' || previous.kind === 'working'
  const noConflict = previous.conflictState === null && previous.conflictWith === null
  const nextNoConflict = next.conflictState === null && next.conflictWith === null
  const validIntent = (() => {
    switch (reason) {
      case 'archive_active':
        return (
          !internal &&
          previous.lifecycleState === 'active' &&
          previous.supersededBy === null &&
          noConflict &&
          next.lifecycleState === 'archived' &&
          next.embeddingState === previous.embeddingState &&
          next.embeddingRefsState === previous.embeddingRefsState &&
          next.supersededBy === null &&
          nextNoConflict
        )
      case 'restore_archived':
        return (
          !internal &&
          previous.lifecycleState === 'archived' &&
          previous.supersededBy === null &&
          noConflict &&
          next.lifecycleState === 'active' &&
          next.embeddingState === 'pending' &&
          next.embeddingRefsState === 'none' &&
          next.supersededBy === null &&
          nextNoConflict
        )
      case 'revive_superseded':
        return (
          !internal &&
          previous.lifecycleState === 'active' &&
          previous.supersededBy !== null &&
          noConflict &&
          next.lifecycleState === 'active' &&
          next.embeddingState === 'pending' &&
          next.embeddingRefsState === 'none' &&
          next.supersededBy === null &&
          nextNoConflict
        )
      case 'activate_challenger':
        return (
          !internal &&
          previous.lifecycleState === 'conflicted' &&
          previous.supersededBy === null &&
          previous.conflictState === null &&
          previous.conflictWith !== null &&
          next.lifecycleState === 'active' &&
          next.embeddingState === 'pending' &&
          next.embeddingRefsState === 'none' &&
          next.supersededBy === null &&
          nextNoConflict
        )
      case 'archive_challenger':
        return (
          !internal &&
          previous.lifecycleState === 'conflicted' &&
          previous.supersededBy === null &&
          previous.conflictState === null &&
          previous.conflictWith !== null &&
          next.lifecycleState === 'archived' &&
          next.embeddingState === previous.embeddingState &&
          next.embeddingRefsState === previous.embeddingRefsState &&
          next.supersededBy !== null &&
          nextNoConflict
        )
      case 'archive_conflict_target':
        return (
          !internal &&
          previous.lifecycleState === 'active' &&
          previous.supersededBy === null &&
          previous.conflictState === 'challenged' &&
          previous.conflictWith === null &&
          next.lifecycleState === 'archived' &&
          next.embeddingState === previous.embeddingState &&
          next.embeddingRefsState === previous.embeddingRefsState &&
          next.supersededBy !== null &&
          nextNoConflict
        )
      case 'user_content':
        return (
          !internal &&
          previous.lifecycleState === 'active' &&
          previous.supersededBy === null &&
          noConflict &&
          next.lifecycleState === 'active' &&
          next.embeddingState === 'pending' &&
          next.embeddingRefsState === 'none' &&
          next.supersededBy === null &&
          nextNoConflict
        )
      case 'internal_content':
        return (
          internal &&
          previous.lifecycleState === 'active' &&
          previous.supersededBy === null &&
          noConflict &&
          next.lifecycleState === 'active' &&
          next.embeddingState === 'not_applicable' &&
          next.embeddingRefsState === 'none' &&
          next.supersededBy === null &&
          nextNoConflict
        )
    }
  })()

  if (previous.kind !== next.kind || !validIntent) {
    throw new Error(
      `Invalid memory transition for ${reason}: ${previous.lifecycleState}/${previous.embeddingState} -> ${next.lifecycleState}/${next.embeddingState}`
    )
  }
}
