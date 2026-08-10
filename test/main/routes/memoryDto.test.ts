import { describe, expect, it } from 'vitest'

import {
  formatMemorySourceRecordContent,
  toMemoryDirectiveDto,
  toMemoryItemDto
} from '@/memory/routes'
import {
  createEmptyMemoryHealth,
  createEmptyMemoryRuntimeDiagnostics,
  decodeMemoryPageCursor,
  encodeMemoryPageCursor,
  memoryAddRoute,
  memoryApproveDirectiveRoute,
  memoryArchiveRoute,
  memoryCreateDirectiveRoute,
  memoryDeleteDirectiveRoute,
  memoryGetArchiveCandidateLifecyclePreviewRoute,
  memoryGetByIdsRoute,
  memoryGetHealthRoute,
  memoryGetLifecycleRoute,
  memoryGetStatusRoute,
  memoryListRoute,
  memoryListDirectivesRoute,
  memoryPageRoute,
  memoryRejectDirectiveRoute,
  memoryReindexRoute,
  memoryRestoreRoute,
  memorySearchRoute,
  memoryUpdateRoute
} from '@shared/contracts/routes'
import {
  AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS,
  AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS,
  MEMORY_MAINTENANCE_BUDGET_STEPS,
  MEMORY_RECALL_LATENCY_STAGES,
  MEMORY_RETRIEVAL_DEGRADATION_CAUSES,
  MEMORY_RETRIEVAL_OUTCOMES,
  MEMORY_RETRIEVAL_PURPOSES
} from '@shared/types/agent-memory'
import { memoryUpdatedEvent } from '@shared/contracts/events/memory.events'
import type { AgentMemoryRow } from '@/memory/types'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { MemoryLifecycle } from '@shared/contracts/routes'

function makeRow(overrides: Partial<AgentMemoryRow> = {}): AgentMemoryRow {
  return {
    id: 'm1',
    agent_id: 'agent',
    user_scope: null,
    scope_type: 'agent',
    scope_id: null,
    kind: 'semantic',
    category: null,
    content: 'redis listens on 6379',
    importance: 0.5,
    lifecycle_state: 'active',
    embedding_state: 'ready',
    embedding_id: null,
    embedding_dim: null,
    embedding_model: null,
    source_session: null,
    provenance_key: null,
    is_anchor: 0,
    superseded_by: null,
    created_at: 1000,
    last_accessed: null,
    access_count: 0,
    decay_score: null,
    source_entry_ids: null,
    confidence: null,
    temporal_kind: 'atemporal',
    valid_from: null,
    valid_until: null,
    temporal_confidence: null,
    temporal_precision: null,
    temporal_timezone: null,
    last_consolidated_at: null,
    conflict_state: null,
    conflict_with: null,
    persona_state: null,
    decision_revision: 1,
    ...overrides
  }
}

function makeLifecycleRecall(): NonNullable<MemoryLifecycle['recall']> {
  return {
    weights: { similarity: 0.6, recency: 0.25, importance: 0.15 },
    similarity: 0.3,
    similaritySource: 'baseline',
    recency: 0.8,
    importance: 0.5,
    confidenceFactor: 1,
    importanceFloor: 0.075,
    final: 0.455,
    flooredByImportance: false,
    halfLifeMs: 14 * 24 * 60 * 60 * 1000
  }
}

function makeLifecycle(overrides: Partial<MemoryLifecycle> = {}): MemoryLifecycle {
  return {
    memoryId: 'm1',
    kind: 'semantic',
    status: 'embedded',
    recallable: true,
    decayTier: 'aging',
    recall: makeLifecycleRecall(),
    forget: {
      anchorAt: 1000,
      ageDays: 10,
      halfLifeDays: 45,
      decayScore: 0.8,
      materializedDecay: null,
      materializedStale: true
    },
    archiveEligibility: {
      eligible: false,
      oldEnough: false,
      decayedEnough: false,
      neverAccessed: true,
      active: true,
      exempt: false,
      exemptReasons: [],
      gaps: { daysUntilOldEnough: 80, decayAboveThresholdBy: 0.75 }
    },
    ...overrides
  }
}

function makeArchiveCandidateLifecycle(overrides: Partial<MemoryLifecycle> = {}): MemoryLifecycle {
  return makeLifecycle({
    decayTier: 'archive_candidate',
    archiveEligibility: {
      eligible: true,
      oldEnough: true,
      decayedEnough: true,
      neverAccessed: true,
      active: true,
      exempt: false,
      exemptReasons: [],
      gaps: {}
    },
    ...overrides
  })
}

describe('toMemoryItemDto sourceEntryIds passthrough', () => {
  it('deserializes a valid source_entry_ids array alongside its session', () => {
    const dto = toMemoryItemDto(
      makeRow({ source_session: 'sess-1', source_entry_ids: '[12,34,56]' })
    )
    expect(dto.sourceSession).toBe('sess-1')
    expect(dto.sourceEntryIds).toEqual([12, 34, 56])
  })

  it('returns null for null / empty / malformed / non-array source_entry_ids', () => {
    expect(toMemoryItemDto(makeRow({ source_entry_ids: null })).sourceEntryIds).toBeNull()
    expect(toMemoryItemDto(makeRow({ source_entry_ids: '' })).sourceEntryIds).toBeNull()
    expect(toMemoryItemDto(makeRow({ source_entry_ids: '{bad json' })).sourceEntryIds).toBeNull()
    expect(toMemoryItemDto(makeRow({ source_entry_ids: '{"a":1}' })).sourceEntryIds).toBeNull()
  })

  it('keeps only non-negative integers and collapses an empty result to null', () => {
    expect(
      toMemoryItemDto(makeRow({ source_entry_ids: '[1,"x",null,2.5,-3,4]' })).sourceEntryIds
    ).toEqual([1, 4])
    expect(toMemoryItemDto(makeRow({ source_entry_ids: '["x",-1,1.5]' })).sourceEntryIds).toBeNull()
  })

  it('produces output that passes the memory.list contract schema', () => {
    const memories = [
      toMemoryItemDto(makeRow({ source_session: 'sess-1', source_entry_ids: '[1,2]' })),
      toMemoryItemDto(makeRow({ id: 'm2', source_session: null, source_entry_ids: null }))
    ]
    const parsed = memoryListRoute.output.parse({ memories })
    expect(parsed.memories[0].sourceEntryIds).toEqual([1, 2])
    expect(parsed.memories[1].sourceEntryIds).toBeNull()
  })

  it('enforces temporal persistence invariants on management and search DTOs', () => {
    const atemporal = toMemoryItemDto(makeRow())
    const temporal = {
      ...atemporal,
      temporalKind: 'state' as const,
      validFrom: 100,
      validUntil: 200,
      temporalConfidence: 0.9,
      temporalPrecision: 'exact' as const,
      temporalTimeZone: 'UTC'
    }

    expect(memoryListRoute.output.safeParse({ memories: [temporal] }).success).toBe(true)
    expect(
      memorySearchRoute.output.safeParse({ results: [{ ...temporal, score: 0.8 }] }).success
    ).toBe(true)

    const malformed = [
      { ...atemporal, validFrom: 100 },
      { ...temporal, temporalConfidence: null },
      { ...temporal, temporalPrecision: null },
      { ...temporal, temporalTimeZone: null },
      { ...temporal, temporalTimeZone: '' },
      { ...temporal, temporalTimeZone: ' UTC ' },
      { ...temporal, validFrom: 200, validUntil: 200 },
      { ...temporal, validFrom: 300, validUntil: 200 }
    ]
    for (const memory of malformed) {
      expect(memoryListRoute.output.safeParse({ memories: [memory] }).success).toBe(false)
      expect(
        memorySearchRoute.output.safeParse({ results: [{ ...memory, score: 0.8 }] }).success
      ).toBe(false)
    }
  })

  it('projects pre-migration row shapes as atemporal', () => {
    const {
      temporal_kind: _temporalKind,
      valid_from: _validFrom,
      valid_until: _validUntil,
      temporal_confidence: _temporalConfidence,
      temporal_precision: _temporalPrecision,
      temporal_timezone: _temporalTimeZone,
      ...legacyRow
    } = makeRow()

    expect(toMemoryItemDto(legacyRow as unknown as AgentMemoryRow)).toMatchObject({
      temporalKind: 'atemporal',
      validFrom: null,
      validUntil: null,
      temporalConfidence: null,
      temporalPrecision: null,
      temporalTimeZone: null
    })
  })

  it('maps conflict_with to camelCase conflictWith and accepts conflicted status', () => {
    const dto = toMemoryItemDto(
      makeRow({
        lifecycle_state: 'conflicted',
        embedding_state: 'pending',
        conflict_with: 'm-target',
        conflict_state: null
      })
    )
    const parsed = memoryListRoute.output.parse({ memories: [dto] })
    expect(parsed.memories[0].status).toBe('conflicted')
    expect(parsed.memories[0].conflictWith).toBe('m-target')
    expect('conflict_with' in parsed.memories[0]).toBe(false)
  })

  it('projects canonical state even when a storage shadow is stale', () => {
    const row = { ...makeRow(), status: 'error' }
    expect(toMemoryItemDto(row).status).toBe('embedded')
  })

  it('normalizes invalid persona_state values to null', () => {
    const dto = toMemoryItemDto(makeRow({ persona_state: 'unknown' as any }))
    const parsed = memoryListRoute.output.parse({ memories: [dto] })
    expect(parsed.memories[0].personaState).toBeNull()
  })

  it('passes valid categories through and normalizes invalid values to null', () => {
    expect(toMemoryItemDto(makeRow({ category: 'project_fact' })).category).toBe('project_fact')
    expect(toMemoryItemDto(makeRow({ category: 'unknown' })).category).toBeNull()
    const parsed = memoryListRoute.output.parse({
      memories: [toMemoryItemDto(makeRow({ category: null }))]
    })
    expect(parsed.memories[0].category).toBeNull()
  })
})

describe('memory.page route contract', () => {
  it('round-trips a versioned opaque cursor and applies the default page limit', () => {
    const cursor = encodeMemoryPageCursor({ v: 1, createdAt: 1_700_000_000_000, id: 'memory-α' })
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u)
    expect(decodeMemoryPageCursor(cursor)).toEqual({
      v: 1,
      createdAt: 1_700_000_000_000,
      id: 'memory-α'
    })
    expect(memoryPageRoute.input.parse({ agentId: 'deepchat', cursor })).toEqual({
      agentId: 'deepchat',
      cursor,
      limit: 100
    })
  })

  it('rejects malformed, unsupported, and oversized cursors instead of returning page one', () => {
    const unsupported = Buffer.from(
      JSON.stringify({ v: 2, createdAt: 1000, id: 'm1' }),
      'utf8'
    ).toString('base64url')
    const unsafeTimestamp = Buffer.from(
      JSON.stringify({ v: 1, createdAt: Number.MAX_SAFE_INTEGER + 1, id: 'm1' }),
      'utf8'
    ).toString('base64url')
    for (const cursor of ['not+base64', unsupported, unsafeTimestamp, 'a'.repeat(2049)]) {
      expect(memoryPageRoute.input.safeParse({ agentId: 'deepchat', cursor }).success).toBe(false)
    }
    expect(memoryPageRoute.input.safeParse({ agentId: 'deepchat', limit: 101 }).success).toBe(false)
  })

  it('caps the output page to 100 management rows', () => {
    const items = Array.from({ length: 100 }, (_, index) =>
      toMemoryItemDto(makeRow({ id: `m${index}` }))
    )
    expect(memoryPageRoute.output.parse({ items, nextCursor: null }).items).toHaveLength(100)
    expect(
      memoryPageRoute.output.safeParse({
        items: [...items, toMemoryItemDto(makeRow({ id: 'overflow' }))],
        nextCursor: null
      }).success
    ).toBe(false)
  })
})

describe('memory.restore route contract round-trip', () => {
  it('round-trips a valid restore input and output', () => {
    const input = memoryRestoreRoute.input.parse({ agentId: 'deepchat-abc123', memoryId: 'mem-1' })
    expect(input).toEqual({ agentId: 'deepchat-abc123', memoryId: 'mem-1' })
    expect(memoryRestoreRoute.output.parse({ action: 'applied' })).toEqual({ action: 'applied' })
    expect(
      memoryRestoreRoute.output.parse({ action: 'rejected', reason: 'invalid-state' })
    ).toEqual({ action: 'rejected', reason: 'invalid-state' })
    expect(
      memoryRestoreRoute.output.safeParse({ action: 'rejected', reason: 'unexpected' }).success
    ).toBe(false)
  })

  it('rejects an illegal agentId at the contract layer', () => {
    for (const agentId of ['../etc', 'has space', '']) {
      expect(memoryRestoreRoute.input.safeParse({ agentId, memoryId: 'm1' }).success).toBe(false)
    }
  })
})

describe('memory.reindex route contract', () => {
  it('round-trips the reindex request and started response', () => {
    expect(memoryReindexRoute.input.parse({ agentId: 'deepchat-abc123' })).toEqual({
      agentId: 'deepchat-abc123'
    })
    expect(memoryReindexRoute.output.parse({ started: true })).toEqual({ started: true })
    expect(memoryReindexRoute.output.parse({ started: false })).toEqual({ started: false })
  })
})

describe('memory.getHealth route contract', () => {
  it('keeps runtime required, enum-complete, and free of unknown sensitive fields', () => {
    const runtime = createEmptyMemoryRuntimeDiagnostics()
    expect(Object.keys(runtime.agent.retrieval)).toEqual(MEMORY_RETRIEVAL_PURPOSES)
    expect(Object.keys(runtime.agent.retrieval.recall.latencyMs)).toEqual(
      MEMORY_RECALL_LATENCY_STAGES
    )
    expect(Object.keys(runtime.agent.retrieval.recall.outcomeCounts)).toEqual(
      MEMORY_RETRIEVAL_OUTCOMES
    )
    expect(Object.keys(runtime.agent.retrieval.recall.degradationCounts)).toEqual(
      MEMORY_RETRIEVAL_DEGRADATION_CAUSES
    )
    expect(runtime.agent.queryEmbeddingCircuit).toEqual({
      state: 'closed',
      failures: 0,
      openCount: 0,
      skipped: 0
    })
    expect(Object.keys(runtime.agent.maintenance.budgetDeniedByStep)).toEqual(
      MEMORY_MAINTENANCE_BUDGET_STEPS
    )

    const healthWithoutRuntime = { ...createEmptyMemoryHealth() } as Record<string, unknown>
    delete healthWithoutRuntime.runtime
    expect(memoryGetHealthRoute.output.safeParse({ health: healthWithoutRuntime }).success).toBe(
      false
    )

    const marker = 'fixture-secret-marker'
    const parsed = memoryGetHealthRoute.output.parse({
      health: {
        ...createEmptyMemoryHealth(),
        runtime: {
          ...runtime,
          query: marker,
          process: { ...runtime.process, providerResponse: marker }
        }
      }
    })
    expect(JSON.stringify(parsed)).not.toContain(marker)
  })

  it('round-trips a fully populated Agent/process runtime snapshot', () => {
    const runtime = createEmptyMemoryRuntimeDiagnostics()
    runtime.agent.retrieval.recall.latencyMs.total = { samples: 3, p50: 4, p95: 8, max: 9 }
    runtime.agent.retrieval.recall.ftsCandidates = 7
    runtime.agent.retrieval.recall.vectorCandidates = 5
    runtime.agent.retrieval.recall.selected = 3
    runtime.agent.retrieval.recall.degradationCounts.vectorCold = 2
    runtime.agent.queryEmbeddingCircuit = {
      state: 'halfOpen',
      failures: 3,
      openCount: 1,
      skipped: 4
    }
    runtime.agent.extraction = {
      chunksCompleted: 4,
      chunksCancelled: 2,
      chunksFailed: 1,
      llmCalls: 2,
      casRetries: 3
    }
    runtime.agent.embedding.succeeded = 6
    runtime.agent.embedding.failed = 1
    runtime.agent.maintenance.llmCalls = 2
    runtime.agent.maintenance.llmTokens = 120
    runtime.agent.maintenance.budgetDeniedByStep.merge = 1
    runtime.process.extractionQueue = { depth: 2, oldestQueuedAgeMs: 50 }
    runtime.process.embeddingBacklog = { pending: 8, activeAgents: 2 }
    runtime.process.vector = {
      openStores: 2,
      openStoresHighWater: 4,
      activeLeases: 1,
      activeLeasesHighWater: 3,
      evictions: 5,
      warmupSucceeded: 6,
      warmupDeferred: 2,
      warmupFailed: 1
    }
    runtime.process.providerAdmission = {
      queued: 2,
      admissionDecisions: { admitted: 9, rateLimited: 2, capacityRejected: 1 },
      raceEvents: { deadline: 1, aborted: 1, lateSettled: 1 }
    }

    const parsed = memoryGetHealthRoute.output.parse({
      health: { ...createEmptyMemoryHealth(), runtime }
    })
    expect(parsed.health.runtime).toEqual(runtime)
  })

  it('round-trips the empty health DTO and a populated bounded preview', () => {
    expect(memoryGetHealthRoute.input.parse({ agentId: 'deepchat' })).toEqual({
      agentId: 'deepchat'
    })

    const empty = memoryGetHealthRoute.output.parse({ health: createEmptyMemoryHealth() })
    expect(empty.health.totalRows).toBe(0)
    expect(empty.health.maintenance.scanLimit).toBe(200)
    expect(createEmptyMemoryHealth(0).maintenance.scanLimit).toBe(1)

    const populated = memoryGetHealthRoute.output.parse({
      health: {
        ...createEmptyMemoryHealth(),
        totalRows: 1,
        byKind: {
          episodic: 0,
          semantic: 1,
          reflection: 0,
          persona: 0,
          working: 0
        },
        byCategory: {
          user_preference: 0,
          project_fact: 1,
          task_outcome: 0,
          heuristic: 0,
          anti_pattern: 0,
          uncategorized: 0
        },
        byStatus: {
          pending_embedding: 0,
          embedded: 1,
          error: 0,
          fts_only: 0,
          archived: 0,
          conflicted: 0
        },
        access: {
          topAccessed: [
            {
              id: 'm1',
              kind: 'semantic',
              category: 'project_fact',
              content: 'repo uses pnpm',
              importance: 0.6,
              accessCount: 2,
              lastAccessed: 123
            }
          ],
          neverAccessed: 0
        }
      }
    })
    expect(populated.health.access.topAccessed[0].category).toBe('project_fact')
    expect(memoryGetHealthRoute.input.safeParse({ agentId: 'bad/id' }).success).toBe(false)
  })
})

describe('memory.getLifecycle route contract', () => {
  it('round-trips lifecycle input and output without Ebbinghaus fields', () => {
    expect(memoryGetLifecycleRoute.input.parse({ agentId: 'deepchat', memoryId: 'm1' })).toEqual({
      agentId: 'deepchat',
      memoryId: 'm1'
    })
    expect(() =>
      memoryGetLifecycleRoute.input.parse({ agentId: 'deepchat', memoryId: '' })
    ).toThrow()
    expect(() => memoryGetLifecycleRoute.input.parse({ agentId: 'deepchat' })).toThrow()

    const parsed = memoryGetLifecycleRoute.output.parse({
      lifecycle: makeLifecycle()
    })

    expect(parsed.lifecycle?.memoryId).toBe('m1')
    expect(memoryGetLifecycleRoute.output.safeParse({ lifecycle: null }).success).toBe(true)
    expect(
      memoryGetLifecycleRoute.output.safeParse({ lifecycles: [makeLifecycle()] }).success
    ).toBe(false)
    expect(JSON.stringify(parsed)).not.toMatch(/nextReview|reinforcement|promotion|reviewInterval/)
  })

  it('rejects lifecycle outputs that violate public lifecycle invariants', () => {
    const workingLifecycle = { ...makeLifecycle(), kind: 'working' }

    expect(memoryGetLifecycleRoute.output.safeParse({ lifecycle: workingLifecycle }).success).toBe(
      false
    )
    expect(
      memoryGetLifecycleRoute.output.safeParse({
        lifecycle: makeLifecycle({ kind: 'semantic', recall: null })
      }).success
    ).toBe(false)
    expect(
      memoryGetLifecycleRoute.output.safeParse({
        lifecycle: makeLifecycle({ kind: 'persona', recall: makeLifecycleRecall() })
      }).success
    ).toBe(false)
    expect(
      memoryGetLifecycleRoute.output.safeParse({
        lifecycle: makeLifecycle({ kind: 'persona', recall: null })
      }).success
    ).toBe(true)
  })

  it('round-trips archive candidate lifecycle predictions', () => {
    const parsed = memoryGetArchiveCandidateLifecyclePreviewRoute.output.parse({
      preview: {
        lifecycles: [makeArchiveCandidateLifecycle()],
        previewLimit: 25,
        scanLimit: 200,
        scanned: 1,
        previewTruncated: false,
        scanTruncated: false
      }
    })

    expect(
      memoryGetArchiveCandidateLifecyclePreviewRoute.input.parse({ agentId: 'deepchat' })
    ).toEqual({
      agentId: 'deepchat'
    })
    expect(parsed.preview.lifecycles[0].decayTier).toBe('archive_candidate')
    expect(
      memoryGetArchiveCandidateLifecyclePreviewRoute.input.safeParse({ agentId: 'bad/id' }).success
    ).toBe(false)
    expect(
      memoryGetArchiveCandidateLifecyclePreviewRoute.output.safeParse({
        preview: {
          lifecycles: Array.from({ length: 26 }, (_, index) =>
            makeArchiveCandidateLifecycle({ memoryId: `m${index}` })
          ),
          previewLimit: 25,
          scanLimit: 200,
          scanned: 26,
          previewTruncated: false,
          scanTruncated: false
        }
      }).success
    ).toBe(false)
    expect(
      memoryGetArchiveCandidateLifecyclePreviewRoute.output.safeParse({
        preview: {
          lifecycles: [makeLifecycle({ decayTier: 'archive_candidate' })],
          previewLimit: 25,
          scanLimit: 200,
          scanned: 1,
          previewTruncated: false,
          scanTruncated: false
        }
      }).success
    ).toBe(false)
    expect(
      memoryGetArchiveCandidateLifecyclePreviewRoute.output.safeParse({
        preview: {
          lifecycles: [makeArchiveCandidateLifecycle()],
          previewLimit: 25,
          scanLimit: 200,
          scanned: 1,
          previewTruncated: true,
          scanTruncated: false
        }
      }).success
    ).toBe(false)
  })
})

describe('memory.search route contract', () => {
  it('round-trips input with an optional limit and rejects a bad agentId', () => {
    expect(memorySearchRoute.input.parse({ agentId: 'deepchat', query: 'redis' })).toEqual({
      agentId: 'deepchat',
      query: 'redis'
    })
    expect(
      memorySearchRoute.input.parse({ agentId: 'deepchat', query: 'redis', limit: 5 }).limit
    ).toBe(5)
    expect(
      memorySearchRoute.input.parse({
        agentId: 'deepchat',
        query: 'redis',
        scopeContext: { userId: ' user-1 ', projectId: 'project-1', sessionId: 'session-1' }
      }).scopeContext
    ).toEqual({ userId: 'user-1', projectId: 'project-1', sessionId: 'session-1' })
    expect(
      memorySearchRoute.input.parse({ agentId: 'deepchat', query: 'redis', limit: 100 }).limit
    ).toBe(100)
    expect(
      memorySearchRoute.input.safeParse({ agentId: 'deepchat', query: 'redis', limit: 101 }).success
    ).toBe(false)
    expect(memorySearchRoute.input.safeParse({ agentId: 'has space', query: 'x' }).success).toBe(
      false
    )
    expect(
      memorySearchRoute.input.safeParse({
        agentId: 'deepchat',
        query: 'x',
        scopeContext: { sessionId: ' ' }
      }).success
    ).toBe(false)
  })

  it('carries the retrieval score and source flags on a projected memory row', () => {
    const result = {
      ...toMemoryItemDto(makeRow({ id: 'm1' })),
      score: 0.83,
      sources: { fts: true },
      similarity: 0.42
    }
    const parsed = memorySearchRoute.output.parse({ results: [result] })
    expect(parsed.results[0].id).toBe('m1')
    expect(parsed.results[0].score).toBe(0.83)
    expect(parsed.results[0].sources).toEqual({ fts: true })
    expect(parsed.results[0].similarity).toBe(0.42)
    expect(
      memorySearchRoute.output.safeParse({
        results: [{ ...result, scopeType: 'session', scopeId: null }]
      }).success
    ).toBe(false)
    expect(
      memorySearchRoute.output.safeParse({
        results: [{ ...result, scopeType: 'session', scopeId: ' session-1 ' }]
      }).success
    ).toBe(false)
  })
})

describe('memory.add route contract', () => {
  it('round-trips input with optional kind/importance and rejects bad agentId or empty content', () => {
    expect(memoryAddRoute.input.parse({ agentId: 'deepchat', content: 'redis on 6379' })).toEqual({
      agentId: 'deepchat',
      content: 'redis on 6379'
    })
    const full = memoryAddRoute.input.parse({
      agentId: 'deepchat',
      content: 'redis on 6379',
      kind: 'episodic',
      category: 'project_fact',
      importance: 0.8,
      sessionId: 'session-1',
      scope: { type: 'project', id: ' project-1 ' }
    })
    expect(full.kind).toBe('episodic')
    expect(full.category).toBe('project_fact')
    expect(full.importance).toBe(0.8)
    expect(full.sessionId).toBe('session-1')
    expect(full.scope).toEqual({ type: 'project', id: 'project-1' })
    expect(memoryAddRoute.input.safeParse({ agentId: 'has space', content: 'x' }).success).toBe(
      false
    )
    expect(memoryAddRoute.input.safeParse({ agentId: 'deepchat', content: '' }).success).toBe(false)
    expect(
      memoryAddRoute.input.safeParse({
        agentId: 'deepchat',
        content: 'x',
        scope: { type: 'agent', id: 'unexpected' }
      }).success
    ).toBe(false)
    expect(
      memoryAddRoute.input.safeParse({
        agentId: 'deepchat',
        content: 'x',
        scope: { type: 'session', id: ' ' }
      }).success
    ).toBe(false)
    expect(
      memoryAddRoute.input.safeParse({ agentId: 'deepchat', content: 'x', importance: 2 }).success
    ).toBe(false)
    expect(
      memoryAddRoute.input.safeParse({
        agentId: 'deepchat',
        content: 'x'.repeat(AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS)
      }).success
    ).toBe(true)
    expect(
      memoryAddRoute.input.safeParse({
        agentId: 'deepchat',
        content: 'x'.repeat(AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS + 1)
      }).success
    ).toBe(false)
    expect(
      memoryAddRoute.input.safeParse({
        agentId: 'deepchat',
        content: '😀'.repeat(AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS)
      }).success
    ).toBe(true)
    expect(
      memoryAddRoute.input.safeParse({
        agentId: 'deepchat',
        content: '😀'.repeat(AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS + 1)
      }).success
    ).toBe(false)
    expect(
      memoryAddRoute.input.safeParse({
        agentId: 'deepchat',
        content: 'x',
        category: 'unknown'
      }).success
    ).toBe(false)
  })

  it('accepts each flattened write outcome shape on output', () => {
    expect(
      memoryAddRoute.output.parse({
        result: { action: 'created', memoryId: 'm1', reauthorized: true }
      }).result
    ).toMatchObject({ action: 'created', reauthorized: true })
    expect(
      memoryAddRoute.output.parse({
        result: { action: 'superseded', memoryId: 'm2', supersededId: 'm1' }
      }).result.supersededId
    ).toBe('m1')
    expect(
      memoryAddRoute.output.parse({
        result: { action: 'challenged', memoryId: 'm3', conflictWith: 'm1' }
      }).result.conflictWith
    ).toBe('m1')
    expect(
      memoryAddRoute.output.parse({ result: { action: 'noop', reason: 'duplicate' } }).result.reason
    ).toBe('duplicate')
  })
})

describe('memory.update route contract', () => {
  it('round-trips editable patches and rejects empty patches', () => {
    expect(
      memoryUpdateRoute.input.parse({
        agentId: 'deepchat',
        memoryId: 'm1',
        patch: { content: 'redis on 6379', category: null, importance: 0.2 }
      })
    ).toEqual({
      agentId: 'deepchat',
      memoryId: 'm1',
      patch: { content: 'redis on 6379', category: null, importance: 0.2 }
    })
    expect(
      memoryUpdateRoute.input.safeParse({ agentId: 'deepchat', memoryId: 'm1', patch: {} }).success
    ).toBe(false)
    expect(
      memoryUpdateRoute.input.safeParse({
        agentId: 'deepchat',
        memoryId: 'm1',
        patch: { content: 'x'.repeat(AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS + 1) }
      }).success
    ).toBe(false)
    expect(
      memoryUpdateRoute.output.parse({
        result: { action: 'noop', reason: 'content-too-large' }
      }).result.reason
    ).toBe('content-too-large')
    expect(
      memoryUpdateRoute.input.safeParse({
        agentId: 'bad/id',
        memoryId: 'm1',
        patch: { importance: 0.2 }
      }).success
    ).toBe(false)
    expect(
      memoryUpdateRoute.input.safeParse({
        agentId: 'deepchat',
        memoryId: 'm1',
        patch: { category: 'unknown' }
      }).success
    ).toBe(false)
    expect(
      memoryUpdateRoute.input.parse({
        agentId: 'deepchat',
        memoryId: 'm1',
        patch: { content: '' }
      }).patch.content
    ).toBe('')
  })

  it('accepts each manual edit outcome shape on output', () => {
    expect(
      memoryUpdateRoute.output.parse({ result: { action: 'updated', memoryId: 'm1' } }).result
        .action
    ).toBe('updated')
    expect(
      memoryUpdateRoute.output.parse({
        result: { action: 'superseded', memoryId: 'm2', supersededId: 'm1' }
      }).result.supersededId
    ).toBe('m1')
    expect(
      memoryUpdateRoute.output.parse({
        result: { action: 'folded', memoryId: 'm2', supersededId: 'm1' }
      }).result.memoryId
    ).toBe('m2')
    expect(memoryUpdateRoute.output.parse({ result: { action: 'noop' } }).result.action).toBe(
      'noop'
    )
    expect(
      memoryUpdateRoute.output.parse({ result: { action: 'noop', reason: 'conflict' } }).result
        .reason
    ).toBe('conflict')
    expect(
      memoryUpdateRoute.output.safeParse({ result: { action: 'noop', reason: 'not-a-reason' } })
        .success
    ).toBe(false)
  })
})

describe('memory.getStatus route contract', () => {
  it('requires the extended visible-count fields', () => {
    const status = {
      total: 3,
      pendingEmbedding: 1,
      hasPersona: true,
      activeMemoryCount: 3,
      archivedMemoryCount: 2,
      conflictCount: 1,
      personaDraftCount: 1,
      personaVersionCount: 4,
      directiveDraftCount: 2,
      activeDirectiveCount: 3,
      reindexing: false
    }

    expect(memoryGetStatusRoute.output.parse({ status }).status).toEqual(status)
    expect(
      memoryGetStatusRoute.output.parse({
        status: {
          total: 3,
          pendingEmbedding: 1,
          hasPersona: true,
          activeMemoryCount: 3,
          archivedMemoryCount: 2,
          conflictCount: 1,
          personaDraftCount: 1,
          personaVersionCount: 4,
          reindexing: false
        }
      }).status
    ).toMatchObject({ directiveDraftCount: 0, activeDirectiveCount: 0 })
    expect(
      memoryGetStatusRoute.output.safeParse({
        status: { total: 3, pendingEmbedding: 1, hasPersona: true }
      }).success
    ).toBe(false)
  })
})

describe('memory.getByIds route contract', () => {
  it('round-trips input and rejects oversized batches', () => {
    expect(
      memoryGetByIdsRoute.input.parse({ agentId: 'deepchat', memoryIds: ['m2', 'm1'] })
    ).toEqual({
      agentId: 'deepchat',
      memoryIds: ['m2', 'm1']
    })
    expect(
      memoryGetByIdsRoute.input.safeParse({ agentId: 'deepchat', memoryIds: [] }).success
    ).toBe(false)
    expect(
      memoryGetByIdsRoute.input.safeParse({
        agentId: 'deepchat',
        memoryIds: Array.from({ length: 51 }, (_, index) => `m${index}`)
      }).success
    ).toBe(false)
    expect(
      memoryGetByIdsRoute.output.parse({
        memories: [toMemoryItemDto(makeRow({ id: 'm1', lifecycle_state: 'archived' }))]
      }).memories[0].status
    ).toBe('archived')
  })
})

describe('memory.archive route contract', () => {
  it('round-trips archive input and output', () => {
    expect(memoryArchiveRoute.input.parse({ agentId: 'deepchat', memoryId: 'm1' })).toEqual({
      agentId: 'deepchat',
      memoryId: 'm1'
    })
    expect(memoryArchiveRoute.output.parse({ action: 'applied' })).toEqual({ action: 'applied' })
    expect(memoryArchiveRoute.output.parse({ action: 'rejected', reason: 'not-found' })).toEqual({
      action: 'rejected',
      reason: 'not-found'
    })
    expect(memoryArchiveRoute.input.safeParse({ agentId: 'bad/id', memoryId: 'm1' }).success).toBe(
      false
    )
  })
})

describe('memory directive route contracts', () => {
  it('maps persistence rows without exposing stable identity hashes', () => {
    const directive = toMemoryDirectiveDto({
      agent_id: 'deepchat',
      id: 'directive-1',
      kind: 'suppress_topic',
      status: 'draft',
      source: 'derived_suggestion',
      content: 'Do not mention Project Saffron.',
      normalized_topic: 'project saffron',
      identity_hash: 'a'.repeat(64),
      created_at: 1_000,
      updated_at: 2_000
    })

    expect(memoryListDirectivesRoute.output.parse({ directives: [directive] })).toEqual({
      directives: [
        {
          id: 'directive-1',
          agentId: 'deepchat',
          kind: 'suppress_topic',
          status: 'draft',
          source: 'derived_suggestion',
          content: 'Do not mention Project Saffron.',
          topic: 'project saffron',
          createdAt: 1_000,
          updatedAt: 2_000
        }
      ]
    })
    expect(directive).not.toHaveProperty('identityHash')
  })

  it('enforces directive topics according to directive kind in response DTOs', () => {
    const common = {
      id: 'directive-1',
      agentId: 'deepchat',
      status: 'active' as const,
      source: 'manual' as const,
      content: 'Be concise.',
      createdAt: 1_000,
      updatedAt: 2_000
    }
    expect(
      memoryListDirectivesRoute.output.safeParse({
        directives: [{ ...common, kind: 'instruction', topic: null }]
      }).success
    ).toBe(true)
    expect(
      memoryListDirectivesRoute.output.safeParse({
        directives: [{ ...common, kind: 'suppress_topic', topic: 'project saffron' }]
      }).success
    ).toBe(true)
    expect(
      memoryListDirectivesRoute.output.safeParse({
        directives: [{ ...common, kind: 'instruction', topic: 'unexpected' }]
      }).success
    ).toBe(false)
    expect(
      memoryListDirectivesRoute.output.safeParse({
        directives: [{ ...common, kind: 'suppress_topic', topic: null }]
      }).success
    ).toBe(false)
  })

  it('enforces closed directive inputs and bounded identifiers', () => {
    expect(
      memoryCreateDirectiveRoute.input.parse({
        agentId: 'deepchat',
        directive: {
          kind: 'suppress_topic',
          content: 'Do not mention Project Saffron.',
          topic: 'Project Saffron'
        }
      })
    ).toEqual({
      agentId: 'deepchat',
      directive: {
        kind: 'suppress_topic',
        content: 'Do not mention Project Saffron.',
        topic: 'Project Saffron'
      }
    })
    expect(
      memoryCreateDirectiveRoute.input.safeParse({
        agentId: 'deepchat',
        directive: {
          kind: 'instruction',
          content: '😀'.repeat(AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS)
        }
      }).success
    ).toBe(true)
    expect(
      memoryCreateDirectiveRoute.input.safeParse({
        agentId: 'deepchat',
        directive: { kind: 'instruction', content: 'Be concise.', topic: 'unexpected' }
      }).success
    ).toBe(false)
    expect(
      memoryCreateDirectiveRoute.input.safeParse({
        agentId: 'deepchat',
        directive: { kind: 'suppress_topic', content: 'Hide it.' }
      }).success
    ).toBe(false)
    expect(
      memoryCreateDirectiveRoute.input.safeParse({
        agentId: 'deepchat',
        directive: {
          kind: 'instruction',
          content: '😀'.repeat(AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS + 1)
        }
      }).success
    ).toBe(false)
    expect(
      memoryListDirectivesRoute.input.parse({
        agentId: 'deepchat',
        statuses: ['draft', 'active']
      })
    ).toEqual({ agentId: 'deepchat', statuses: ['draft', 'active'], limit: 200 })
    for (const route of [
      memoryApproveDirectiveRoute,
      memoryRejectDirectiveRoute,
      memoryDeleteDirectiveRoute
    ]) {
      expect(
        route.input.safeParse({ agentId: 'deepchat', directiveId: 'x'.repeat(129) }).success
      ).toBe(false)
    }
  })

  it('distinguishes directive capacity from missing or unavailable mutations', () => {
    expect(
      memoryCreateDirectiveRoute.output.parse({
        action: 'rejected',
        directive: null,
        reason: 'capacity'
      })
    ).toEqual({ action: 'rejected', directive: null, reason: 'capacity' })
    expect(
      memoryApproveDirectiveRoute.output.parse({
        action: 'rejected',
        directive: null,
        reason: 'not-found'
      })
    ).toEqual({ action: 'rejected', directive: null, reason: 'not-found' })
    expect(
      memoryRejectDirectiveRoute.output.parse({
        action: 'rejected',
        directive: null,
        reason: 'unavailable'
      })
    ).toEqual({ action: 'rejected', directive: null, reason: 'unavailable' })
    expect(
      memoryCreateDirectiveRoute.output.safeParse({
        action: 'applied',
        directive: null
      }).success
    ).toBe(false)
  })
})

describe('memory.updated event contract', () => {
  it('keeps createdIds optional and capped at the memory detail batch limit', () => {
    expect(
      memoryUpdatedEvent.payload.parse({
        agentId: 'deepchat',
        reason: 'extract',
        version: 1000
      })
    ).toEqual({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1000
    })

    expect(
      memoryUpdatedEvent.payload.safeParse({
        agentId: 'deepchat',
        reason: 'extract',
        version: 1000,
        memoryId: 'm1',
        sessionId: 'session-1',
        createdIds: Array.from({ length: 50 }, (_, index) => `m${index}`)
      }).success
    ).toBe(true)

    expect(
      memoryUpdatedEvent.payload.safeParse({
        agentId: 'deepchat',
        reason: 'extract',
        version: 1000,
        createdIds: Array.from({ length: 51 }, (_, index) => `m${index}`)
      }).success
    ).toBe(false)
  })

  it('accepts manual-edit as a distinct reason from extract', () => {
    expect(
      memoryUpdatedEvent.payload.parse({
        agentId: 'deepchat',
        reason: 'manual-edit',
        version: 1000,
        memoryId: 'm1'
      })
    ).toEqual({
      agentId: 'deepchat',
      reason: 'manual-edit',
      version: 1000,
      memoryId: 'm1'
    })
  })

  it('carries content-free directive identity for targeted refreshes', () => {
    expect(
      memoryUpdatedEvent.payload.parse({
        agentId: 'deepchat',
        reason: 'directive-approve',
        version: 1000,
        directiveId: 'directive-1'
      })
    ).toEqual({
      agentId: 'deepchat',
      reason: 'directive-approve',
      version: 1000,
      directiveId: 'directive-1'
    })
  })
})

describe('formatMemorySourceRecordContent', () => {
  const record = (role: ChatMessageRecord['role'], content: string): ChatMessageRecord => ({
    id: 'msg-1',
    sessionId: 's',
    role,
    content,
    createdAt: 1000,
    updatedAt: 1000,
    status: 'sent',
    orderSeq: 1,
    isContextEdge: 0,
    metadata: null
  })

  it('returns readable text for user and assistant JSON records', () => {
    expect(formatMemorySourceRecordContent(record('user', JSON.stringify({ text: 'hello' })))).toBe(
      'hello'
    )
    expect(
      formatMemorySourceRecordContent(
        record(
          'assistant',
          JSON.stringify([
            { type: 'content', content: 'answer body' },
            { type: 'reasoning', text: 'reasoning note' },
            { type: 'reasoning_content', content: 'reasoning block' },
            { reasoning_content: 'legacy reasoning field' },
            { type: 'tool_call', content: '{"raw":true}' }
          ])
        )
      )
    ).toBe('answer body')
  })

  it('returns empty text for malformed or unsupported records', () => {
    expect(formatMemorySourceRecordContent(record('user', '{bad json'))).toBe('')
    expect(
      formatMemorySourceRecordContent(record('assistant', JSON.stringify({ tool: true })))
    ).toBe('')
  })
})
