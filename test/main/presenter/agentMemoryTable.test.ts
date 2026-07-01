import { describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/agentMemory').catch(() => null)
  : null
const auditTableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/agentMemoryAudit').catch(() => null)
  : null

const Database = sqliteModule?.default
const AgentMemoryTable = tableModule?.AgentMemoryTable
const AgentMemoryAuditTable = auditTableModule?.AgentMemoryAuditTable
const DatabaseCtor = Database!
const AgentMemoryTableCtor = AgentMemoryTable!
const AgentMemoryAuditTableCtor = AgentMemoryAuditTable!
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

const sqliteHarnessAvailable = sqliteAvailable && AgentMemoryTable && AgentMemoryAuditTable
const sqliteHarnessSkipReason = !sqliteAvailable
  ? sqliteSkipReason
  : AgentMemoryTable
    ? 'skipped: AgentMemoryAuditTable is unavailable'
    : 'skipped: AgentMemoryTable is unavailable'
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

describeIfSqlite('AgentMemoryTable', () => {
  it('inserts and reads back a memory row with defaults', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      const row = table.insert({
        id: 'm1',
        agentId: 'deepchat',
        kind: 'semantic',
        category: 'project_fact',
        content: '用户偏好简洁的中文回答',
        createdAt: 1000
      })

      expect(row.status).toBe('pending_embedding')
      expect(row.importance).toBe(0.5)
      expect(row.is_anchor).toBe(0)

      const fetched = table.getById('m1')
      expect(fetched?.content).toBe('用户偏好简洁的中文回答')
      expect(fetched?.agent_id).toBe('deepchat')
      expect(fetched?.category).toBe('project_fact')
    } finally {
      db.close()
    }
  })

  it('enforces provenance uniqueness per agent for dedupe', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({
        id: 'm1',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'fact A',
        provenanceKey: 'key-1'
      })

      expect(() =>
        table.insert({
          id: 'm2',
          agentId: 'deepchat',
          kind: 'semantic',
          content: 'fact A duplicate',
          provenanceKey: 'key-1'
        })
      ).toThrow()

      // Same key under a different agent is allowed.
      expect(() =>
        table.insert({
          id: 'm3',
          agentId: 'other-agent',
          kind: 'semantic',
          content: 'fact A for other agent',
          provenanceKey: 'key-1'
        })
      ).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('isolates memories by agent_id', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({ id: 'a1', agentId: 'agent-x', kind: 'semantic', content: 'x' })
      table.insert({ id: 'b1', agentId: 'agent-y', kind: 'semantic', content: 'y' })

      const xMemories = table.listByAgent('agent-x')
      expect(xMemories).toHaveLength(1)
      expect(xMemories[0]?.id).toBe('a1')
      expect(table.countByAgent('agent-y')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('detects active memories and ignores archived-only agents', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({ id: 'active-1', agentId: 'active-agent', kind: 'semantic', content: 'a' })
      table.insert({ id: 'archived-1', agentId: 'archived-agent', kind: 'semantic', content: 'b' })
      table.archive('archived-1')

      expect(table.hasActiveMemory('active-agent')).toBe(true)
      expect(table.hasActiveMemory('archived-agent')).toBe(false)
      expect(table.hasActiveMemory('empty-agent')).toBe(false)
      expect(table.listAgentIdsWithMemories()).toEqual(['active-agent'])
    } finally {
      db.close()
    }
  })

  it('tracks active persona and supersede chain', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      const v1 = table.insert({
        id: 'p1',
        agentId: 'deepchat',
        kind: 'persona',
        content: '我倾向于直接回答',
        createdAt: 1000
      })
      const v2 = table.insert({
        id: 'p2',
        agentId: 'deepchat',
        kind: 'persona',
        content: '我倾向于直接、技术化地回答',
        createdAt: 2000
      })
      table.markSuperseded(v1.id, v2.id)

      const active = table.getActivePersona('deepchat')
      expect(active?.id).toBe('p2')

      const versions = table.listPersonaVersions('deepchat')
      expect(versions).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('transitions status from pending to embedded', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({ id: 'm1', agentId: 'deepchat', kind: 'episodic', content: 'event' })
      expect(table.listPendingEmbedding()).toHaveLength(1)

      table.updateStatus('m1', 'embedded', { embeddingId: 'vec-1', embeddingDim: 1536 })
      expect(table.listPendingEmbedding()).toHaveLength(0)

      const row = table.getById('m1')
      expect(row?.status).toBe('embedded')
      expect(row?.embedding_id).toBe('vec-1')
      expect(row?.embedding_dim).toBe(1536)
    } finally {
      db.close()
    }
  })

  it('returns current embedding dimensions and detects stale embedded rows with targeted queries', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({
        id: 'current',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'current',
        createdAt: 2000
      })
      table.updateStatus('current', 'embedded', {
        embeddingId: 'current',
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      table.insert({
        id: 'wrong-dim',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'wrong dim',
        createdAt: 1000
      })
      table.updateStatus('wrong-dim', 'embedded', {
        embeddingId: 'wrong-dim',
        embeddingDim: 8,
        embeddingModel: 'p:m'
      })
      table.insert({
        id: 'persona',
        agentId: 'deepchat',
        kind: 'persona',
        content: 'persona is injected separately'
      })
      table.updateStatus('persona', 'embedded', {
        embeddingId: 'persona',
        embeddingDim: 8,
        embeddingModel: 'legacy:model'
      })
      table.insert({
        id: 'working',
        agentId: 'deepchat',
        kind: 'working',
        content: 'working cache'
      })
      table.updateStatus('working', 'embedded', {
        embeddingId: 'working',
        embeddingDim: 8,
        embeddingModel: 'legacy:model'
      })
      const superseded = table.insert({
        id: 'superseded',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'old'
      })
      table.updateStatus('superseded', 'embedded', {
        embeddingId: 'superseded',
        embeddingDim: 8,
        embeddingModel: 'legacy:model'
      })
      table.markSuperseded(superseded.id, 'current')
      table.insert({
        id: 'persona-only',
        agentId: 'excluded-agent',
        kind: 'persona',
        content: 'persona'
      })
      table.updateStatus('persona-only', 'embedded', {
        embeddingId: 'persona-only',
        embeddingDim: 8,
        embeddingModel: 'legacy:model'
      })
      table.insert({
        id: 'working-only',
        agentId: 'excluded-agent',
        kind: 'working',
        content: 'working'
      })
      table.updateStatus('working-only', 'embedded', {
        embeddingId: 'working-only',
        embeddingDim: 8,
        embeddingModel: 'legacy:model'
      })
      const excludedSuperseded = table.insert({
        id: 'excluded-superseded',
        agentId: 'excluded-agent',
        kind: 'semantic',
        content: 'old excluded'
      })
      table.updateStatus('excluded-superseded', 'embedded', {
        embeddingId: 'excluded-superseded',
        embeddingDim: 8,
        embeddingModel: 'legacy:model'
      })
      table.markSuperseded(excludedSuperseded.id, 'persona-only')

      expect(table.getCurrentEmbeddingDimension('deepchat', 'p:m')).toBe(4)
      expect(table.hasStaleEmbeddings('deepchat', 4, 'p:m')).toBe(true)
      expect(table.countStaleEmbeddings('deepchat', 4, 'p:m')).toBe(1)
      expect(table.hasStaleEmbeddings('deepchat', 8, 'legacy:model')).toBe(true)
      expect(table.getCurrentEmbeddingDimension('deepchat', 'missing:model')).toBeNull()
      expect(table.getCurrentEmbeddingDimension('excluded-agent', 'legacy:model')).toBeNull()
      expect(table.hasStaleEmbeddings('excluded-agent', 4, 'p:m')).toBe(false)
      expect(table.countStaleEmbeddings('excluded-agent', 4, 'p:m')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('computes memory health stats with full-table counters and bounded access previews', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({
        id: 'e1',
        agentId: 'a',
        kind: 'episodic',
        category: 'user_preference',
        content: 'event',
        importance: 0.1,
        status: 'embedded'
      })
      table.insert({
        id: 's1',
        agentId: 'a',
        kind: 'semantic',
        category: 'project_fact',
        content: 'fact',
        importance: 0.3,
        status: 'pending_embedding'
      })
      table.insert({
        id: 'r1',
        agentId: 'a',
        kind: 'reflection',
        content: 'reflection',
        importance: 0.5,
        status: 'error'
      })
      db.prepare("UPDATE agent_memory SET category = 'legacy_unknown' WHERE id = 'r1'").run()
      table.insert({
        id: 'p1',
        agentId: 'a',
        kind: 'persona',
        category: 'heuristic',
        content: 'persona',
        importance: 0.7,
        status: 'archived'
      })
      table.insert({
        id: 'w1',
        agentId: 'a',
        kind: 'working',
        content: 'working',
        importance: 0.9,
        status: 'fts_only'
      })
      table.insert({
        id: 'c1',
        agentId: 'a',
        kind: 'semantic',
        category: 'anti_pattern',
        content: 'conflict',
        importance: 0.2,
        status: 'conflicted'
      })
      table.markConflict('c1', 'challenged')
      const superseded = table.insert({
        id: 'old',
        agentId: 'a',
        kind: 'semantic',
        category: 'task_outcome',
        content: 'old',
        importance: 0.8,
        status: 'embedded'
      })
      table.markSuperseded(superseded.id, 's1')
      table.insert({ id: 'other', agentId: 'b', kind: 'semantic', content: 'other' })

      table.recordAccess('e1', 600)
      table.recordAccess('e1', 700)
      table.recordAccess('r1', 650)
      table.setConfidence('e1', 0.8)
      table.setConfidence('s1', 0.4)

      const stats = table.getHealthStats('a')
      expect(stats.totalRows).toBe(7)
      expect(stats.byKind).toEqual({
        episodic: 1,
        semantic: 3,
        reflection: 1,
        persona: 1,
        working: 1
      })
      expect(stats.byCategory).toMatchObject({
        user_preference: 1,
        project_fact: 1,
        task_outcome: 1,
        heuristic: 1,
        anti_pattern: 1,
        uncategorized: 2
      })
      expect(stats.byStatus).toEqual({
        pending_embedding: 1,
        embedded: 2,
        error: 1,
        fts_only: 1,
        archived: 1,
        conflicted: 1
      })
      expect(stats.neverAccessed).toBe(5)
      expect(stats.importanceAvg).toBeCloseTo(0.5)
      expect(stats.importanceMedian).toBe(0.5)
      expect(stats.confidenceAvg).toBeCloseTo(0.6)
      expect(stats.conflicted).toBe(1)
      expect(stats.challenged).toBe(1)

      table.recordAccess('p1', 800)
      table.recordAccess('c1', 900)
      table.recordAccess('old', 1000)
      table.recordAccess('w1', 1100)
      expect(table.listTopAccessed('a', 5).map((row) => row.id)).toEqual(['e1', 'r1'])
    } finally {
      db.close()
    }
  })

  it('returns zero memory health stats for an empty agent', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      const stats = table.getHealthStats('empty')
      expect(stats.totalRows).toBe(0)
      expect(stats.byKind).toEqual({
        episodic: 0,
        semantic: 0,
        reflection: 0,
        persona: 0,
        working: 0
      })
      expect(stats.byCategory).toEqual({
        user_preference: 0,
        project_fact: 0,
        task_outcome: 0,
        heuristic: 0,
        anti_pattern: 0,
        uncategorized: 0
      })
      expect(stats.byStatus).toEqual({
        pending_embedding: 0,
        embedded: 0,
        error: 0,
        fts_only: 0,
        archived: 0,
        conflicted: 0
      })
      expect(stats.neverAccessed).toBe(0)
      expect(stats.importanceAvg).toBeNull()
      expect(stats.importanceMedian).toBeNull()
      expect(stats.confidenceAvg).toBeNull()
      expect(stats.conflicted).toBe(0)
      expect(stats.challenged).toBe(0)
    } finally {
      db.close()
    }
  })

  it('computes even-count importance median and null confidence average in SQLite', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      for (const [id, importance] of [
        ['m1', 0.1],
        ['m2', 0.3],
        ['m3', 0.7],
        ['m4', 0.9]
      ] as const) {
        table.insert({
          id,
          agentId: 'a',
          kind: 'semantic',
          content: id,
          importance,
          status: 'embedded'
        })
      }

      const stats = table.getHealthStats('a')
      expect(stats.totalRows).toBe(4)
      expect(stats.importanceAvg).toBeCloseTo(0.5)
      expect(stats.importanceMedian).toBeCloseTo(0.5)
      expect(stats.confidenceAvg).toBeNull()
    } finally {
      db.close()
    }
  })

  it('counts challenged and conflicted health stats independently', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({
        id: 'conflicted-only',
        agentId: 'a',
        kind: 'semantic',
        content: 'conflicted',
        status: 'conflicted'
      })
      table.insert({
        id: 'challenged-active',
        agentId: 'a',
        kind: 'semantic',
        content: 'challenged',
        status: 'embedded'
      })
      const superseded = table.insert({
        id: 'challenged-superseded',
        agentId: 'a',
        kind: 'semantic',
        content: 'old challenged',
        status: 'embedded'
      })
      table.markConflict('challenged-active', 'challenged')
      table.markConflict(superseded.id, 'challenged')
      table.markSuperseded(superseded.id, 'challenged-active')

      const stats = table.getHealthStats('a')
      expect(stats.conflicted).toBe(1)
      expect(stats.challenged).toBe(1)
    } finally {
      db.close()
    }
  })

  it('uses rowid as the current embedding dimension tie-break for equal timestamps', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({
        id: 'same-time-old',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'older same timestamp',
        createdAt: 3000
      })
      table.updateStatus('same-time-old', 'embedded', {
        embeddingId: 'same-time-old',
        embeddingDim: 8,
        embeddingModel: 'p:m'
      })
      table.insert({
        id: 'same-time-current',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'newer same timestamp',
        createdAt: 3000
      })
      table.updateStatus('same-time-current', 'embedded', {
        embeddingId: 'same-time-current',
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })

      expect(table.getCurrentEmbeddingDimension('deepchat', 'p:m')).toBe(4)
    } finally {
      db.close()
    }
  })

  it('search excludes superseded memories', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      const old = table.insert({
        id: 'm1',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'likes redis caching'
      })
      const fresh = table.insert({
        id: 'm2',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'likes redis caching strongly'
      })
      table.markSuperseded(old.id, fresh.id)

      const results = table.search('deepchat', 'redis')
      expect(results).toHaveLength(1)
      expect(results[0]?.id).toBe('m2')
    } finally {
      db.close()
    }
  })

  it('clears all memories for an agent', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({ id: 'm1', agentId: 'deepchat', kind: 'semantic', content: 'a' })
      table.insert({ id: 'm2', agentId: 'deepchat', kind: 'semantic', content: 'b' })

      const removed = table.clearByAgent('deepchat')
      expect(removed).toBe(2)
      expect(table.countByAgent('deepchat')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('round-trips source_entry_ids lineage and leaves it null when absent', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({
        id: 'm1',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'with lineage',
        sourceSession: 's1',
        sourceEntryIds: [11, 12]
      })
      table.insert({ id: 'm2', agentId: 'deepchat', kind: 'semantic', content: 'no lineage' })
      // Empty arrays collapse to NULL (no lineage worth recording).
      table.insert({
        id: 'm3',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'empty lineage',
        sourceEntryIds: []
      })

      expect(JSON.parse(table.getById('m1')!.source_entry_ids!)).toEqual([11, 12])
      expect(table.getById('m2')?.source_entry_ids).toBe(null)
      expect(table.getById('m3')?.source_entry_ids).toBe(null)
    } finally {
      db.close()
    }
  })

  it('lists pending embeddings scoped to a single agent at the SQL layer', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({ id: 'a1', agentId: 'agent-a', kind: 'semantic', content: 'a1' })
      table.insert({ id: 'a2', agentId: 'agent-a', kind: 'semantic', content: 'a2' })
      table.insert({ id: 'b1', agentId: 'agent-b', kind: 'semantic', content: 'b1' })

      const aPending = table.listPendingEmbedding(50, 'agent-a')
      expect(aPending.map((row) => row.id).sort()).toEqual(['a1', 'a2'])
      const bPending = table.listPendingEmbedding(50, 'agent-b')
      expect(bPending.map((row) => row.id)).toEqual(['b1'])
      // No agent filter still returns the global pending set.
      expect(table.listPendingEmbedding(50)).toHaveLength(3)
    } finally {
      db.close()
    }
  })

  it("hides the internal 'working' cache row from generic listings, recall, and embedding", () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({ id: 'unit', agentId: 'a', kind: 'semantic', content: 'redis caching note' })
      table.insert({ id: 'work', agentId: 'a', kind: 'working', content: 'redis working blob' })

      // Generic listing hides working; an explicit kinds allowlist still surfaces it.
      expect(table.listByAgent('a').map((row) => row.id)).toEqual(['unit'])
      expect(table.listByAgent('a', { kinds: ['working'] }).map((row) => row.id)).toEqual(['work'])
      // Keyword recall never returns the working blob.
      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(['unit'])
      // Working rows are never queued for embedding.
      expect(table.listPendingEmbedding(50, 'a').map((row) => row.id)).toEqual(['unit'])
      expect(table.listPendingEmbedding(50).map((row) => row.id)).toEqual(['unit'])
    } finally {
      db.close()
    }
  })

  it('lists archive candidate lifecycle projections without content payloads', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      const createdAt = 1000
      table.insert({
        id: 'eligible-null',
        agentId: 'a',
        kind: 'semantic',
        content: 'large blob',
        createdAt
      })
      table.insert({
        id: 'eligible-stored',
        agentId: 'a',
        kind: 'semantic',
        content: 'stored',
        createdAt
      })
      table.insert({ id: 'accessed', agentId: 'a', kind: 'semantic', content: 'used', createdAt })
      table.recordAccess('accessed', 2000)
      table.insert({ id: 'persona', agentId: 'a', kind: 'persona', content: 'persona', createdAt })
      table.insert({ id: 'working', agentId: 'a', kind: 'working', content: 'working', createdAt })
      table.insert({ id: 'other', agentId: 'b', kind: 'semantic', content: 'other', createdAt })
      table.insert({
        id: 'archived',
        agentId: 'a',
        kind: 'semantic',
        content: 'archived',
        createdAt
      })
      table.archive('archived', 2000)
      table.insert({
        id: 'conflicted',
        agentId: 'a',
        kind: 'semantic',
        content: 'conflicted',
        createdAt
      })
      table.updateStatus('conflicted', 'conflicted')
      table.insert({
        id: 'superseded',
        agentId: 'a',
        kind: 'semantic',
        content: 'superseded',
        createdAt
      })
      table.markSuperseded('superseded', 'eligible-null')
      table.insert({
        id: 'anchor',
        agentId: 'a',
        kind: 'semantic',
        content: 'anchor',
        createdAt,
        isAnchor: true
      })
      table.updateDecayScore('eligible-stored', 0.9)

      const rows = table.listArchiveCandidateLifecycleRows('a', 5000, 10)
      expect(rows.map((row) => row.id).sort()).toEqual(['eligible-null', 'eligible-stored'])
      expect(rows.every((row) => row.access_count === 0)).toBe(true)
      expect(rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'content'))).toBe(true)
      expect(rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'embedding_id'))).toBe(
        true
      )
      expect(
        rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'source_entry_ids'))
      ).toBe(true)
    } finally {
      db.close()
    }
  })

  it('never requeues the working blob for embedding', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({
        id: 'unit',
        agentId: 'a',
        kind: 'semantic',
        content: 'fact',
        status: 'fts_only'
      })
      table.insert({
        id: 'work',
        agentId: 'a',
        kind: 'working',
        content: 'blob',
        status: 'fts_only'
      })

      // A reindex requeues real rows but must leave the internal working cache alone, or it would
      // strand at pending_embedding forever (listPendingEmbedding excludes working).
      expect(table.requeueForEmbedding('a', ['fts_only'])).toBe(1)
      expect(table.getById('unit')?.status).toBe('pending_embedding')
      expect(table.getById('work')?.status).toBe('fts_only')
    } finally {
      db.close()
    }
  })

  it('agent memory audit clearByAgent removes only the requested agent rows', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      table.insert({
        id: 'a1',
        agentId: 'a',
        eventType: 'memory/reflect',
        actorType: 'scheduler',
        status: 'completed',
        createdAt: 100
      })
      table.insert({
        id: 'a2',
        agentId: 'a',
        eventType: 'persona/evolve',
        actorType: 'runtime',
        status: 'failed',
        createdAt: 200
      })
      table.insert({
        id: 'b1',
        agentId: 'b',
        eventType: 'memory/reflect',
        actorType: 'scheduler',
        status: 'completed',
        createdAt: 300
      })

      expect(table.clearByAgent('a')).toBe(2)
      expect(table.listByAgent('a')).toEqual([])
      expect(table.listByAgent('b').map((row) => row.id)).toEqual(['b1'])
    } finally {
      db.close()
    }
  })
})

function ftsActive(db: InstanceType<NonNullable<typeof Database>>): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memory_fts'`)
    .get()
  return !!row
}

describeIfSqlite('AgentMemoryTable FTS5 + migration', () => {
  it('carries embedding_model + lineage in the authoritative schema and exposes migration v32', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      const createSql = table.getCreateTableSQL()
      expect(createSql).toContain('embedding_model')
      expect(createSql).toContain('source_entry_ids')
      expect(createSql).toContain('confidence')
      expect(createSql).toContain('last_consolidated_at')
      expect(createSql).toContain('conflict_state')
      expect(createSql).toContain('persona_state')
      expect(createSql).toContain('conflict_with')
      expect(createSql).toContain('category')
      expect(table.getLatestVersion()).toBe(37)
      expect(table.getMigrationSQL(32)).toMatch(/ADD COLUMN embedding_model/)
      expect(table.getMigrationSQL(33)).toMatch(/ADD COLUMN confidence/)
      expect(table.getMigrationSQL(34)).toMatch(/ADD COLUMN persona_state/)
      expect(table.getMigrationSQL(35)).toMatch(/ADD COLUMN conflict_with/)
      expect(table.getMigrationSQL(37)).toMatch(/ADD COLUMN category/)
      expect(table.getMigrationSQL(31)).toBeNull()

      table.createTable()
      const columns = (
        db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(columns).toContain('embedding_model')
      expect(columns).toContain('persona_state')
      expect(columns).toContain('conflict_with')
      expect(columns).toContain('category')
    } finally {
      db.close()
    }
  })

  it('recalls full words and >=3 char fragments; coverage never drops below LIKE', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({
        id: 'cn',
        agentId: 'a',
        kind: 'semantic',
        content: '用户偏好简洁的中文回答问题'
      })
      table.insert({
        id: 'redis',
        agentId: 'a',
        kind: 'semantic',
        content: 'likes redis caching strongly'
      })

      expect(table.search('a', 'redis').map((row) => row.id)).toContain('redis')
      // >=3 char CJK fragment: trigram FTS when available, otherwise the LIKE substring fallback.
      expect(table.search('a', '中文回答').map((row) => row.id)).toContain('cn')
      // 2 char CJK word is below trigram's window; the LIKE fallback still recalls it.
      expect(table.search('a', '中文').map((row) => row.id)).toContain('cn')
    } finally {
      db.close()
    }
  })

  it('keeps the FTS index in sync on delete / supersede / clear', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'a1', agentId: 'a', kind: 'semantic', content: 'redis caching' })
      table.insert({ id: 'a2', agentId: 'a', kind: 'semantic', content: 'redis sessions' })
      expect(
        table
          .search('a', 'redis')
          .map((row) => row.id)
          .sort()
      ).toEqual(['a1', 'a2'])

      table.delete('a1')
      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(['a2'])

      const a3 = table.insert({
        id: 'a3',
        agentId: 'a',
        kind: 'semantic',
        content: 'redis cluster'
      })
      table.markSuperseded('a2', a3.id)
      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(['a3'])

      table.clearByAgent('a')
      expect(table.search('a', 'redis')).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('rebuilds and backfills the FTS index from agent_memory after a drop', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis caching' })
      if (!ftsActive(db)) return
      db.exec('DROP TABLE agent_memory_fts;')
      // A fresh instance re-detects capability and rebuilds + backfills existing rows.
      const rebuilt = new AgentMemoryTableCtor(db)
      rebuilt.createTable()
      expect(rebuilt.search('a', 'redis').map((row) => row.id)).toContain('m1')
    } finally {
      db.close()
    }
  })

  it('orders multi-hit keyword results by BM25 when FTS is active', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'dense', agentId: 'a', kind: 'semantic', content: 'redis redis redis' })
      table.insert({
        id: 'sparse',
        agentId: 'a',
        kind: 'semantic',
        content: 'redis among many other unrelated words here padding text'
      })
      expect(
        table
          .search('a', 'redis')
          .map((row) => row.id)
          .sort()
      ).toEqual(['dense', 'sparse'])
      if (ftsActive(db)) {
        expect(table.search('a', 'redis')[0].id).toBe('dense')
      }
    } finally {
      db.close()
    }
  })

  it('unions LIKE so high-importance rows survive when FTS alone fills the cap (AC-2.2)', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      // Dense term repetition ranks high on BM25 but the rows carry low importance; the sparse
      // hits are what the old LIKE (importance DESC) would have returned first.
      table.insert({
        id: 'lo1',
        agentId: 'a',
        kind: 'semantic',
        content: 'redis redis redis redis',
        importance: 0.1
      })
      table.insert({
        id: 'lo2',
        agentId: 'a',
        kind: 'semantic',
        content: 'redis redis redis',
        importance: 0.05
      })
      table.insert({
        id: 'hi1',
        agentId: 'a',
        kind: 'semantic',
        content: 'redis appears once in a long padded sentence of filler words here a',
        importance: 0.9
      })
      table.insert({
        id: 'hi2',
        agentId: 'a',
        kind: 'semantic',
        content: 'redis shows up once more inside another lengthy filler sentence b',
        importance: 0.8
      })

      // limit=2 would let BM25 fill the cap with lo1/lo2 alone; the LIKE union must still surface
      // the high-importance rows the old substring search returned, instead of dropping them.
      const ids = table.search('a', 'redis', 2).map((row) => row.id)
      expect(ids).toContain('hi1')
      expect(ids).toContain('hi2')
      if (ftsActive(db)) {
        expect(ids.length).toBeGreaterThan(2)
      }
    } finally {
      db.close()
    }
  })

  it('requeueForEmbedding resets matching rows and leaves the FTS index intact', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'emb', agentId: 'a', kind: 'semantic', content: 'redis embedded' })
      table.updateStatus('emb', 'embedded', {
        embeddingId: 'v',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      table.insert({ id: 'fts', agentId: 'a', kind: 'semantic', content: 'redis fts only' })
      table.updateStatus('fts', 'fts_only')
      const sup = table.insert({ id: 'sup', agentId: 'a', kind: 'semantic', content: 'redis old' })
      table.updateStatus('sup', 'embedded', {
        embeddingId: 'v2',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      table.markSuperseded(sup.id, 'emb')
      // persona is the self-model; it must never be pulled into the vector store.
      table.insert({ id: 'persona', agentId: 'a', kind: 'persona', content: 'redis persona' })
      table.updateStatus('persona', 'fts_only')

      const changed = table.requeueForEmbedding('a', ['embedded', 'error', 'fts_only'])
      expect(changed).toBe(2)
      expect(table.getById('emb')?.status).toBe('pending_embedding')
      expect(table.getById('emb')?.embedding_dim).toBeNull()
      expect(table.getById('emb')?.embedding_model).toBeNull()
      expect(table.getById('fts')?.status).toBe('pending_embedding')
      // Superseded and persona rows are excluded from the requeue.
      expect(table.getById('sup')?.status).toBe('embedded')
      expect(table.getById('persona')?.status).toBe('fts_only')
      // Status-only changes never touch content, so keyword recall is unchanged.
      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(
        expect.arrayContaining(['emb', 'fts'])
      )
    } finally {
      db.close()
    }
  })

  it('listPendingEmbedding never returns persona rows even if one is marked pending', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'mem', agentId: 'a', kind: 'semantic', content: 'redis note' })
      table.insert({ id: 'persona', agentId: 'a', kind: 'persona', content: 'redis persona' })
      table.updateStatus('persona', 'pending_embedding')

      expect(table.listPendingEmbedding(50, 'a').map((row) => row.id)).toEqual(['mem'])
      expect(table.listPendingEmbedding(50).map((row) => row.id)).toEqual(['mem'])
    } finally {
      db.close()
    }
  })

  it('v32 migration backfills source_entry_ids and embedding_model on a legacy table', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      // Reproduce a database created before either column existed.
      db.exec('ALTER TABLE agent_memory DROP COLUMN source_entry_ids')
      db.exec('ALTER TABLE agent_memory DROP COLUMN embedding_model')

      const sql = table.getMigrationSQL(32)
      expect(sql).toBeTruthy()
      expect(sql).toContain('source_entry_ids')
      expect(sql).toContain('embedding_model')
      db.exec(sql as string)

      table.insert({
        id: 'm',
        agentId: 'a',
        kind: 'semantic',
        content: 'redis note',
        sourceSession: 's1',
        sourceEntryIds: [1, 2]
      })
      expect(table.getById('m')?.source_entry_ids).toBe('[1,2]')
    } finally {
      db.close()
    }
  })

  it('v33 migration adds the consolidation columns to a legacy table (T-M)', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      // Reproduce a database created before the consolidation columns existed.
      db.exec('ALTER TABLE agent_memory DROP COLUMN confidence')
      db.exec('ALTER TABLE agent_memory DROP COLUMN last_consolidated_at')
      db.exec('ALTER TABLE agent_memory DROP COLUMN conflict_state')
      // Seed the legacy row with raw SQL: table.insert() names every current column, including the
      // ones this migration is about to add, so it cannot run against the pre-migration schema.
      db.prepare(
        'INSERT INTO agent_memory (id, agent_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('legacy', 'a', 'semantic', 'old fact', 1000)

      const sql = table.getMigrationSQL(33)
      expect(sql).toBeTruthy()
      db.exec(sql as string)

      const columns = (
        db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(columns).toContain('confidence')
      expect(columns).toContain('last_consolidated_at')
      expect(columns).toContain('conflict_state')
      // Legacy row survives the migration with neutral defaults.
      expect(table.getById('legacy')?.confidence).toBe(null)
    } finally {
      db.close()
    }
  })

  it('v34 migration adds persona_state to a legacy table and reads legacy personas as active', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      // Reproduce a database created before the persona lifecycle column existed.
      db.exec('ALTER TABLE agent_memory DROP COLUMN persona_state')
      // Seed the legacy row with raw SQL: table.insert() names persona_state, which does not exist
      // yet on the pre-migration schema, so the ORM insert path cannot run here.
      db.prepare(
        'INSERT INTO agent_memory (id, agent_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('legacy-persona', 'a', 'persona', 'legacy self-model', 1000)

      const sql = table.getMigrationSQL(34)
      expect(sql).toBeTruthy()
      db.exec(sql as string)

      const columns = (
        db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(columns).toContain('persona_state')
      // A pre-lifecycle persona (NULL state, not superseded) keeps reading as the active self-model.
      expect(table.getById('legacy-persona')?.persona_state).toBe(null)
      expect(table.getActivePersona('a')?.id).toBe('legacy-persona')
    } finally {
      db.close()
    }
  })

  it('v37 migration adds nullable category to a legacy table', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      db.exec('ALTER TABLE agent_memory DROP COLUMN category')
      db.prepare(
        'INSERT INTO agent_memory (id, agent_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('legacy-category', 'a', 'semantic', 'legacy fact', 1000)

      const sql = table.getMigrationSQL(37)
      expect(sql).toBeTruthy()
      db.exec(sql as string)

      const columns = (
        db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(columns).toContain('category')
      expect(table.getById('legacy-category')?.category).toBe(null)

      table.insert({
        id: 'categorized',
        agentId: 'a',
        kind: 'semantic',
        category: 'project_fact',
        content: 'categorized fact'
      })
      expect(table.getById('categorized')?.category).toBe('project_fact')
    } finally {
      db.close()
    }
  })

  it('getActivePersona honors the lifecycle tristate (legacy active / superseded / draft) (AC-1.6)', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      // Legacy active: NULL state, never superseded -> readable.
      table.insert({
        id: 'legacy-active',
        agentId: 'a',
        kind: 'persona',
        content: 'legacy active',
        createdAt: 1000
      })
      expect(table.getActivePersona('a')?.id).toBe('legacy-active')

      // Legacy superseded: NULL state but superseded_by set -> never resurfaces, even if its
      // created_at is newer than the active row.
      const superseded = table.insert({
        id: 'legacy-superseded',
        agentId: 'a',
        kind: 'persona',
        content: 'legacy superseded',
        createdAt: 3000
      })
      table.markSuperseded(superseded.id, 'legacy-active')
      expect(table.getActivePersona('a')?.id).toBe('legacy-active')

      // Draft: pending approval, never injected as the active persona.
      table.insert({
        id: 'pending-draft',
        agentId: 'a',
        kind: 'persona',
        content: 'proposed self-model',
        createdAt: 4000,
        personaState: 'draft'
      })
      expect(table.getActivePersona('a')?.id).toBe('legacy-active')
      expect(table.getDraftPersona('a')?.id).toBe('pending-draft')

      // Approving the draft (active) and superseding the legacy row swaps the active self-model.
      table.setPersonaState('legacy-active', 'superseded', 'pending-draft')
      table.setPersonaState('pending-draft', 'active')
      expect(table.getActivePersona('a')?.id).toBe('pending-draft')
      expect(table.getDraftPersona('a')).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('archives, excludes archived from recall/search, and lists archive candidates', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'keep', agentId: 'a', kind: 'semantic', content: 'redis keep' })
      table.insert({ id: 'gone', agentId: 'a', kind: 'semantic', content: 'redis gone' })
      table.setLastConsolidatedAt('gone', 4000)

      table.archive('gone', 5000)
      expect(table.getById('gone')?.status).toBe('archived')
      expect(table.getById('gone')?.last_consolidated_at).toBe(4000)
      expect(table.search('a', 'redis').map((r) => r.id)).toEqual(['keep'])
      expect(table.listByAgent('a').map((r) => r.id)).toEqual(['keep'])
      expect(
        table
          .listByAgent('a', { includeArchived: true })
          .map((r) => r.id)
          .sort()
      ).toEqual(['gone', 'keep'])
    } finally {
      db.close()
    }
  })

  it('updates content, raises confidence monotonically, and flags conflicts', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'old', importance: 0.1 })

      table.updateContent('m1', 'new', 'new-key', 1234)
      expect(table.getById('m1')?.content).toBe('new')
      expect(table.getById('m1')?.provenance_key).toBe('new-key')
      expect(table.getById('m1')?.category).toBeNull()
      expect(table.getById('m1')?.last_consolidated_at).toBeNull()
      // A content rewrite re-anchors the forgetting clock so the row reads as freshly touched.
      expect(table.getById('m1')?.last_accessed).toBe(1234)
      table.updateContent('m1', 'newer', 'newer-key', 1235, 'project_fact')
      expect(table.getById('m1')?.category).toBe('project_fact')

      table.setConfidence('m1', 0.8)
      expect(table.getById('m1')?.confidence).toBe(0.8)
      table.setConfidence('m1', 0.6)
      expect(table.getById('m1')?.confidence).toBe(0.8)

      table.setImportance('m1', 0.4)
      expect(table.getById('m1')?.importance).toBe(0.4)
      table.setImportance('m1', 0.2)
      expect(table.getById('m1')?.importance).toBe(0.4)

      table.markConflict('m1', 'challenged')
      expect(table.getById('m1')?.conflict_state).toBe('challenged')
      table.markConflict('m1', null)
      expect(table.getById('m1')?.conflict_state).toBe(null)
    } finally {
      db.close()
    }
  })

  it('getLastConsolidatedAt returns the most recent marker for the agent', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'a' })
      table.insert({ id: 'm2', agentId: 'a', kind: 'semantic', content: 'b' })
      table.insert({ id: 'other', agentId: 'b', kind: 'semantic', content: 'c' })
      expect(table.getLastConsolidatedAt('a')).toBe(null)

      table.setLastConsolidatedAt('m1', 100)
      table.setLastConsolidatedAt('m2', 300)
      table.setLastConsolidatedAt('other', 9999)
      expect(table.getLastConsolidatedAt('a')).toBe(300)
    } finally {
      db.close()
    }
  })

  it('updateDecayScore stamps last_consolidated_at only when a timestamp is passed', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'a' })

      // No timestamp: decay updates, last_consolidated_at stays untouched (COALESCE keeps prior).
      table.updateDecayScore('m1', 0.4)
      expect(table.getById('m1')?.decay_score).toBe(0.4)
      expect(table.getById('m1')?.last_consolidated_at).toBe(null)

      // With a timestamp: callers can explicitly mark row-level LLM consolidation.
      table.updateDecayScore('m1', 0.2, 777)
      expect(table.getById('m1')?.decay_score).toBe(0.2)
      expect(table.getById('m1')?.last_consolidated_at).toBe(777)

      // A later decay-only refresh must not wipe the stamp.
      table.updateDecayScore('m1', 0.1)
      expect(table.getById('m1')?.last_consolidated_at).toBe(777)
    } finally {
      db.close()
    }
  })

  it('agent memory audit returns the latest completed LLM maintenance event only', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      table.insert({
        id: 'a1',
        agentId: 'a',
        eventType: 'memory/maintenance_llm',
        actorType: 'scheduler',
        status: 'skipped',
        createdAt: 100
      })
      table.insert({
        id: 'a2',
        agentId: 'a',
        eventType: 'memory/maintenance_llm',
        actorType: 'scheduler',
        status: 'completed',
        createdAt: 200
      })
      table.insert({
        id: 'a3',
        agentId: 'a',
        eventType: 'memory/maintenance_llm',
        actorType: 'scheduler',
        status: 'completed',
        createdAt: 300
      })
      table.insert({
        id: 'other',
        agentId: 'b',
        eventType: 'memory/maintenance_llm',
        actorType: 'scheduler',
        status: 'completed',
        createdAt: 999
      })
      expect(table.getLatestCompletedEventAt('a', 'memory/maintenance_llm')).toBe(300)
      expect(table.getLatestCompletedEventAt('a', 'memory/reflect')).toBeNull()
    } finally {
      db.close()
    }
  })

  it('agent memory audit computes bounded health status counts and recent failures', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      table.insert({
        id: 'old',
        agentId: 'a',
        eventType: 'memory/old',
        actorType: 'scheduler',
        status: 'failed',
        reason: 'old failure',
        createdAt: 100
      })
      table.insert({
        id: 'completed',
        agentId: 'a',
        eventType: 'memory/reflect',
        actorType: 'scheduler',
        status: 'completed',
        createdAt: 200
      })
      table.insert({
        id: 'skipped',
        agentId: 'a',
        eventType: 'memory/archive',
        actorType: 'scheduler',
        status: 'skipped',
        reason: 'cooldown',
        createdAt: 300
      })
      table.insert({
        id: 'failed',
        agentId: 'a',
        eventType: 'memory/maintenance_llm',
        actorType: 'scheduler',
        status: 'failed',
        reason: 'model unavailable',
        createdAt: 400
      })

      const stats = table.getHealthAuditStats('a', 3, 1)
      expect(stats).toEqual({
        completed: 1,
        skipped: 1,
        failed: 1,
        recentFailures: [
          {
            eventType: 'memory/maintenance_llm',
            status: 'failed',
            reason: 'model unavailable',
            createdAt: 400
          }
        ]
      })
      expect(table.getHealthAuditStats('missing', 200, 5)).toEqual({
        completed: 0,
        skipped: 0,
        failed: 0,
        recentFailures: []
      })
    } finally {
      db.close()
    }
  })

  it('listArchiveCandidates pre-filters by age, decay, and exemptions', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const old = 1000
      table.insert({ id: 'stale', agentId: 'a', kind: 'semantic', content: 's', createdAt: old })
      table.insert({
        id: 'accessed',
        agentId: 'a',
        kind: 'semantic',
        content: 'used',
        createdAt: old
      })
      table.insert({ id: 'fresh', agentId: 'a', kind: 'semantic', content: 'f', createdAt: 9000 })
      table.insert({
        id: 'anchored',
        agentId: 'a',
        kind: 'semantic',
        content: 'an',
        createdAt: old,
        isAnchor: true
      })
      table.updateDecayScore('stale', 0.01)
      table.updateDecayScore('accessed', 0.01)
      table.recordAccess('accessed', 7000)
      table.updateDecayScore('fresh', 0.01)
      table.updateDecayScore('anchored', 0.01)

      const candidates = table.listArchiveCandidates('a', 5000, 0.05)
      expect(candidates.map((r) => r.id).sort()).toEqual(['accessed', 'stale'])
      expect(table.countArchiveCandidates('a', 5000, 0.05)).toBe(1)
    } finally {
      db.close()
    }
  })

  it('agent memory audit list filters remain compatible with limit calls', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      table.insert({
        id: 'a1',
        agentId: 'a',
        eventType: 'memory/reflect',
        actorType: 'scheduler',
        status: 'completed',
        sessionId: 's1',
        createdAt: 100
      })
      table.insert({
        id: 'a2',
        agentId: 'a',
        eventType: 'persona/evolve',
        actorType: 'runtime',
        status: 'failed',
        sessionId: 's2',
        createdAt: 200
      })
      table.insert({
        id: 'b1',
        agentId: 'b',
        eventType: 'memory/reflect',
        actorType: 'scheduler',
        status: 'completed',
        sessionId: 's1',
        createdAt: 300
      })

      expect(table.listByAgent('a', 1).map((row) => row.id)).toEqual(['a2'])
      expect(
        table
          .listByAgent('a', {
            eventType: 'memory/reflect',
            actorType: 'scheduler',
            sessionId: 's1',
            status: 'completed',
            startCreatedAt: 50,
            endCreatedAt: 150
          })
          .map((row) => row.id)
      ).toEqual(['a1'])
    } finally {
      db.close()
    }
  })
})
