import { describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/agentMemory').catch(() => null)
  : null

const Database = sqliteModule?.default
const AgentMemoryTable = tableModule?.AgentMemoryTable
const DatabaseCtor = Database!
const AgentMemoryTableCtor = AgentMemoryTable!

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

const describeIfSqlite = sqliteAvailable && AgentMemoryTable ? describe : describe.skip

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
        content: '用户偏好简洁的中文回答',
        createdAt: 1000
      })

      expect(row.status).toBe('pending_embedding')
      expect(row.importance).toBe(0.5)
      expect(row.is_anchor).toBe(0)

      const fetched = table.getById('m1')
      expect(fetched?.content).toBe('用户偏好简洁的中文回答')
      expect(fetched?.agent_id).toBe('deepchat')
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
      expect(table.getLatestVersion()).toBe(32)
      expect(table.getMigrationSQL(32)).toMatch(/ADD COLUMN embedding_model/)
      expect(table.getMigrationSQL(31)).toBeNull()

      table.createTable()
      const columns = (
        db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(columns).toContain('embedding_model')
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

      const sql = table.getMigrationSQL(table.getLatestVersion())
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
})
