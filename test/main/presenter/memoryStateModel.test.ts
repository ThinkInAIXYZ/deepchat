import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  assertValidMemoryTransition,
  deriveCanonicalStateFromLegacy,
  isEmbeddingEligibleState,
  isRecallableMemoryState,
  projectLegacyStatus
} from '@/presenter/memoryPresenter/domain/stateModel'
import type {
  AgentMemoryInsertInput,
  AgentMemoryStatus
} from '@/presenter/memoryPresenter/domain/types'
import type { MemoryTransitionSnapshot } from '@/presenter/memoryPresenter/domain/stateModel'

const LEGACY_STATUSES: AgentMemoryStatus[] = [
  'pending_embedding',
  'embedded',
  'error',
  'fts_only',
  'archived',
  'conflicted'
]

function transitionSnapshot(
  overrides: Partial<MemoryTransitionSnapshot> = {}
): MemoryTransitionSnapshot {
  return {
    lifecycleState: 'active',
    embeddingState: 'ready',
    kind: 'semantic',
    embeddingRefsState: 'complete',
    supersededBy: null,
    conflictState: null,
    conflictWith: null,
    ...overrides
  }
}

describe('memory canonical state model', () => {
  it('requires canonical insert axes to be provided together', () => {
    expectTypeOf<{
      id: 'legacy'
      agentId: 'a'
      kind: 'semantic'
      content: 'legacy input'
    }>().toMatchTypeOf<AgentMemoryInsertInput>()
    expectTypeOf<{
      id: 'canonical'
      agentId: 'a'
      kind: 'semantic'
      content: 'canonical input'
      lifecycleState: 'active'
      embeddingState: 'pending'
    }>().toMatchTypeOf<AgentMemoryInsertInput>()
    expectTypeOf<{
      id: 'partial-lifecycle'
      agentId: 'a'
      kind: 'semantic'
      content: 'partial input'
      lifecycleState: 'active'
    }>().not.toMatchTypeOf<AgentMemoryInsertInput>()
    expectTypeOf<{
      id: 'partial-embedding'
      agentId: 'a'
      kind: 'semantic'
      content: 'partial input'
      embeddingState: 'pending'
    }>().not.toMatchTypeOf<AgentMemoryInsertInput>()
  })

  it('derives and projects the complete legacy status matrix', () => {
    for (const status of LEGACY_STATUSES) {
      for (const kind of ['semantic', 'persona', 'working'] as const) {
        for (const refsComplete of [false, true]) {
          const canonical = deriveCanonicalStateFromLegacy({
            status,
            kind,
            embedding_id: refsComplete ? 'vector' : null,
            embedding_dim: refsComplete ? 4 : null,
            embedding_model: refsComplete ? 'provider:model' : null
          })

          expect(canonical.lifecycleState).toBe(
            status === 'archived' ? 'archived' : status === 'conflicted' ? 'conflicted' : 'active'
          )
          if (kind === 'persona' || kind === 'working') {
            expect(canonical.embeddingState).toBe('not_applicable')
          } else if (status === 'embedded') {
            expect(canonical.embeddingState).toBe('ready')
          } else if (status === 'error' || status === 'fts_only') {
            expect(canonical.embeddingState).toBe(status)
          } else if (status === 'pending_embedding') {
            expect(canonical.embeddingState).toBe('pending')
          } else {
            expect(canonical.embeddingState).toBe(refsComplete ? 'ready' : 'pending')
          }

          const projected = projectLegacyStatus(canonical.lifecycleState, canonical.embeddingState)
          expect(projected).toBe(
            kind === 'persona' || kind === 'working'
              ? status === 'archived' || status === 'conflicted'
                ? status
                : 'fts_only'
              : status
          )
        }
      }
    }
  })

  it('keeps recall and embedding eligibility on canonical axes', () => {
    const base = {
      lifecycle_state: 'active' as const,
      embedding_state: 'pending' as const,
      kind: 'semantic' as const,
      superseded_by: null
    }
    expect(isRecallableMemoryState(base)).toBe(true)
    expect(isEmbeddingEligibleState(base)).toBe(true)
    expect(isRecallableMemoryState({ ...base, lifecycle_state: 'archived' })).toBe(false)
    expect(isEmbeddingEligibleState({ ...base, embedding_state: 'ready' })).toBe(false)
    expect(isRecallableMemoryState({ ...base, kind: 'persona' })).toBe(false)
  })

  it('validates intent-level predecessor, conflict, supersession, and refs invariants', () => {
    expect(() =>
      assertValidMemoryTransition(
        transitionSnapshot(),
        transitionSnapshot({ lifecycleState: 'archived' }),
        'archive_active'
      )
    ).not.toThrow()
    expect(() =>
      assertValidMemoryTransition(
        transitionSnapshot({ lifecycleState: 'archived' }),
        transitionSnapshot({ embeddingState: 'pending', embeddingRefsState: 'none' }),
        'restore_archived'
      )
    ).not.toThrow()
    expect(() =>
      assertValidMemoryTransition(
        transitionSnapshot({ supersededBy: 'head' }),
        transitionSnapshot({ embeddingState: 'pending', embeddingRefsState: 'none' }),
        'revive_superseded'
      )
    ).not.toThrow()
    expect(() =>
      assertValidMemoryTransition(
        transitionSnapshot({ lifecycleState: 'conflicted', conflictWith: 'target' }),
        transitionSnapshot({ embeddingState: 'pending', embeddingRefsState: 'none' }),
        'activate_challenger'
      )
    ).not.toThrow()

    const invalidTransitions = [
      () =>
        assertValidMemoryTransition(
          transitionSnapshot({ lifecycleState: 'archived' }),
          transitionSnapshot({ lifecycleState: 'archived' }),
          'archive_active'
        ),
      () =>
        assertValidMemoryTransition(
          transitionSnapshot(),
          transitionSnapshot({ embeddingState: 'pending', embeddingRefsState: 'complete' }),
          'user_content'
        ),
      () =>
        assertValidMemoryTransition(
          transitionSnapshot({ kind: 'working', embeddingState: 'not_applicable' }),
          transitionSnapshot({ kind: 'working', embeddingState: 'pending' }),
          'internal_content'
        ),
      () =>
        assertValidMemoryTransition(
          transitionSnapshot({ lifecycleState: 'conflicted', conflictWith: null }),
          transitionSnapshot({ embeddingState: 'pending', embeddingRefsState: 'none' }),
          'activate_challenger'
        ),
      () =>
        assertValidMemoryTransition(
          transitionSnapshot(),
          transitionSnapshot({ kind: 'episodic', lifecycleState: 'archived' }),
          'archive_active'
        )
    ]
    for (const transition of invalidTransitions) {
      expect(transition).toThrow(/Invalid memory transition/)
    }
  })

  it('validates archive variants and internal content independently', () => {
    expect(() =>
      assertValidMemoryTransition(
        transitionSnapshot({ lifecycleState: 'conflicted', conflictWith: 'target' }),
        transitionSnapshot({
          lifecycleState: 'archived',
          supersededBy: 'winner',
          conflictWith: null
        }),
        'archive_challenger'
      )
    ).not.toThrow()
    expect(() =>
      assertValidMemoryTransition(
        transitionSnapshot({ conflictState: 'challenged' }),
        transitionSnapshot({ lifecycleState: 'archived', supersededBy: 'challenger' }),
        'archive_conflict_target'
      )
    ).not.toThrow()
    expect(() =>
      assertValidMemoryTransition(
        transitionSnapshot({
          kind: 'working',
          embeddingState: 'not_applicable',
          embeddingRefsState: 'none'
        }),
        transitionSnapshot({
          kind: 'working',
          embeddingState: 'not_applicable',
          embeddingRefsState: 'none'
        }),
        'internal_content'
      )
    ).not.toThrow()
  })
})
