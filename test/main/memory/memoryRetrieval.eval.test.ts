import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildRecallKeywordQuery,
  extractRecallKeywordCandidates,
  selectRecallKeywordTerms
} from '@/memory/core/recallKeyword'
import { fuse } from '@/memory/core/scoring'
import { DEFAULT_RETRIEVAL } from '@/memory/types'
import type { AgentMemoryRow } from '@/memory/types'
import fixtureValue from '../../fixtures/memory/retrieval-v1.json'
import {
  calculateRetrievalMetrics,
  cosineSimilarity,
  deterministicLexiconEmbed,
  type MemoryRetrievalFixtureV1,
  validateRetrievalFixture
} from '../../helpers/memoryRetrievalEval'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const tableModule = Database
  ? await import('@/memory/data/tables/agentMemory').catch(() => null)
  : null
const AgentMemoryTable = tableModule?.AgentMemoryTable
const DatabaseCtor = Database!
const AgentMemoryTableCtor = AgentMemoryTable!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(AgentMemoryTable),
  'AgentMemoryTable is unavailable'
)

validateRetrievalFixture(fixtureValue)
const fixture = fixtureValue as MemoryRetrievalFixtureV1

function rankVectors(
  queryText: string,
  rows: AgentMemoryRow[],
  options: { includeConcepts?: boolean } = {}
) {
  const queryVector = deterministicLexiconEmbed(queryText, options)
  return rows
    .map((row) => ({
      row,
      similarity: cosineSimilarity(queryVector, deterministicLexiconEmbed(row.content, options))
    }))
    .sort(
      (left, right) => right.similarity - left.similarity || left.row.id.localeCompare(right.row.id)
    )
    .slice(0, 20)
    .filter(({ similarity }) => similarity >= DEFAULT_RETRIEVAL.similarityThreshold)
}

describe('memory retrieval eval primitives', () => {
  it('validates the versioned fixture and deterministic normalized vectors', () => {
    expect(fixture.corpus).toHaveLength(240)
    expect(fixture.queries).toHaveLength(60)
    const first = deterministicLexiconEmbed(fixture.queries[0].text)
    expect(first).toEqual(deterministicLexiconEmbed(fixture.queries[0].text))
    expect(Math.hypot(...first)).toBeCloseTo(1, 10)
    expect(JSON.stringify(fixture)).not.toContain('embedding')
  })

  it('calculates multi-relevant metrics and ignores duplicate ranked IDs', () => {
    const queries: MemoryRetrievalFixtureV1['queries'] = [
      {
        id: 'metric',
        agentId: 'a',
        text: 'metric',
        subsets: ['exact'],
        relevantIds: ['a', 'b']
      }
    ]
    const summary = calculateRetrievalMetrics(queries, new Map([['metric', ['x', 'a', 'a', 'b']]]))
    expect(summary.recallAt5).toBe(1)
    expect(summary.mrrAt10).toBe(0.5)
    expect(summary.ndcgAt10).toBeGreaterThan(0.6)
  })

  it('keeps every relevant row in the deterministic vector top five without cross-Agent leakage', () => {
    for (const query of fixture.queries) {
      const queryVector = deterministicLexiconEmbed(query.text)
      const ranked = fixture.corpus
        .filter((row) => row.agentId === query.agentId)
        .map((row) => ({
          id: row.id,
          score: cosineSimilarity(queryVector, deterministicLexiconEmbed(row.content))
        }))
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, 5)
        .map((row) => row.id)
      expect(ranked).toEqual(expect.arrayContaining(query.relevantIds))
    }
  })

  it('requires concept features for the semantic subset', () => {
    const rankedWithoutConcepts = new Map<string, string[]>()
    for (const query of fixture.queries.filter(({ subsets }) => subsets.includes('semantic'))) {
      const rows = fixture.corpus
        .filter((row) => row.agentId === query.agentId)
        .map(
          (row) =>
            ({
              id: row.id,
              agent_id: row.agentId,
              kind: row.kind,
              content: row.content,
              importance: row.importance
            }) as AgentMemoryRow
        )
      rankedWithoutConcepts.set(
        query.id,
        rankVectors(query.text, rows, { includeConcepts: false }).map(({ row }) => row.id)
      )
    }
    const semanticQueries = fixture.queries.filter(({ subsets }) => subsets.includes('semantic'))
    expect(
      calculateRetrievalMetrics(semanticQueries, rankedWithoutConcepts).recallAt5
    ).toBeLessThan(0.5)
  })

  it('reports zero metrics for empty results', () => {
    const summary = calculateRetrievalMetrics([fixture.queries[0]], new Map())
    expect(summary).toMatchObject({ recallAt5: 0, mrrAt10: 0, ndcgAt10: 0 })
  })

  it('rejects queries without relevant IDs', () => {
    const invalid = structuredClone(fixture)
    invalid.queries[0].relevantIds = []
    expect(() => validateRetrievalFixture(invalid)).toThrow('relevant IDs')
  })
})

describeIfSqlite('memory retrieval eval v1', () => {
  it('meets the hybrid quality gates through real SQLite FTS and production fusion', () => {
    const db = new DatabaseCtor(':memory:')
    const artifactPath = resolve('test-results/memory/retrieval-v1.json')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const rowById = new Map<string, AgentMemoryRow>()
      for (const item of fixture.corpus) {
        const row = table.insert({
          id: item.id,
          agentId: item.agentId,
          kind: item.kind,
          content: item.content,
          importance: item.importance,
          status: 'embedded'
        })
        rowById.set(row.id, row)
      }

      const ftsRanked = new Map<string, string[]>()
      const vectorRanked = new Map<string, string[]>()
      const hybridRanked = new Map<string, string[]>()
      for (const query of fixture.queries) {
        const keywordQuery = buildRecallKeywordQuery(
          selectRecallKeywordTerms(extractRecallKeywordCandidates(query.text))
        )
        const fts = keywordQuery
          ? table.searchWithStrategy(query.agentId, keywordQuery, 20, { matchMode: 'any' }).rows
          : []
        const agentRows = fixture.corpus
          .filter((item) => item.agentId === query.agentId)
          .map((item) => rowById.get(item.id)!)
        const vectors = rankVectors(query.text, agentRows)
        ftsRanked.set(
          query.id,
          fts.map((row) => row.id)
        )
        vectorRanked.set(
          query.id,
          vectors.map(({ row }) => row.id)
        )
        hybridRanked.set(
          query.id,
          fuse(fts, vectors, {
            topK: 10,
            rrfK: DEFAULT_RETRIEVAL.rrfK,
            weights: DEFAULT_RETRIEVAL.weights,
            now: Date.now()
          }).map((item) => item.id)
        )
      }

      const report = {
        version: 1,
        vectorProfile: fixture.vectorProfile,
        generatedAt: new Date().toISOString(),
        variants: {
          fts: calculateRetrievalMetrics(fixture.queries, ftsRanked),
          vector: calculateRetrievalMetrics(fixture.queries, vectorRanked),
          hybrid: calculateRetrievalMetrics(fixture.queries, hybridRanked)
        }
      }
      mkdirSync(dirname(artifactPath), { recursive: true })
      writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`)
      console.log(JSON.stringify(report))

      const { hybrid, fts } = report.variants
      for (const subset of ['exact', 'cjk', 'path', 'code'] as const) {
        expect(hybrid.bySubset[subset].recallAt5).toBe(1)
        expect(hybrid.bySubset[subset].recallAt5).toBeGreaterThanOrEqual(
          fts.bySubset[subset].recallAt5 - 0.02
        )
      }
      expect(hybrid.recallAt5).toBeGreaterThanOrEqual(0.95)
      expect(hybrid.mrrAt10).toBeGreaterThanOrEqual(0.85)
      expect(hybrid.ndcgAt10).toBeGreaterThanOrEqual(0.85)
    } finally {
      db.close()
    }
  })
})
