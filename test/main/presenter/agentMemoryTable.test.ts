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
