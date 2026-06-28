import { describe, expect, it, vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import { fuse } from '@/presenter/memoryPresenter/scoring'
import { DEFAULT_RETRIEVAL, DEFAULT_SIMILARITY_THRESHOLD } from '@/presenter/memoryPresenter/types'
import type { AgentMemoryRow } from '@/presenter/memoryPresenter/types'
import { FakeRepository, FakeVectorStore } from './fakes/memoryFakes'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/agentMemory').catch(() => null)
  : null
const Database = sqliteModule?.default
const AgentMemoryTable = tableModule?.AgentMemoryTable
const DatabaseCtor = Database!
const AgentMemoryTableCtor = AgentMemoryTable!
const sqliteSkipReason = 'skipped: better-sqlite3-multiple-ciphers is unavailable'
const requireNativeSqlite = process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1'

let sqliteAvailable = false
if (Database) {
  try {
    const smokeDb = new Database(':memory:')
    smokeDb.close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
}

const sqliteHarnessAvailable = sqliteAvailable && AgentMemoryTable
const sqliteHarnessSkipReason = sqliteAvailable
  ? 'skipped: AgentMemoryTable is unavailable'
  : sqliteSkipReason
const describeIfSqlite = sqliteHarnessAvailable
  ? describe
  : requireNativeSqlite
    ? (name: string, _suite: () => void) =>
        describe(name, () => {
          it('requires native SQLite support', () => {
            throw new Error(sqliteHarnessSkipReason)
          })
        })
    : describe.skip

const VOCAB = [
  'chinese',
  'concise',
  'redis',
  'cache',
  'session',
  'vue',
  'pinia',
  'frontend',
  'timezone',
  'pacific',
  'docker',
  'kubernetes',
  'deploy'
] as const

// Light stemming so "caching"->"cache", "sessions"->"session" map onto the vocab.
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/caching/g, 'cache')
    .replace(/sessions/g, 'session')
    .split(/[^a-z]+/)
    .filter(Boolean)
}

function embed(text: string): number[] {
  const present = new Set(tokens(text))
  return VOCAB.map((term) => (present.has(term) ? 1 : 0))
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

function makeRow(id: string, content: string): AgentMemoryRow {
  return {
    id,
    agent_id: 'a',
    user_scope: null,
    kind: 'semantic',
    category: null,
    content,
    importance: 0.5,
    status: 'embedded',
    embedding_id: id,
    embedding_dim: VOCAB.length,
    embedding_model: 'stub:stub',
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
    last_consolidated_at: null,
    conflict_state: null,
    conflict_with: null,
    persona_state: null
  }
}

const FIXTURE: AgentMemoryRow[] = [
  makeRow('m-chinese', 'user prefers concise answers in chinese'),
  makeRow('m-redis', 'user likes redis caching for sessions'),
  makeRow('m-vue', 'user builds vue frontend apps with pinia'),
  makeRow('m-timezone', 'user works in the pacific timezone'),
  makeRow('m-deploy', 'team deploys with docker and kubernetes')
]

interface EvalCase {
  query: string
  expected: string
}

const CASES: EvalCase[] = [
  { query: 'redis caching', expected: 'm-redis' },
  // Semantic, non-substring: "session store" never appears verbatim, vector must carry it.
  { query: 'session store', expected: 'm-redis' },
  { query: 'vue pinia frontend', expected: 'm-vue' },
  { query: 'kubernetes deploy', expected: 'm-deploy' },
  { query: 'pacific timezone', expected: 'm-timezone' }
]

function ftsCandidates(query: string): AgentMemoryRow[] {
  const q = query.toLowerCase()
  return FIXTURE.filter((row) => row.content.toLowerCase().includes(q))
}

function vecCandidates(query: string): { row: AgentMemoryRow; similarity: number }[] {
  const queryVec = embed(query)
  return FIXTURE.map((row) => ({ row, similarity: cosine(embed(row.content), queryVec) }))
    .filter((candidate) => candidate.similarity >= DEFAULT_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
}

const FUSE_OPTS = {
  topK: 5,
  rrfK: DEFAULT_RETRIEVAL.rrfK,
  weights: DEFAULT_RETRIEVAL.weights,
  now: 1000
}

function rankedIds(query: string, mode: 'hybrid' | 'fts'): string[] {
  const vec = mode === 'hybrid' ? vecCandidates(query) : []
  return fuse(ftsCandidates(query), vec, FUSE_OPTS).map((item) => item.id)
}

function reciprocalRank(ids: string[], expected: string): number {
  const index = ids.indexOf(expected)
  return index === -1 ? 0 : 1 / (index + 1)
}

function ndcgAtK(ids: string[], expected: string, k: number): number {
  const index = ids.slice(0, k).indexOf(expected)
  if (index === -1) return 0
  // Single relevant doc → IDCG = 1; DCG = 1/log2(rank+2).
  return 1 / Math.log2(index + 2)
}

describe('memory retrieval eval harness (hybrid RRF)', () => {
  it('hits the expected memory at K=3 for every case (hit@3 = 1.0)', () => {
    for (const testCase of CASES) {
      const ids = rankedIds(testCase.query, 'hybrid')
      expect(ids.slice(0, 3)).toContain(testCase.expected)
    }
  })

  it('ranks the expected memory first for semantic, non-substring queries (strong vector wins)', () => {
    const ids = rankedIds('session store', 'hybrid')
    expect(ids[0]).toBe('m-redis')
    // The keyword path alone cannot find it (no "session store" substring).
    expect(ftsCandidates('session store')).toHaveLength(0)
  })

  it('hybrid MRR is at least as good as keyword-only retrieval', () => {
    const mrr = (mode: 'hybrid' | 'fts') =>
      CASES.reduce((sum, c) => sum + reciprocalRank(rankedIds(c.query, mode), c.expected), 0) /
      CASES.length
    const hybrid = mrr('hybrid')
    const ftsOnly = mrr('fts')
    expect(hybrid).toBeGreaterThanOrEqual(ftsOnly)
    expect(hybrid).toBeGreaterThanOrEqual(0.9)
  })

  it('reports strong nDCG@3 across the fixture', () => {
    const ndcg =
      CASES.reduce((sum, c) => sum + ndcgAtK(rankedIds(c.query, 'hybrid'), c.expected, 3), 0) /
      CASES.length
    expect(ndcg).toBeGreaterThanOrEqual(0.9)
  })

  it('recalls the expected memory through MemoryPresenter with deterministic embeddings', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({
        memoryEnabled: true,
        memoryEmbedding: { providerId: 'stub', modelId: 'stub' }
      }),
      getEmbeddings: vi.fn(async (_providerId: string, _modelId: string, texts: string[]) =>
        texts.map(embed)
      ),
      getDimensions: vi.fn(async () => ({
        data: { dimensions: embed('').length, normalized: false }
      })),
      generateText: vi.fn(async () => ''),
      createVectorStore: async () => store,
      resetVectorStore: async () => {
        store.vectors.clear()
      }
    })

    for (const row of FIXTURE) {
      repo.insert({
        id: row.id,
        agentId: row.agent_id,
        kind: row.kind,
        content: row.content,
        importance: row.importance,
        status: 'pending_embedding'
      })
    }
    await presenter.processPendingEmbeddings('a')

    const results = await presenter.recall('a', 'session store', 1000)
    expect(results[0]?.id).toBe('m-redis')
  })
})

describeIfSqlite(
  `memory retrieval eval harness (SQLite keyword index)${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
  () => {
    it('recalls CJK, path, command, and error-text fixtures through real SQLite search', () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new AgentMemoryTableCtor(db)
        table.createTable()
        const fixtures = [
          {
            id: 'm-cn',
            content: '用户偏好简洁中文回答，少铺垫。'
          },
          {
            id: 'm-redis',
            content: 'Debugged Redis TTL drift in the session cache.'
          },
          {
            id: 'm-path',
            content: 'Deployment command lives at /usr/local/bin/deploy --flag.'
          },
          {
            id: 'm-error',
            content: 'Port failure showed EADDRINUSE on localhost:5173.'
          }
        ]
        for (const fixture of fixtures) {
          table.insert({
            id: fixture.id,
            agentId: 'deepchat',
            kind: 'semantic',
            content: fixture.content,
            status: 'embedded'
          })
        }
        table.insert({
          id: 'm-other',
          agentId: 'other-agent',
          kind: 'semantic',
          content: 'Redis TTL belongs to a different agent.',
          status: 'embedded'
        })

        const cases = [
          { query: '简洁', expected: 'm-cn' },
          { query: 'Redis TTL', expected: 'm-redis' },
          { query: '/usr/local/bin/deploy', expected: 'm-path' },
          { query: 'EADDRINUSE', expected: 'm-error' }
        ]

        for (const testCase of cases) {
          const ids = table.search('deepchat', testCase.query, 5).map((row) => row.id)
          expect(ids[0]).toBe(testCase.expected)
        }
        expect(table.search('deepchat', 'different agent', 5)).toHaveLength(0)
      } finally {
        db.close()
      }
    })

    it('keeps hybrid RRF at least as strong as real SQLite keyword retrieval', () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new AgentMemoryTableCtor(db)
        table.createTable()
        for (const row of FIXTURE) {
          table.insert({
            id: row.id,
            agentId: row.agent_id,
            kind: row.kind,
            content: row.content,
            importance: row.importance,
            status: 'embedded'
          })
        }

        const rankedFromSqlite = (query: string, mode: 'hybrid' | 'fts') => {
          const keyword = table.search('a', query, FUSE_OPTS.topK)
          const vec = mode === 'hybrid' ? vecCandidates(query) : []
          return fuse(keyword, vec, FUSE_OPTS).map((item) => item.id)
        }
        const mrr = (mode: 'hybrid' | 'fts') =>
          CASES.reduce(
            (sum, testCase) =>
              sum + reciprocalRank(rankedFromSqlite(testCase.query, mode), testCase.expected),
            0
          ) / CASES.length

        expect(mrr('hybrid')).toBeGreaterThanOrEqual(mrr('fts'))
        expect(rankedFromSqlite('session store', 'hybrid')[0]).toBe('m-redis')
      } finally {
        db.close()
      }
    })
  }
)
