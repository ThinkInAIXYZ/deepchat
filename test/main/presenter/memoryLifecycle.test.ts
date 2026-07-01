import { describe, expect, it, vi } from 'vitest'

import { deriveLifecycle } from '@/presenter/memoryPresenter/lifecycle'
import {
  ARCHIVE_AGE_MS,
  ARCHIVE_DECAY_THRESHOLD
} from '@/presenter/memoryPresenter/lifecycleConstants'
import { decayScore, halfLifeForKind, retrievalScore } from '@/presenter/memoryPresenter/scoring'
import {
  FTS_SIMILARITY_BASELINE,
  IMPORTANCE_FLOOR_COEF,
  type AgentMemoryRow
} from '@/presenter/memoryPresenter/types'
import {
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT
} from '@shared/contracts/routes'
import { enabledConfig, FakeRepository, makePresenter } from './fakes/memoryFakes'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 220 * DAY_MS
const weights = { similarity: 0.6, recency: 0.25, importance: 0.15 }

function makeRow(overrides: Partial<AgentMemoryRow> = {}): AgentMemoryRow {
  return {
    id: 'm1',
    agent_id: 'a',
    user_scope: null,
    kind: 'semantic',
    category: null,
    content: 'redis memory',
    importance: 0.5,
    status: 'embedded',
    embedding_id: null,
    embedding_dim: null,
    embedding_model: null,
    source_session: null,
    provenance_key: null,
    is_anchor: 0,
    superseded_by: null,
    created_at: NOW - 10 * DAY_MS,
    last_accessed: null,
    access_count: 1,
    decay_score: null,
    source_entry_ids: null,
    confidence: null,
    last_consolidated_at: null,
    conflict_state: null,
    conflict_with: null,
    persona_state: null,
    ...overrides
  }
}

describe('deriveLifecycle', () => {
  it('matches the existing retrieval and decay scoring functions', () => {
    const row = makeRow({
      importance: 0.7,
      confidence: 0.9,
      created_at: NOW - 7 * DAY_MS
    })
    row.decay_score = decayScore(row, NOW)
    const lifecycle = deriveLifecycle(row, NOW, { weights })

    expect(lifecycle.recall).not.toBeNull()
    expect(lifecycle.recall?.final).toBeCloseTo(
      retrievalScore(row, FTS_SIMILARITY_BASELINE, NOW, weights, halfLifeForKind(row.kind))
    )
    expect(lifecycle.recall?.halfLifeMs).toBe(halfLifeForKind(row.kind))
    expect(lifecycle.forget.decayScore).toBeCloseTo(decayScore(row, NOW))
    expect(lifecycle.forget.materializedDecay).toBeCloseTo(row.decay_score)
    expect(lifecycle.forget.materializedStale).toBe(false)
  })

  it('marks missing or divergent materialized decay as stale diagnostics', () => {
    const missing = deriveLifecycle(makeRow({ decay_score: null }), NOW)
    const divergent = deriveLifecycle(
      makeRow({
        created_at: NOW - 220 * DAY_MS,
        decay_score: 0.9
      }),
      NOW
    )

    expect(missing.forget.materializedDecay).toBeNull()
    expect(missing.forget.materializedStale).toBe(true)
    expect(divergent.forget.decayScore).toBeLessThan(0.05)
    expect(divergent.forget.materializedDecay).toBe(0.9)
    expect(divergent.forget.materializedStale).toBe(true)
  })

  it('reports when the recall score is raised to the importance floor', () => {
    const row = makeRow({
      importance: 1,
      confidence: 0,
      created_at: NOW - 5_000 * DAY_MS
    })
    const lifecycle = deriveLifecycle(row, NOW, {
      weights: { similarity: 0, recency: 0, importance: 0 }
    })

    expect(lifecycle.recall?.flooredByImportance).toBe(true)
    expect(lifecycle.recall?.final).toBeCloseTo(IMPORTANCE_FLOOR_COEF)
  })

  it('derives fresh, aging, stale, and archive candidate tiers from current decay state', () => {
    expect(
      deriveLifecycle(makeRow({ created_at: NOW - 30 * DAY_MS, access_count: 1 }), NOW).decayTier
    ).toBe('fresh')
    expect(
      deriveLifecycle(makeRow({ created_at: NOW - 90 * DAY_MS, access_count: 1 }), NOW).decayTier
    ).toBe('aging')

    const stale = deriveLifecycle(makeRow({ created_at: NOW - 220 * DAY_MS, access_count: 1 }), NOW)
    expect(stale.decayTier).toBe('stale')
    expect(stale.archiveEligibility.eligible).toBe(false)

    const archiveCandidate = deriveLifecycle(
      makeRow({ created_at: NOW - 220 * DAY_MS, access_count: 0 }),
      NOW
    )
    expect(archiveCandidate.decayTier).toBe('archive_candidate')
    expect(archiveCandidate.archiveEligibility.eligible).toBe(true)
  })

  it('keeps persona memories out of recall and archive eligibility', () => {
    const lifecycle = deriveLifecycle(
      makeRow({
        kind: 'persona',
        created_at: NOW - 150 * DAY_MS,
        access_count: 0
      }),
      NOW
    )

    expect(lifecycle.recallable).toBe(false)
    expect(lifecycle.recall).toBeNull()
    expect(lifecycle.archiveEligibility.exempt).toBe(true)
    expect(lifecycle.archiveEligibility.exemptReasons).toEqual(['persona'])
    expect(lifecycle.archiveEligibility.eligible).toBe(false)
  })

  it('surfaces archive gaps for rows that are not yet eligible', () => {
    const lifecycle = deriveLifecycle(
      makeRow({
        created_at: NOW - 10 * DAY_MS,
        last_accessed: NOW - 2 * DAY_MS,
        access_count: 3
      }),
      NOW
    )

    expect(lifecycle.archiveEligibility.eligible).toBe(false)
    expect(lifecycle.archiveEligibility.gaps.daysUntilOldEnough).toBeGreaterThan(70)
    expect(lifecycle.archiveEligibility.gaps.decayAboveThresholdBy).toBeGreaterThan(0)
    expect(lifecycle.archiveEligibility.gaps.accessCount).toBe(3)
  })
})

describe('MemoryPresenter.getLifecycle', () => {
  it('loads a single memory by id without using the full lifecycle listing', () => {
    const repo = new FakeRepository()
    repo.insert({
      id: 'm1',
      agentId: 'a',
      kind: 'semantic',
      content: 'single',
      status: 'embedded',
      createdAt: NOW - 10 * DAY_MS
    })
    const { presenter } = makePresenter(enabledConfig, repo)
    const candidateSpy = vi.spyOn(repo, 'listArchiveCandidateLifecycleRows')

    const lifecycles = presenter.getLifecycle('a', 'm1')

    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0].memoryId).toBe('m1')
    expect(candidateSpy).not.toHaveBeenCalled()
  })

  it('predicts archive candidates from a narrow prefilter and current decay state', () => {
    const repo = new FakeRepository()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW)
    try {
      repo.insert({
        id: 'eligible-null',
        agentId: 'a',
        kind: 'semantic',
        content: 'eligible null',
        createdAt: NOW - 220 * DAY_MS
      })
      const eligibleStaleMaterialized = repo.insert({
        id: 'eligible-stale-materialized',
        agentId: 'a',
        kind: 'semantic',
        content: 'eligible stale materialized',
        createdAt: NOW - 220 * DAY_MS
      })
      eligibleStaleMaterialized.decay_score = 0.9
      const materializedOnly = repo.insert({
        id: 'materialized-only',
        agentId: 'a',
        kind: 'semantic',
        content: 'materialized only',
        importance: 1,
        createdAt: NOW - ARCHIVE_AGE_MS - DAY_MS
      })
      materializedOnly.decay_score = 0.01
      const accessed = repo.insert({
        id: 'accessed',
        agentId: 'a',
        kind: 'semantic',
        content: 'accessed',
        createdAt: NOW - 220 * DAY_MS
      })
      accessed.access_count = 1
      repo.insert({
        id: 'persona',
        agentId: 'a',
        kind: 'persona',
        content: 'persona',
        createdAt: NOW - 220 * DAY_MS
      })
      repo.insert({
        id: 'working',
        agentId: 'a',
        kind: 'working',
        content: 'working',
        createdAt: NOW - 220 * DAY_MS
      })
      const archived = repo.insert({
        id: 'archived',
        agentId: 'a',
        kind: 'semantic',
        content: 'archived',
        createdAt: NOW - 220 * DAY_MS
      })
      archived.status = 'archived'
      const superseded = repo.insert({
        id: 'superseded',
        agentId: 'a',
        kind: 'semantic',
        content: 'superseded',
        createdAt: NOW - 220 * DAY_MS
      })
      superseded.superseded_by = 'eligible-null'
      const anchored = repo.insert({
        id: 'anchored',
        agentId: 'a',
        kind: 'semantic',
        content: 'anchored',
        createdAt: NOW - 220 * DAY_MS
      })
      anchored.is_anchor = 1
      repo.insert({
        id: 'other-agent',
        agentId: 'b',
        kind: 'semantic',
        content: 'other',
        createdAt: NOW - 220 * DAY_MS
      })
      const { presenter } = makePresenter(enabledConfig, repo)
      const listSpy = vi.spyOn(repo, 'listArchiveCandidateLifecycleRows')

      const preview = presenter.getArchiveCandidateLifecyclePreview('a')
      const lifecycles = preview.lifecycles
      const ids = lifecycles.map((lifecycle) => lifecycle.memoryId)

      expect(listSpy).toHaveBeenCalledWith(
        'a',
        NOW - ARCHIVE_AGE_MS,
        MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT + 1
      )
      expect(preview.previewLimit).toBe(MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT)
      expect(preview.scanLimit).toBe(MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT)
      expect(preview.scanned).toBe(3)
      expect(preview.previewTruncated).toBe(false)
      expect(preview.scanTruncated).toBe(false)
      expect(ids).toEqual(['eligible-null', 'eligible-stale-materialized'])
      expect(lifecycles.every((lifecycle) => lifecycle.archiveEligibility.eligible)).toBe(true)
      expect(lifecycles[0].forget.decayScore).toBeLessThanOrEqual(lifecycles[1].forget.decayScore)
      expect(
        repo
          .listArchiveCandidateLifecycleRows('a', NOW - ARCHIVE_AGE_MS, 10)
          .every((row) => !Object.prototype.hasOwnProperty.call(row, 'content'))
      ).toBe(true)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('bounds archive candidate prediction scanning and preview rows', () => {
    const repo = new FakeRepository()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW)
    try {
      for (let index = 0; index < MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT + 5; index += 1) {
        repo.insert({
          id: `eligible-${String(index).padStart(3, '0')}`,
          agentId: 'a',
          kind: 'semantic',
          content: `eligible ${index}`,
          createdAt: NOW - 220 * DAY_MS
        })
      }
      const { presenter } = makePresenter(enabledConfig, repo)
      const listSpy = vi.spyOn(repo, 'listArchiveCandidateLifecycleRows')

      const preview = presenter.getArchiveCandidateLifecyclePreview('a')

      expect(listSpy).toHaveBeenCalledWith(
        'a',
        NOW - ARCHIVE_AGE_MS,
        MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT + 1
      )
      expect(preview.scanned).toBe(MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT)
      expect(preview.previewTruncated).toBe(true)
      expect(preview.scanTruncated).toBe(true)
      expect(preview.lifecycles).toHaveLength(MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT)
      expect(preview.lifecycles[0].memoryId).toBe('eligible-000')
      expect(
        preview.lifecycles[MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT - 1].memoryId
      ).toBe('eligible-024')
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('returns no archive candidate predictions for unmanaged agents', () => {
    const repo = new FakeRepository()
    repo.insert({
      id: 'eligible',
      agentId: 'a',
      kind: 'semantic',
      content: 'eligible',
      createdAt: NOW - 220 * DAY_MS
    })
    const { presenter } = makePresenter(enabledConfig, repo, { isManagedAgent: () => false })
    const listSpy = vi.spyOn(repo, 'listArchiveCandidateLifecycleRows')

    expect(presenter.getArchiveCandidateLifecyclePreview('a')).toEqual({
      lifecycles: [],
      previewLimit: MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
      scanLimit: MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT,
      scanned: 0,
      previewTruncated: false,
      scanTruncated: false
    })
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('rejects wrong-agent and working single-memory reads', () => {
    const repo = new FakeRepository()
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'single' })
    repo.insert({ id: 'w1', agentId: 'a', kind: 'working', content: 'working' })
    const { presenter } = makePresenter(enabledConfig, repo)

    expect(presenter.getLifecycle('b', 'm1')).toEqual([])
    expect(presenter.getLifecycle('a', 'w1')).toEqual([])
  })

  it('treats an explicitly provided empty memory id as a single-memory read', () => {
    const repo = new FakeRepository()
    repo.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'single' })
    const { presenter } = makePresenter(enabledConfig, repo)
    const getSpy = vi.spyOn(repo, 'getById')

    expect(presenter.getLifecycle('a', '')).toEqual([])
    expect(getSpy).toHaveBeenCalledWith('')
  })

  it('uses the same archive age and decay threshold constants as maintenance', () => {
    const row = makeRow({
      created_at: NOW - ARCHIVE_AGE_MS - DAY_MS,
      access_count: 0
    })
    const lifecycle = deriveLifecycle(row, NOW)

    expect(lifecycle.archiveEligibility.oldEnough).toBe(true)
    expect(lifecycle.archiveEligibility.decayedEnough).toBe(
      lifecycle.forget.decayScore <= ARCHIVE_DECAY_THRESHOLD
    )
  })

  it('treats exact archive age and decay thresholds as reached', () => {
    const row = makeRow({
      created_at: NOW - ARCHIVE_AGE_MS,
      last_accessed: NOW - ARCHIVE_AGE_MS,
      access_count: 0
    })
    const threshold = decayScore(row, NOW)
    const lifecycle = deriveLifecycle(row, NOW, { archiveDecayThreshold: threshold })

    expect(lifecycle.archiveEligibility.oldEnough).toBe(true)
    expect(lifecycle.archiveEligibility.decayedEnough).toBe(true)
    expect(lifecycle.archiveEligibility.gaps).toEqual({})
    expect(lifecycle.archiveEligibility.eligible).toBe(true)
    expect(lifecycle.decayTier).toBe('archive_candidate')

    const accessed = deriveLifecycle({ ...row, access_count: 1 }, NOW, {
      archiveDecayThreshold: threshold
    })
    expect(accessed.archiveEligibility.decayedEnough).toBe(true)
    expect(accessed.decayTier).toBe('stale')
  })

  it('keeps archive eligibility equivalent to the four real archive conditions', () => {
    for (const oldEnough of [false, true]) {
      for (const decayedEnough of [false, true]) {
        for (const neverAccessed of [false, true]) {
          for (const active of [false, true]) {
            const row = makeRow({
              id: `row-${Number(oldEnough)}-${Number(decayedEnough)}-${Number(
                neverAccessed
              )}-${Number(active)}`,
              created_at: oldEnough ? NOW - ARCHIVE_AGE_MS - DAY_MS : NOW - 10 * DAY_MS,
              last_accessed: decayedEnough ? NOW - 220 * DAY_MS : NOW - DAY_MS,
              access_count: neverAccessed ? 0 : 2,
              superseded_by: active ? null : 'current'
            })

            const lifecycle = deriveLifecycle(row, NOW)
            const expected = oldEnough && decayedEnough && neverAccessed && active

            expect(lifecycle.archiveEligibility.oldEnough).toBe(oldEnough)
            expect(lifecycle.archiveEligibility.decayedEnough).toBe(decayedEnough)
            expect(lifecycle.archiveEligibility.neverAccessed).toBe(neverAccessed)
            expect(lifecycle.archiveEligibility.active).toBe(active)
            expect(lifecycle.archiveEligibility.eligible).toBe(expected)
          }
        }
      }
    }
  })

  it('matches archiveStale decisions after the existing decay refresh step', () => {
    const repo = new FakeRepository()
    const rows = [
      repo.insert({
        id: 'eligible',
        agentId: 'a',
        kind: 'semantic',
        content: 'eligible',
        createdAt: NOW - 220 * DAY_MS
      }),
      repo.insert({
        id: 'too-new',
        agentId: 'a',
        kind: 'semantic',
        content: 'too new',
        createdAt: NOW - 10 * DAY_MS
      }),
      repo.insert({
        id: 'accessed',
        agentId: 'a',
        kind: 'semantic',
        content: 'accessed',
        createdAt: NOW - 220 * DAY_MS
      }),
      repo.insert({
        id: 'recent-decay',
        agentId: 'a',
        kind: 'semantic',
        content: 'recent decay',
        createdAt: NOW - 220 * DAY_MS
      }),
      repo.insert({
        id: 'inactive',
        agentId: 'a',
        kind: 'semantic',
        content: 'inactive',
        createdAt: NOW - 220 * DAY_MS
      }),
      repo.insert({
        id: 'anchor',
        agentId: 'a',
        kind: 'semantic',
        content: 'anchor',
        isAnchor: true,
        createdAt: NOW - 220 * DAY_MS
      }),
      repo.insert({
        id: 'persona',
        agentId: 'a',
        kind: 'persona',
        content: 'persona',
        createdAt: NOW - 220 * DAY_MS
      })
    ]
    repo.insert({
      id: 'working',
      agentId: 'a',
      kind: 'working',
      content: 'working',
      createdAt: NOW - 220 * DAY_MS
    })
    rows[2].access_count = 1
    rows[3].last_accessed = NOW - DAY_MS
    rows[4].superseded_by = 'eligible'
    for (const row of repo.rows.values()) {
      repo.updateDecayScore(row.id, decayScore(row, NOW), null)
    }
    const { presenter } = makePresenter(enabledConfig, repo)
    const expectedArchived = rows
      .filter((row) => deriveLifecycle(row, NOW).archiveEligibility.eligible)
      .map((row) => row.id)
      .sort()

    expect(expectedArchived).toEqual(['eligible'])
    expect(presenter.archiveStale('a', NOW)).toBe(expectedArchived.length)
    expect(
      [...repo.rows.values()]
        .filter((row) => row.status === 'archived')
        .map((row) => row.id)
        .sort()
    ).toEqual(expectedArchived)
  })
})
