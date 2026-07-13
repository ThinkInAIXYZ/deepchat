import { expect, it, vi } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const tableModule = Database
  ? await import('@/presenter/sqlitePresenter/tables/agentMemory').catch(() => null)
  : null
const auditTableModule = Database
  ? await import('@/presenter/sqlitePresenter/tables/agentMemoryAudit').catch(() => null)
  : null
const ftsPolicyModule = Database
  ? await import('@/presenter/sqlitePresenter/tables/agentMemoryFtsPolicy').catch(() => null)
  : null

const AgentMemoryTable = tableModule?.AgentMemoryTable
const buildPendingEmbeddingSelectSql = tableModule?.buildPendingEmbeddingSelectSql
const AgentMemoryAuditTable = auditTableModule?.AgentMemoryAuditTable
const agentFtsScope = ftsPolicyModule?.agentFtsScope
const buildRecallablePredicate = ftsPolicyModule?.buildRecallablePredicate
const isRecallableFtsRow = ftsPolicyModule?.isRecallableFtsRow
const DatabaseCtor = Database!
const AgentMemoryTableCtor = AgentMemoryTable!
const AgentMemoryAuditTableCtor = AgentMemoryAuditTable!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(
    AgentMemoryTable &&
    buildPendingEmbeddingSelectSql &&
    AgentMemoryAuditTable &&
    agentFtsScope &&
    buildRecallablePredicate &&
    isRecallableFtsRow
  ),
  'Agent Memory native table modules are unavailable'
)

type AgentMemorySearchInternals = {
  searchLike(...args: unknown[]): unknown[]
}

function setTestMemoryStatus(
  db: InstanceType<typeof DatabaseCtor>,
  table: InstanceType<typeof AgentMemoryTableCtor>,
  id: string,
  status: 'pending_embedding' | 'embedded' | 'error' | 'fts_only' | 'archived' | 'conflicted',
  embedding?: {
    embeddingId?: string | null
    embeddingDim?: number | null
    embeddingModel?: string | null
  }
): void {
  const row = db
    .prepare(
      'SELECT agent_id, kind, lifecycle_state, decision_revision FROM agent_memory WHERE id = ?'
    )
    .get(id) as
    | { agent_id: string; kind: string; lifecycle_state: string; decision_revision: number }
    | undefined
  const internal = row?.kind === 'persona' || row?.kind === 'working'
  if (status === 'archived') {
    archiveTestMemory(table, id)
    return
  }
  if (status === 'pending_embedding' && !internal) {
    if (row?.lifecycle_state === 'archived') {
      expect(
        table.restoreArchivedMemory({
          agentId: row.agent_id,
          id,
          expectedRevision: row.decision_revision
        })
      ).toBe(true)
      return
    }
    db.prepare(
      `UPDATE agent_memory
       SET embedding_state = 'pending', status = 'pending_embedding',
           embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL
       WHERE id = ? AND lifecycle_state = 'active'`
    ).run(id)
    return
  }
  if (status === 'embedded' && !internal) {
    db.prepare(
      `UPDATE agent_memory
       SET embedding_state = 'ready', status = 'embedded',
           embedding_id = ?, embedding_dim = ?, embedding_model = ?
       WHERE id = ?`
    ).run(
      embedding?.embeddingId ?? id,
      embedding?.embeddingDim ?? 1,
      embedding?.embeddingModel ?? 'legacy:test',
      id
    )
    return
  }
  if ((status === 'error' || status === 'fts_only') && !internal) {
    db.prepare(
      `UPDATE agent_memory
       SET embedding_state = ?, status = ?,
           embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL
       WHERE id = ?`
    ).run(status, status, id)
    return
  }
  if (status === 'conflicted') {
    db.prepare('UPDATE agent_memory SET lifecycle_state = ?, status = ? WHERE id = ?').run(
      status,
      status,
      id
    )
    return
  }
  const embeddingState =
    status === 'embedded' ? 'ready' : status === 'pending_embedding' ? 'pending' : status
  db.prepare(
    `UPDATE agent_memory
     SET lifecycle_state = 'active', embedding_state = ?, status = ?,
         embedding_id = ?, embedding_dim = ?, embedding_model = ?
     WHERE id = ?`
  ).run(
    embeddingState,
    status,
    embedding?.embeddingId ?? null,
    embedding?.embeddingDim ?? null,
    embedding?.embeddingModel ?? null,
    id
  )
}

function seedTestSupersession(
  db: InstanceType<typeof DatabaseCtor>,
  id: string,
  supersededBy: string | null
): void {
  db.prepare(
    `UPDATE agent_memory
     SET superseded_by = ?, decision_revision = decision_revision + 1
     WHERE id = ?`
  ).run(supersededBy, id)
}

function seedTestConflictState(
  db: InstanceType<typeof DatabaseCtor>,
  id: string,
  state: 'challenged' | null
): void {
  db.prepare(
    `UPDATE agent_memory
     SET conflict_state = ?, decision_revision = decision_revision + 1
     WHERE id = ?`
  ).run(state, id)
}

function seedTestCanonicalState(
  db: InstanceType<typeof DatabaseCtor>,
  id: string,
  lifecycleState: 'active' | 'archived' | 'conflicted',
  embeddingState: 'pending' | 'ready' | 'error' | 'fts_only' | 'not_applicable'
): void {
  const status =
    lifecycleState === 'archived'
      ? 'archived'
      : lifecycleState === 'conflicted'
        ? 'conflicted'
        : embeddingState === 'ready'
          ? 'embedded'
          : embeddingState === 'pending'
            ? 'pending_embedding'
            : embeddingState === 'not_applicable'
              ? 'fts_only'
              : embeddingState
  db.prepare(
    `UPDATE agent_memory
     SET lifecycle_state = ?, embedding_state = ?, status = ?,
         embedding_id = CASE WHEN ? = 'ready' THEN id || '-vector' ELSE NULL END,
         embedding_dim = CASE WHEN ? = 'ready' THEN 4 ELSE NULL END,
         embedding_model = CASE WHEN ? = 'ready' THEN 'test:model' ELSE NULL END
     WHERE id = ?`
  ).run(lifecycleState, embeddingState, status, embeddingState, embeddingState, embeddingState, id)
}

function seedTestContentUpdate(
  db: InstanceType<typeof DatabaseCtor>,
  id: string,
  content: string,
  provenanceKey: string | null,
  at: number,
  category?: string | null
): void {
  const categorySql = category === undefined ? '' : ', category = ?'
  const params: unknown[] = [content, provenanceKey, at]
  if (category !== undefined) params.push(category)
  params.push(id)
  db.prepare(
    `UPDATE agent_memory
     SET content = ?, provenance_key = ?, last_accessed = ?${categorySql},
         decision_revision = decision_revision + 1
     WHERE id = ?`
  ).run(...params)
}

function repairTestLegacyShadow(db: InstanceType<typeof DatabaseCtor>, agentId?: string): number {
  const agentPredicate = agentId === undefined ? '' : 'AND agent_id = ?'
  return db
    .prepare(
      `UPDATE agent_memory
       SET status = CASE
         WHEN lifecycle_state = 'archived' THEN 'archived'
         WHEN lifecycle_state = 'conflicted' THEN 'conflicted'
         WHEN embedding_state = 'ready' THEN 'embedded'
         WHEN embedding_state = 'error' THEN 'error'
         WHEN embedding_state IN ('fts_only', 'not_applicable') THEN 'fts_only'
         ELSE 'pending_embedding'
       END
       WHERE status != CASE
         WHEN lifecycle_state = 'archived' THEN 'archived'
         WHEN lifecycle_state = 'conflicted' THEN 'conflicted'
         WHEN embedding_state = 'ready' THEN 'embedded'
         WHEN embedding_state = 'error' THEN 'error'
         WHEN embedding_state IN ('fts_only', 'not_applicable') THEN 'fts_only'
         ELSE 'pending_embedding'
       END
       ${agentPredicate}`
    )
    .run(...(agentId === undefined ? [] : [agentId])).changes
}

function archiveTestMemory(table: InstanceType<typeof AgentMemoryTableCtor>, id: string): void {
  const row = table.getById(id)
  expect(row).toBeDefined()
  expect(
    table.archiveActiveMemory({
      agentId: row!.agent_id,
      id,
      expectedRevision: row!.decision_revision
    })
  ).toBe(true)
}

function dropV42CanonicalArtifacts(db: InstanceType<typeof DatabaseCtor>): void {
  db.exec(`
    DROP TRIGGER IF EXISTS agent_memory_legacy_status_bridge_ai;
    DROP TRIGGER IF EXISTS agent_memory_legacy_status_bridge_au;
    DROP INDEX IF EXISTS idx_agent_memory_active_recall;
    DROP INDEX IF EXISTS idx_agent_memory_recall_importance_v5;
    DROP INDEX IF EXISTS idx_agent_memory_archive_eligible_v3;
    DROP INDEX IF EXISTS idx_agent_memory_cognitive_top_v3;
    DROP INDEX IF EXISTS idx_agent_memory_conflict_fairness_v3;
    DROP INDEX IF EXISTS idx_agent_memory_recent_activity_v3;
    DROP INDEX IF EXISTS idx_agent_memory_embedding_pending_agent_v2;
    DROP INDEX IF EXISTS idx_agent_memory_embedding_pending_global_v2;
    DROP INDEX IF EXISTS idx_agent_memory_conflict_target_v2;
    DROP INDEX IF EXISTS idx_agent_memory_conflict_link_anomaly_v2;
  `)
}

describeIfSqlite('AgentMemoryTable', () => {
  it('uses the conflict target index for participant lookup in a 50k-row agent', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const insert = db.prepare(
        `INSERT INTO agent_memory (id, agent_id, kind, content, status, created_at)
           VALUES (?, 'a', 'semantic', 'bulk memory', 'embedded', ?)`
      )
      db.transaction(() => {
        for (let index = 0; index < 50_000; index += 1) {
          insert.run(`bulk-${index}`, index)
        }
      })()
      db.exec(`
        UPDATE agent_memory
        SET lifecycle_state = CASE status
          WHEN 'archived' THEN 'archived'
          WHEN 'conflicted' THEN 'conflicted'
          ELSE 'active'
        END,
        embedding_state = CASE status
          WHEN 'embedded' THEN 'ready'
          WHEN 'error' THEN 'error'
          WHEN 'fts_only' THEN 'fts_only'
          ELSE 'pending'
        END;
      `)
      table.insert({
        id: 'target',
        agentId: 'a',
        kind: 'semantic',
        content: 'target',
        status: 'embedded'
      })
      table.insert({
        id: 'challenger',
        agentId: 'a',
        kind: 'semantic',
        content: 'challenger',
        status: 'conflicted',
        conflictWith: 'target'
      })
      table.insert({
        id: 'sibling',
        agentId: 'a',
        kind: 'semantic',
        content: 'sibling',
        status: 'conflicted',
        conflictWith: 'target'
      })

      expect(table.isUnresolvedConflictParticipant('a', 'target')).toBe(true)
      expect(table.listConflictSiblings('a', 'target', 'challenger').map((row) => row.id)).toEqual([
        'sibling'
      ])
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
             SELECT 1
             FROM agent_memory candidate
             WHERE candidate.agent_id = ? AND candidate.id = ?
               AND EXISTS (
                 SELECT 1 FROM agent_memory challenger
                 WHERE challenger.agent_id = candidate.agent_id
                   AND challenger.lifecycle_state = 'conflicted'
                   AND challenger.superseded_by IS NULL
                   AND challenger.conflict_with = candidate.id
               )`
        )
        .all('a', 'target') as Array<{ detail: string }>
      expect(plan.some((row) => row.detail.includes('idx_agent_memory_conflict_target'))).toBe(true)
    } finally {
      db.close()
    }
  }, 15_000)

  it('keeps conflict sibling transitions and bounded repairs set-based at 1k scale', () => {
    const statements: string[] = []
    const db = new DatabaseCtor(':memory:', {
      verbose: (statement: string) => statements.push(statement)
    })
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const insert = db.prepare(
        `INSERT INTO agent_memory (
           id, agent_id, kind, content, status, superseded_by, created_at,
           conflict_state, conflict_with
         ) VALUES (?, ?, 'semantic', ?, ?, NULL, ?, ?, ?)`
      )
      db.transaction(() => {
        insert.run('target', 'a', 'target', 'embedded', 1, 'challenged', null)
        insert.run('winner', 'a', 'winner', 'conflicted', 2, null, 'target')
        for (let index = 0; index < 1_000; index += 1) {
          insert.run(`sibling-${index}`, 'a', 'sibling', 'conflicted', index + 3, null, 'target')
        }
        for (let index = 0; index < 300; index += 1) {
          insert.run(
            `repair-${index}`,
            'repair',
            'invalid link',
            'embedded',
            index,
            null,
            'missing-target'
          )
        }
      })()

      db.exec(`
        UPDATE agent_memory
        SET lifecycle_state = CASE status
          WHEN 'archived' THEN 'archived'
          WHEN 'conflicted' THEN 'conflicted'
          ELSE 'active'
        END,
        embedding_state = CASE status
          WHEN 'embedded' THEN 'ready'
          WHEN 'error' THEN 'error'
          WHEN 'fts_only' THEN 'fts_only'
          ELSE 'pending'
        END;
      `)

      statements.length = 0
      expect(table.retireConflictSiblings('a', 'target', 'winner', 'winner', 10)).toBe(1_000)
      expect(statements).toHaveLength(1)
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM agent_memory
             WHERE agent_id = 'a' AND status = 'archived' AND superseded_by = 'winner'`
          )
          .get()
      ).toEqual({ count: 1_000 })

      statements.length = 0
      expect(table.repairConflictIntegrityBatch('repair', 256)).toEqual({
        repairedTargets: 0,
        archivedChallengers: 0,
        clearedTargets: 0,
        clearedLinks: 64
      })
      expect(statements.length).toBeLessThanOrEqual(9)
      expect(table.listConflictIntegrityRows('repair')).toHaveLength(236)
    } finally {
      db.close()
    }
  })

  it('uses bounded maintenance indexes for archive, cognitive top-N, and conflict fairness', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const insert = db.prepare(
        `INSERT INTO agent_memory (
           id, agent_id, kind, content, status, is_anchor, created_at, importance
         ) VALUES (?, 'a', ?, 'fixture', ?, 0, ?, 0.5)`
      )
      db.transaction(() => {
        for (let index = 0; index < 2_000; index += 1) {
          insert.run(`excluded-${index}`, 'persona', 'archived', index)
        }
        for (let index = 0; index < 20; index += 1) {
          insert.run(`eligible-${index}`, 'semantic', 'embedded', index)
        }
        insert.run('target', 'semantic', 'embedded', 100)
        db.prepare(
          "UPDATE agent_memory SET conflict_state = 'challenged' WHERE id = 'target'"
        ).run()
        for (let index = 0; index < 4; index += 1) {
          insert.run(`challenger-${index}`, 'semantic', 'conflicted', 200 + index)
          db.prepare('UPDATE agent_memory SET conflict_with = ? WHERE id = ?').run(
            'target',
            `challenger-${index}`
          )
        }
      })()
      db.exec('ANALYZE')
      const archivePlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id
           FROM agent_memory INDEXED BY idx_agent_memory_archive_eligible_v3
           WHERE agent_id = ?
             AND superseded_by IS NULL
             AND conflict_state IS NULL
             AND lifecycle_state = 'active'
             AND is_anchor = 0
             AND kind NOT IN ('persona', 'working')
             AND created_at < ?
             AND COALESCE(last_accessed, created_at) < ? - ?
             AND (? - COALESCE(last_accessed, created_at)) >
               ? * (1 + min(1.0, max(0.0, importance)))
           ORDER BY COALESCE(last_accessed, created_at) ASC, created_at ASC, id ASC
           LIMIT ?`
        )
        .all('a', 1000, 2000, 100, 2000, 100, 256) as Array<{ detail: string }>
      expect(
        archivePlan.some((row) => row.detail.includes('idx_agent_memory_archive_eligible_v3')),
        JSON.stringify(archivePlan)
      ).toBe(true)
      expect(archivePlan.some((row) => row.detail.includes('TEMP B-TREE FOR ORDER BY'))).toBe(false)

      const cognitivePlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT *
           FROM agent_memory INDEXED BY idx_agent_memory_cognitive_top_v3
           WHERE agent_id = ?
             AND superseded_by IS NULL
             AND lifecycle_state = 'active'
             AND kind IN ('episodic', 'semantic', 'reflection')
             AND kind IN ('episodic', 'semantic')
           ORDER BY importance DESC, created_at DESC, id DESC
           LIMIT ?`
        )
        .all('a', 50) as Array<{ detail: string }>
      expect(
        cognitivePlan.some((row) => row.detail.includes('idx_agent_memory_cognitive_top_v3'))
      ).toBe(true)
      expect(cognitivePlan.some((row) => row.detail.includes('TEMP B-TREE FOR ORDER BY'))).toBe(
        false
      )

      const embeddingPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${buildPendingEmbeddingSelectSql!(true)}`)
        .all('a', 50) as Array<{ detail: string }>
      expect(
        embeddingPlan.some((row) =>
          row.detail.includes('idx_agent_memory_embedding_pending_agent_v2')
        )
      ).toBe(true)
      expect(embeddingPlan.some((row) => row.detail.includes('TEMP B-TREE FOR ORDER BY'))).toBe(
        false
      )

      const globalEmbeddingPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${buildPendingEmbeddingSelectSql!(false)}`)
        .all(50) as Array<{ detail: string }>
      expect(
        globalEmbeddingPlan.some((row) =>
          row.detail.includes('idx_agent_memory_embedding_pending_global_v2')
        )
      ).toBe(true)
      expect(
        globalEmbeddingPlan.some((row) => row.detail.includes('TEMP B-TREE FOR ORDER BY'))
      ).toBe(false)

      const recentActivityPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT COALESCE(last_accessed, created_at)
           FROM agent_memory INDEXED BY idx_agent_memory_recent_activity_v3
           WHERE agent_id = ? AND lifecycle_state != 'archived'
           ORDER BY COALESCE(last_accessed, created_at) DESC
           LIMIT 1`
        )
        .all('a') as Array<{ detail: string }>
      expect(
        recentActivityPlan.some((row) => row.detail.includes('idx_agent_memory_recent_activity_v3'))
      ).toBe(true)
      expect(
        recentActivityPlan.some((row) => row.detail.includes('TEMP B-TREE FOR ORDER BY'))
      ).toBe(false)

      const conflictPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT challenger.*
           FROM agent_memory challenger INDEXED BY idx_agent_memory_conflict_fairness_v3
           WHERE challenger.agent_id = ?
             AND challenger.lifecycle_state = 'conflicted'
             AND challenger.superseded_by IS NULL
             AND EXISTS (
               SELECT 1
               FROM agent_memory target
               WHERE target.id = challenger.conflict_with
                 AND target.agent_id = challenger.agent_id
                 AND target.conflict_state = 'challenged'
                 AND target.superseded_by IS NULL
             )
           ORDER BY COALESCE(challenger.last_consolidated_at, 0) ASC,
                    challenger.created_at ASC,
                    challenger.id ASC
           LIMIT ?`
        )
        .all('a', 4) as Array<{ detail: string }>
      expect(
        conflictPlan.some((row) => row.detail.includes('idx_agent_memory_conflict_fairness_v3'))
      ).toBe(true)
      expect(conflictPlan.some((row) => row.detail.includes('TEMP B-TREE FOR ORDER BY'))).toBe(
        false
      )
    } finally {
      db.close()
    }
  })

  it('archives at most 256 eligible rows per current-decay batch', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      db.transaction(() => {
        for (let index = 0; index < 300; index += 1) {
          table.insert({
            id: `old-${index.toString().padStart(3, '0')}`,
            agentId: 'a',
            kind: 'semantic',
            content: `old memory ${index}`,
            importance: 0.5,
            status: 'embedded',
            createdAt: index
          })
        }
        table.insert({
          id: 'recent',
          agentId: 'a',
          kind: 'semantic',
          content: 'recent',
          status: 'embedded',
          createdAt: 9_900
        })
        table.insert({
          id: 'anchor',
          agentId: 'a',
          kind: 'semantic',
          content: 'anchor',
          status: 'embedded',
          isAnchor: true,
          createdAt: 0
        })
      })()

      const first = table.archiveEligibleBatch('a', {
        now: 10_000,
        createdBefore: 5_000,
        minimumBaseAgeMs: 100,
        limit: 256
      })
      const second = table.archiveEligibleBatch('a', {
        now: 10_000,
        createdBefore: 5_000,
        minimumBaseAgeMs: 100,
        limit: 256
      })

      expect(first).toHaveLength(256)
      expect(second).toHaveLength(44)
      expect(new Set([...first, ...second]).size).toBe(300)
      expect(table.getById('recent')?.status).toBe('embedded')
      expect(table.getById('anchor')?.status).toBe('embedded')
    } finally {
      db.close()
    }
  })

  it('bulk embedding persistence rejects stale revisions and batches malformed errors', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      for (const id of ['ready', 'edited']) {
        table.insert({
          id,
          agentId: 'a',
          kind: 'semantic',
          content: id,
          status: 'pending_embedding'
        })
      }
      expect(
        table.updateUserContentAndInvalidateEmbedding({
          agentId: 'a',
          id: 'edited',
          expectedRevision: 1,
          content: 'edited after snapshot',
          provenanceKey: null,
          at: 10
        })
      ).toBe(true)

      expect(
        table.markPendingEmbeddingsReady('a', [
          {
            id: 'ready',
            expectedRevision: 1,
            embeddingId: 'ready',
            embeddingDim: 4,
            embeddingModel: 'p:m'
          },
          {
            id: 'edited',
            expectedRevision: 1,
            embeddingId: 'edited',
            embeddingDim: 4,
            embeddingModel: 'p:m'
          }
        ])
      ).toEqual(['ready'])
      expect(table.getById('ready')).toMatchObject({ status: 'embedded', embedding_dim: 4 })
      expect(table.getById('edited')).toMatchObject({
        status: 'pending_embedding',
        decision_revision: 2,
        embedding_id: null
      })
      expect(
        table.markPendingEmbeddingsError('a', [{ id: 'edited', expectedRevision: 1 }])
      ).toEqual([])
      expect(
        table.markPendingEmbeddingsError('a', [{ id: 'edited', expectedRevision: 2 }])
      ).toEqual(['edited'])
      expect(table.getById('edited')?.status).toBe('error')
    } finally {
      db.close()
    }
  })

  it('enforces intent transition guards and exact decision revision deltas', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'user', agentId: 'a', kind: 'semantic', content: 'before' })
      setTestMemoryStatus(db, table, 'user', 'embedded', {
        embeddingId: 'user-vector',
        embeddingDim: 4,
        embeddingModel: 'p:m'
      })
      const active = table.getById('user')!

      expect(
        table.archiveActiveMemory({
          agentId: 'other',
          id: active.id,
          expectedRevision: active.decision_revision
        })
      ).toBe(false)
      expect(
        table.archiveActiveMemory({
          agentId: 'a',
          id: active.id,
          expectedRevision: active.decision_revision + 1
        })
      ).toBe(false)
      expect(
        table.archiveActiveMemory({
          agentId: 'a',
          id: active.id,
          expectedRevision: active.decision_revision
        })
      ).toBe(true)
      const archived = table.getById('user')!
      expect(archived.decision_revision).toBe(active.decision_revision + 1)
      expect(archived.embedding_state).toBe('ready')
      expect(archived.embedding_id).toBe('user-vector')
      expect(
        table.markPendingEmbeddingsReady('a', [
          {
            id: archived.id,
            expectedRevision: archived.decision_revision,
            embeddingId: 'late-vector',
            embeddingDim: 8,
            embeddingModel: 'late:model'
          }
        ])
      ).toEqual([])
      expect(
        table.restoreArchivedMemory({
          agentId: 'a',
          id: archived.id,
          expectedRevision: archived.decision_revision
        })
      ).toBe(true)
      const restored = table.getById('user')!
      expect(restored.decision_revision).toBe(archived.decision_revision + 1)
      expect(restored.embedding_state).toBe('pending')
      expect(restored.embedding_id).toBeNull()

      expect(
        table.updateUserContentAndInvalidateEmbedding({
          agentId: 'a',
          id: restored.id,
          expectedRevision: restored.decision_revision,
          content: 'after',
          provenanceKey: 'after-key',
          category: 'user_preference',
          importance: 0.9,
          at: 10
        })
      ).toBe(true)
      const edited = table.getById('user')!
      expect(edited.decision_revision).toBe(restored.decision_revision + 1)
      expect(edited).toMatchObject({
        content: 'after',
        provenance_key: 'after-key',
        category: 'user_preference',
        importance: 0.9,
        embedding_state: 'pending'
      })

      table.insert({ id: 'internal', agentId: 'a', kind: 'working', content: 'cache' })
      const internal = table.getById('internal')!
      expect(
        table.archiveActiveMemory({
          agentId: 'a',
          id: internal.id,
          expectedRevision: internal.decision_revision
        })
      ).toBe(false)

      table.insert({ id: 'head', agentId: 'a', kind: 'semantic', content: 'head' })
      table.insert({ id: 'old', agentId: 'a', kind: 'semantic', content: 'old' })
      seedTestSupersession(db, 'old', 'head')
      const superseded = table.getById('old')!
      const head = table.getById('head')!
      expect(
        table.reviveSupersededMemory({
          agentId: 'a',
          id: superseded.id,
          expectedRevision: superseded.decision_revision,
          retiredHead: { id: head.id, expectedRevision: head.decision_revision + 1 }
        })
      ).toBe(false)
      expect(table.getById('old')?.superseded_by).toBe('head')
      expect(table.getById('head')).toMatchObject({
        superseded_by: null,
        decision_revision: head.decision_revision
      })
      expect(
        table.reviveSupersededMemory({
          agentId: 'a',
          id: superseded.id,
          expectedRevision: superseded.decision_revision,
          retiredHead: { id: head.id, expectedRevision: head.decision_revision }
        })
      ).toBe(true)
      expect(table.getById('old')).toMatchObject({
        superseded_by: null,
        embedding_state: 'pending',
        decision_revision: superseded.decision_revision + 1
      })
      expect(table.getById('head')).toMatchObject({
        superseded_by: 'old',
        decision_revision: head.decision_revision + 1
      })

      table.insert({ id: 'target', agentId: 'a', kind: 'semantic', content: 'target' })
      const target = table.getById('target')!
      expect(
        table.markConflictIfRevision('a', target.id, target.decision_revision, 'challenged')
      ).toBe(true)
      table.insert({
        id: 'challenger',
        agentId: 'a',
        kind: 'semantic',
        content: 'challenger',
        lifecycleState: 'conflicted',
        embeddingState: 'pending',
        conflictWith: target.id
      })
      const challengedTarget = table.getById('target')!
      const challenger = table.getById('challenger')!
      const ftsMetaBeforeRejectedTransitions = db
        .prepare(
          `SELECT mutation_generation, indexed_generation
           FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'`
        )
        .get()
      expect(table.search('a', 'target').map((row) => row.id)).toContain('target')
      expect(
        table.archiveActiveMemory({
          agentId: 'a',
          id: challengedTarget.id,
          expectedRevision: challengedTarget.decision_revision
        })
      ).toBe(false)
      expect(
        table.archiveResolvedConflictTarget({
          agentId: 'a',
          id: challengedTarget.id,
          expectedRevision: challengedTarget.decision_revision,
          challengerId: challenger.id
        })
      ).toBe(false)
      expect(table.search('a', 'target').map((row) => row.id)).toContain('target')
      expect(
        db
          .prepare(
            `SELECT mutation_generation, indexed_generation
             FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'`
          )
          .get()
      ).toEqual(ftsMetaBeforeRejectedTransitions)
      expect(
        table.activateResolvedChallenger({
          agentId: 'a',
          id: challenger.id,
          expectedRevision: challenger.decision_revision,
          targetId: challengedTarget.id
        })
      ).toBe(true)
      const activated = table.getById('challenger')!
      expect(activated.decision_revision).toBe(challenger.decision_revision + 1)
      expect(
        table.archiveResolvedConflictTarget({
          agentId: 'a',
          id: challengedTarget.id,
          expectedRevision: challengedTarget.decision_revision,
          challengerId: activated.id
        })
      ).toBe(true)
      expect(table.getById('target')).toMatchObject({
        lifecycle_state: 'archived',
        superseded_by: 'challenger',
        conflict_state: null,
        decision_revision: challengedTarget.decision_revision + 1
      })
    } finally {
      db.close()
    }
  })

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

  it('rejects invalid canonical insert states before they reach SQLite', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      expect(() =>
        table.insert({
          id: 'ready-user',
          agentId: 'a',
          kind: 'semantic',
          content: 'ready user',
          lifecycleState: 'active',
          embeddingState: 'ready'
        })
      ).toThrow(/Invalid memory insert state/)
      expect(() =>
        table.insert({
          id: 'orphan-challenger',
          agentId: 'a',
          kind: 'semantic',
          content: 'orphan challenger',
          lifecycleState: 'conflicted',
          embeddingState: 'pending'
        })
      ).toThrow(/Invalid memory insert state/)
      expect(() =>
        table.insert({
          id: 'pending-persona',
          agentId: 'a',
          kind: 'persona',
          content: 'pending persona',
          lifecycleState: 'active',
          embeddingState: 'pending'
        })
      ).toThrow(/Invalid memory insert state/)
      expect(
        table.insert({
          id: 'challenger',
          agentId: 'a',
          kind: 'semantic',
          content: 'challenger',
          lifecycleState: 'conflicted',
          embeddingState: 'pending',
          conflictWith: 'target'
        })
      ).toMatchObject({ lifecycle_state: 'conflicted', embedding_state: 'pending' })
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

  it('repairs legacy status shadow from canonical state idempotently and by agent', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({
        id: 'a-ready',
        agentId: 'a',
        kind: 'semantic',
        content: 'ready'
      })
      seedTestCanonicalState(db, 'a-ready', 'active', 'ready')
      table.insert({
        id: 'b-archived',
        agentId: 'b',
        kind: 'semantic',
        content: 'archived'
      })
      seedTestCanonicalState(db, 'b-archived', 'archived', 'pending')
      db.exec('DROP TRIGGER agent_memory_legacy_status_bridge_au')
      db.exec("UPDATE agent_memory SET status = 'error'")

      expect(table.countLegacyShadowMismatches()).toBe(2)
      expect(table.countLegacyShadowMismatches('a')).toBe(1)
      expect(repairTestLegacyShadow(db, 'a')).toBe(1)
      expect(repairTestLegacyShadow(db, 'a')).toBe(0)
      expect(table.countLegacyShadowMismatches()).toBe(1)
      expect(repairTestLegacyShadow(db)).toBe(1)
      expect(table.countLegacyShadowMismatches()).toBe(0)
      expect(db.prepare('SELECT id, status FROM agent_memory ORDER BY id').all()).toEqual([
        { id: 'a-ready', status: 'embedded' },
        { id: 'b-archived', status: 'archived' }
      ])
    } finally {
      db.close()
    }
  })

  it('keeps every canonical state readable through a legacy-only downgrade projection', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const lifecycles = ['active', 'archived', 'conflicted'] as const
      const embeddings = ['pending', 'ready', 'error', 'fts_only', 'not_applicable'] as const
      const expected = new Map<string, string>()
      for (const lifecycleState of lifecycles) {
        for (const embeddingState of embeddings) {
          const id = `${lifecycleState}-${embeddingState}`
          table.insert({
            id,
            agentId: 'a',
            kind: embeddingState === 'not_applicable' ? 'persona' : 'semantic',
            content: id
          })
          seedTestCanonicalState(db, id, lifecycleState, embeddingState)
          expected.set(
            id,
            lifecycleState === 'archived'
              ? 'archived'
              : lifecycleState === 'conflicted'
                ? 'conflicted'
                : embeddingState === 'ready'
                  ? 'embedded'
                  : embeddingState === 'error'
                    ? 'error'
                    : embeddingState === 'fts_only' || embeddingState === 'not_applicable'
                      ? 'fts_only'
                      : 'pending_embedding'
          )
        }
      }

      const legacyRows = db.prepare('SELECT id, status FROM agent_memory').all() as Array<{
        id: string
        status: string
      }>
      expect(new Map(legacyRows.map((row) => [row.id, row.status]))).toEqual(expected)
    } finally {
      db.close()
    }
  })

  it('bridges v41 status-only inserts and updates without double-bumping revisions', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const insertLegacy = db.prepare(
        `INSERT INTO agent_memory (
           id, agent_id, kind, content, status,
           embedding_id, embedding_dim, embedding_model, created_at
         ) VALUES (?, 'a', ?, ?, ?, ?, ?, ?, ?)`
      )
      const cases = [
        ['pending', 'semantic', 'pending_embedding', null, null, null, 'active', 'pending'],
        ['ready', 'semantic', 'embedded', 'ready-vector', 4, 'p:m', 'active', 'ready'],
        ['error', 'semantic', 'error', null, null, null, 'active', 'error'],
        ['fts', 'semantic', 'fts_only', null, null, null, 'active', 'fts_only'],
        ['archived', 'semantic', 'archived', 'archive-vector', 4, 'p:m', 'archived', 'ready'],
        ['conflicted', 'semantic', 'conflicted', null, null, null, 'conflicted', 'pending'],
        ['persona', 'persona', 'embedded', 'persona-vector', 4, 'p:m', 'active', 'not_applicable']
      ] as const
      cases.forEach(([id, kind, status, embeddingId, embeddingDim, embeddingModel], index) => {
        insertLegacy.run(id, kind, id, status, embeddingId, embeddingDim, embeddingModel, index + 1)
      })
      expect(
        db
          .prepare(
            `SELECT id, status, lifecycle_state, embedding_state
             FROM agent_memory ORDER BY created_at`
          )
          .all()
      ).toEqual(
        cases.map(([id, kind, status, , , , lifecycleState, embeddingState]) => ({
          id,
          status: kind === 'persona' ? 'fts_only' : status,
          lifecycle_state: lifecycleState,
          embedding_state: embeddingState
        }))
      )

      const readyBefore = table.getById('ready')!
      db.prepare(
        `UPDATE agent_memory
         SET status = 'archived', decision_revision = decision_revision + 1
         WHERE id = 'ready'`
      ).run()
      const archived = table.getById('ready')!
      expect(archived).toMatchObject({
        lifecycle_state: 'archived',
        embedding_state: 'ready',
        embedding_id: 'ready-vector',
        decision_revision: readyBefore.decision_revision + 1
      })
      db.prepare(
        `UPDATE agent_memory
         SET status = 'pending_embedding',
             embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
             decision_revision = decision_revision + 1
         WHERE id = 'ready'`
      ).run()
      expect(table.getById('ready')).toMatchObject({
        lifecycle_state: 'active',
        embedding_state: 'pending',
        embedding_id: null,
        decision_revision: readyBefore.decision_revision + 2
      })

      const revision = table.getById('error')!.decision_revision
      db.prepare(
        `UPDATE agent_memory
         SET lifecycle_state = 'active', embedding_state = 'ready', status = 'embedded'
         WHERE id = 'error'`
      ).run()
      expect(table.getById('error')).toMatchObject({
        status: 'embedded',
        lifecycle_state: 'active',
        embedding_state: 'ready',
        decision_revision: revision
      })

      insertLegacy.run(
        'archived-persona',
        'persona',
        'archived persona',
        'archived',
        null,
        null,
        null,
        20
      )
      db.prepare("UPDATE agent_memory SET status = 'fts_only' WHERE id = 'archived-persona'").run()
      expect(table.getById('archived-persona')).toMatchObject({
        lifecycle_state: 'archived',
        embedding_state: 'not_applicable',
        status: 'archived'
      })

      insertLegacy.run(
        'active-working',
        'working',
        'active working',
        'embedded',
        'stale-working-vector',
        4,
        'p:m',
        21
      )
      expect(table.getById('active-working')).toMatchObject({
        lifecycle_state: 'active',
        embedding_state: 'not_applicable',
        status: 'fts_only'
      })
      expect(() =>
        db.exec("UPDATE agent_memory SET status = 'invalid' WHERE id = 'pending'")
      ).toThrow(/invalid legacy agent_memory status/)
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

  it('lists memories by ids for one agent without lifecycle status filtering', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()

      table.insert({ id: 'active', agentId: 'a', kind: 'semantic', content: 'active' })
      table.insert({ id: 'archived', agentId: 'a', kind: 'semantic', content: 'archived' })
      table.insert({ id: 'superseded', agentId: 'a', kind: 'semantic', content: 'superseded' })
      table.insert({ id: 'other-agent', agentId: 'b', kind: 'semantic', content: 'other' })
      archiveTestMemory(table, 'archived')
      seedTestSupersession(db, 'superseded', 'active')

      expect(table.listByIds('a', [])).toEqual([])

      const rows = table.listByIds('a', [
        'superseded',
        'missing',
        'archived',
        'other-agent',
        'active',
        'active'
      ])
      const ids = rows.map((row) => row.id).sort()
      const rowsById = new Map<string, (typeof rows)[number]>(rows.map((row) => [row.id, row]))

      expect(ids).toEqual(['active', 'archived', 'superseded'])
      expect(rowsById.get('archived')?.status).toBe('archived')
      expect(rowsById.get('superseded')?.superseded_by).toBe('active')
      expect(rowsById.has('other-agent')).toBe(false)
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
      archiveTestMemory(table, 'archived-1')

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
      seedTestSupersession(db, v1.id, v2.id)

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

      setTestMemoryStatus(db, table, 'm1', 'embedded', { embeddingId: 'vec-1', embeddingDim: 1536 })
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
      setTestMemoryStatus(db, table, 'current', 'embedded', {
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
      setTestMemoryStatus(db, table, 'wrong-dim', 'embedded', {
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
      setTestMemoryStatus(db, table, 'persona', 'embedded', {
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
      setTestMemoryStatus(db, table, 'working', 'embedded', {
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
      setTestMemoryStatus(db, table, 'superseded', 'embedded', {
        embeddingId: 'superseded',
        embeddingDim: 8,
        embeddingModel: 'legacy:model'
      })
      seedTestSupersession(db, superseded.id, 'current')
      table.insert({
        id: 'persona-only',
        agentId: 'excluded-agent',
        kind: 'persona',
        content: 'persona'
      })
      setTestMemoryStatus(db, table, 'persona-only', 'embedded', {
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
      setTestMemoryStatus(db, table, 'working-only', 'embedded', {
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
      setTestMemoryStatus(db, table, 'excluded-superseded', 'embedded', {
        embeddingId: 'excluded-superseded',
        embeddingDim: 8,
        embeddingModel: 'legacy:model'
      })
      seedTestSupersession(db, excludedSuperseded.id, 'persona-only')

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
      seedTestConflictState(db, 'c1', 'challenged')
      const superseded = table.insert({
        id: 'old',
        agentId: 'a',
        kind: 'semantic',
        category: 'task_outcome',
        content: 'old',
        importance: 0.8,
        status: 'embedded'
      })
      seedTestSupersession(db, superseded.id, 's1')
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
      seedTestConflictState(db, 'challenged-active', 'challenged')
      seedTestConflictState(db, superseded.id, 'challenged')
      seedTestSupersession(db, superseded.id, 'challenged-active')

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
      setTestMemoryStatus(db, table, 'same-time-old', 'embedded', {
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
      setTestMemoryStatus(db, table, 'same-time-current', 'embedded', {
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
      seedTestSupersession(db, old.id, fresh.id)

      const results = table.search('deepchat', 'redis')
      expect(results).toHaveLength(1)
      expect(results[0]?.id).toBe('m2')
    } finally {
      db.close()
    }
  })

  it('supports OR keyword matching only when requested', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      if (ftsActive(db)) {
        expect(
          db
            .prepare(
              `SELECT schema_version, policy_version
               FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'`
            )
            .get()
        ).toMatchObject({ schema_version: 4, policy_version: 3 })
      }
      table.insert({
        id: 'm1',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'redis setup'
      })

      expect(table.search('deepchat', 'please redis setup').map((row) => row.id)).toEqual([])
      expect(
        table
          .search('deepchat', 'please redis setup', 20, { matchMode: 'any' })
          .map((row) => row.id)
      ).toEqual(['m1'])
    } finally {
      db.close()
    }
  })

  it('updates access counters in batch', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'm1', agentId: 'deepchat', kind: 'semantic', content: 'a' })
      table.insert({ id: 'm2', agentId: 'deepchat', kind: 'semantic', content: 'b' })

      table.recordAccessBatch(['m1', 'm2', 'm1'], 1234)

      expect(table.getById('m1')?.access_count).toBe(1)
      expect(table.getById('m2')?.access_count).toBe(1)
      expect(table.getById('m1')?.last_accessed).toBe(1234)
      expect(table.getById('m2')?.last_accessed).toBe(1234)
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

  it('orders agent and global pending queues deterministically for equal timestamps', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      for (const id of ['c', 'a', 'b']) {
        table.insert({
          id,
          agentId: 'agent-a',
          kind: 'semantic',
          content: id,
          createdAt: 1000
        })
      }

      expect(table.listPendingEmbedding(50, 'agent-a').map((row) => row.id)).toEqual([
        'a',
        'b',
        'c'
      ])
      expect(table.listPendingEmbedding(50).map((row) => row.id)).toEqual(['a', 'b', 'c'])
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

  it('listWorkingCandidates pages by the stable working-blob ordering cursor', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({
        id: 'm1',
        agentId: 'a',
        kind: 'semantic',
        content: 'first',
        importance: 0.4,
        createdAt: 1000
      })
      table.insert({
        id: 'm2',
        agentId: 'a',
        kind: 'episodic',
        content: 'second',
        importance: 0.8,
        createdAt: 2000
      })
      table.insert({
        id: 'm3',
        agentId: 'a',
        kind: 'semantic',
        content: 'third',
        importance: 0.9,
        createdAt: 3000
      })
      table.insert({
        id: 'm4',
        agentId: 'a',
        kind: 'semantic',
        content: 'fourth',
        importance: 0.9,
        createdAt: 4000
      })
      table.recordAccess('m3', 5000)
      table.recordAccess('m4', 5000)
      table.recordAccess('m4', 6000)
      const archived = table.insert({
        id: 'archived',
        agentId: 'a',
        kind: 'semantic',
        content: 'archived',
        importance: 1,
        createdAt: 9000
      })
      archiveTestMemory(table, archived.id)
      table.insert({ id: 'working', agentId: 'a', kind: 'working', content: 'working' })
      const superseded = table.insert({
        id: 'superseded',
        agentId: 'a',
        kind: 'semantic',
        content: 'superseded',
        importance: 1,
        createdAt: 8000
      })
      seedTestSupersession(db, superseded.id, 'm4')

      const firstPage = table.listWorkingCandidates('a', 2)
      expect(firstPage.map((row) => row.id)).toEqual(['m4', 'm3'])
      const cursorRow = firstPage[1]
      const secondPage = table.listWorkingCandidates('a', 2, {
        importance: cursorRow.importance,
        accessCount: cursorRow.access_count,
        createdAt: cursorRow.created_at,
        id: cursorRow.id
      })
      expect(secondPage.map((row) => row.id)).toEqual(['m2', 'm1'])
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
      archiveTestMemory(table, 'archived')
      table.insert({
        id: 'conflicted',
        agentId: 'a',
        kind: 'semantic',
        content: 'conflicted',
        createdAt
      })
      setTestMemoryStatus(db, table, 'conflicted', 'conflicted')
      table.insert({
        id: 'superseded',
        agentId: 'a',
        kind: 'semantic',
        content: 'superseded',
        createdAt
      })
      seedTestSupersession(db, 'superseded', 'eligible-null')
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
      expect(rows.map((row) => row.id).sort()).toEqual([
        'accessed',
        'eligible-null',
        'eligible-stored'
      ])
      expect(rows.find((row) => row.id === 'accessed')?.access_count).toBe(1)
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
  it('keeps the JS recall policy, SQL predicate, and registered scope encoder in parity', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const fixtures = [
        { id: 'live', kind: 'semantic', status: 'embedded', superseded_by: null },
        { id: 'archived', kind: 'semantic', status: 'archived', superseded_by: null },
        { id: 'conflicted', kind: 'semantic', status: 'conflicted', superseded_by: null },
        { id: 'persona', kind: 'persona', status: 'fts_only', superseded_by: null },
        { id: 'working', kind: 'working', status: 'fts_only', superseded_by: null },
        { id: 'superseded', kind: 'semantic', status: 'embedded', superseded_by: 'live' }
      ].map((fixture) => ({
        ...fixture,
        lifecycle_state:
          fixture.status === 'archived'
            ? 'archived'
            : fixture.status === 'conflicted'
              ? 'conflicted'
              : 'active',
        embedding_state:
          fixture.kind === 'persona' || fixture.kind === 'working'
            ? 'not_applicable'
            : fixture.status === 'embedded'
              ? 'ready'
              : 'pending'
      }))
      const insert = db.prepare(
        `INSERT INTO agent_memory (id, agent_id, kind, content, status, superseded_by, created_at)
         VALUES (?, 'a', ?, ?, ?, ?, 1)`
      )
      for (const fixture of fixtures) {
        insert.run(fixture.id, fixture.kind, fixture.id, fixture.status, fixture.superseded_by)
      }
      db.exec(`
        UPDATE agent_memory
        SET lifecycle_state = CASE status
          WHEN 'archived' THEN 'archived'
          WHEN 'conflicted' THEN 'conflicted'
          ELSE 'active'
        END,
        embedding_state = CASE
          WHEN kind IN ('persona', 'working') THEN 'not_applicable'
          WHEN status = 'embedded' THEN 'ready'
          ELSE 'pending'
        END;
      `)

      const sqlIds = (
        db
          .prepare(`SELECT id FROM agent_memory WHERE ${buildRecallablePredicate!()}`)
          .all() as Array<{
          id: string
        }>
      ).map((row) => row.id)
      const jsIds = fixtures
        .filter((row) => isRecallableFtsRow!({ ...row, agent_id: 'a' }))
        .map((row) => row.id)
      const sqlScope = db
        .prepare('SELECT agent_memory_fts_scope(?) AS scope')
        .get('agent/with unicode/记忆') as { scope: string }

      expect(sqlIds).toEqual(jsIds)
      expect(sqlScope.scope).toBe(agentFtsScope!('agent/with unicode/记忆'))
    } finally {
      db.close()
    }
  })

  it('keeps unicode61 in permanent LIKE-only mode without mirror writes', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      ;(
        table as unknown as { ftsCapability: { available: boolean; tokenizer: string } }
      ).ftsCapability = { available: true, tokenizer: 'unicode61' }
      table.createTable()

      table.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis memory' })
      setTestMemoryStatus(db, table, 'm1', 'archived')
      setTestMemoryStatus(db, table, 'm1', 'pending_embedding')

      expect(ftsActive(db)).toBe(false)
      expect(table.searchWithStrategy('a', 'redis').strategy).toBe('like-fallback')
      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(['m1'])
    } finally {
      db.close()
    }
  })

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
      expect(createSql).toContain('decision_revision INTEGER NOT NULL DEFAULT 1')
      expect(table.getLatestVersion()).toBe(42)
      expect(table.getMigrationSQL(32)).toMatch(/ADD COLUMN embedding_model/)
      expect(table.getMigrationSQL(33)).toMatch(/ADD COLUMN confidence/)
      expect(table.getMigrationSQL(34)).toMatch(/ADD COLUMN persona_state/)
      expect(table.getMigrationSQL(35)).toMatch(/ADD COLUMN conflict_with/)
      expect(table.getMigrationSQL(37)).toMatch(/ADD COLUMN category/)
      expect(table.getMigrationSQL(41)).toMatch(/ADD COLUMN decision_revision/)
      expect(table.getMigrationSQL(31)).toBeNull()

      table.createTable()
      const columns = (
        db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(columns).toContain('embedding_model')
      expect(columns).toContain('persona_state')
      expect(columns).toContain('conflict_with')
      expect(columns).toContain('category')
      expect(columns).toContain('decision_revision')
    } finally {
      db.close()
    }
  })

  it('uses trigram FTS for safe terms and LIKE for short terms', () => {
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

      const likeSpy = vi.spyOn(table as unknown as AgentMemorySearchInternals, 'searchLike')
      expect(table.search('a', 'redis').map((row) => row.id)).toContain('redis')
      const meta = db
        .prepare("SELECT tokenizer FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'")
        .get() as { tokenizer?: string } | undefined
      if (ftsActive(db) && meta?.tokenizer === 'trigram') {
        expect(likeSpy).not.toHaveBeenCalled()
      } else {
        expect(likeSpy).toHaveBeenCalledTimes(1)
      }
      // >=3 char CJK fragment: trigram FTS when available, otherwise the LIKE substring fallback.
      expect(table.search('a', '中文回答').map((row) => row.id)).toContain('cn')
      // 2 char CJK word is below trigram's window; the LIKE fallback still recalls it.
      expect(table.search('a', '中文').map((row) => row.id)).toContain('cn')
      expect(likeSpy).toHaveBeenCalledTimes(meta?.tokenizer === 'trigram' ? 1 : 3)
    } finally {
      db.close()
    }
  })

  it('keeps the recallable-only FTS index in sync across lifecycle transitions', () => {
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
      seedTestSupersession(db, 'a2', a3.id)
      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(['a3'])

      setTestMemoryStatus(db, table, 'a3', 'archived')
      expect(table.search('a', 'redis')).toEqual([])
      setTestMemoryStatus(db, table, 'a3', 'pending_embedding')
      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(['a3'])

      table.insert({
        id: 'persona',
        agentId: 'a',
        kind: 'persona',
        content: 'redis persona'
      })
      table.insert({
        id: 'conflicted',
        agentId: 'a',
        kind: 'semantic',
        content: 'redis conflict',
        status: 'conflicted'
      })
      table.insert({
        id: 'other-agent',
        agentId: 'b',
        kind: 'semantic',
        content: 'redis remains searchable'
      })
      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(['a3'])

      table.clearByAgent('a')
      expect(table.search('a', 'redis')).toHaveLength(0)
      const otherAgent = table.searchWithStrategy('b', 'redis')
      expect(otherAgent.rows.map((row) => row.id)).toEqual(['other-agent'])
      const tokenizer = (
        db
          .prepare("SELECT tokenizer FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'")
          .get() as { tokenizer?: string } | undefined
      )?.tokenizer
      expect(otherAgent.strategy).toBe(tokenizer === 'trigram' ? 'fts-only' : 'like-fallback')
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

  it('keeps authoritative writes available when the runtime FTS table disappears', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      if (!ftsActive(db)) return
      table.insert({ id: 'before', agentId: 'a', kind: 'semantic', content: 'redis before' })
      db.exec('DROP TABLE agent_memory_fts;')

      expect(() =>
        table.insert({ id: 'after', agentId: 'a', kind: 'semantic', content: 'redis after' })
      ).not.toThrow()
      expect(table.getById('after')?.content).toBe('redis after')
      const dirtyMeta = db
        .prepare(
          `SELECT mutation_generation, indexed_generation
           FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'`
        )
        .get() as { mutation_generation: number; indexed_generation: number }
      expect(dirtyMeta.mutation_generation).toBeGreaterThan(dirtyMeta.indexed_generation)
      expect(
        table
          .search('a', 'redis')
          .map((row) => row.id)
          .sort()
      ).toEqual(['after', 'before'])

      const recoveredMeta = db
        .prepare(
          `SELECT mutation_generation, indexed_generation
           FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'`
        )
        .get() as { mutation_generation: number; indexed_generation: number }
      expect(recoveredMeta.mutation_generation).toBe(recoveredMeta.indexed_generation)
    } finally {
      db.close()
    }
  })

  it('drops a partial FTS build and fails open to one bounded LIKE query', () => {
    const db = new DatabaseCtor(':memory:')
    vi.stubEnv('DEEPCHAT_REQUIRE_NATIVE_SQLITE', '0')
    try {
      const originalExec = db.exec.bind(db)
      vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
        if (sql.includes('CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts')) {
          throw new Error('simulated FTS build failure')
        }
        return originalExec(sql)
      })
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'm1', agentId: 'a', kind: 'semantic', content: 'redis fallback' })
      const likeSpy = vi.spyOn(table as unknown as AgentMemorySearchInternals, 'searchLike')

      expect(table.search('a', 'redis').map((row) => row.id)).toEqual(['m1'])
      expect(likeSpy).toHaveBeenCalledTimes(1)
      expect(ftsActive(db)).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      db.close()
    }
  })

  it('fails hard on an FTS build failure during strict native validation', () => {
    const db = new DatabaseCtor(':memory:')
    vi.stubEnv('DEEPCHAT_REQUIRE_NATIVE_SQLITE', '1')
    try {
      const originalExec = db.exec.bind(db)
      vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
        if (sql.includes('CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts')) {
          throw new Error('simulated FTS build failure')
        }
        return originalExec(sql)
      })
      const table = new AgentMemoryTableCtor(db)

      expect(() => table.createTable()).toThrow('simulated FTS build failure')
      expect(ftsActive(db)).toBe(false)
    } finally {
      vi.unstubAllEnvs()
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

  it('supplements BM25 with same-MATCH importance ranking without LIKE', () => {
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

      const likeSpy = vi.spyOn(table as unknown as AgentMemorySearchInternals, 'searchLike')
      // limit=2 lets BM25 fill the lexical cap; the second FTS query supplies importance candidates.
      const ids = table.search('a', 'redis', 2).map((row) => row.id)
      expect(ids).toContain('hi1')
      expect(ids).toContain('hi2')
      if (ftsActive(db)) {
        expect(ids.length).toBeGreaterThan(2)
        const meta = db
          .prepare("SELECT tokenizer FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'")
          .get() as { tokenizer?: string } | undefined
        if (meta?.tokenizer === 'trigram') expect(likeSpy).not.toHaveBeenCalled()
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
      setTestMemoryStatus(db, table, 'emb', 'embedded', {
        embeddingId: 'v',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      table.insert({ id: 'fts', agentId: 'a', kind: 'semantic', content: 'redis fts only' })
      setTestMemoryStatus(db, table, 'fts', 'fts_only')
      const sup = table.insert({ id: 'sup', agentId: 'a', kind: 'semantic', content: 'redis old' })
      setTestMemoryStatus(db, table, 'sup', 'embedded', {
        embeddingId: 'v2',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      seedTestSupersession(db, sup.id, 'emb')
      // persona is the self-model; it must never be pulled into the vector store.
      table.insert({ id: 'persona', agentId: 'a', kind: 'persona', content: 'redis persona' })
      setTestMemoryStatus(db, table, 'persona', 'fts_only')

      const changed = table.requeueForEmbedding('a', ['ready', 'error', 'fts_only'])
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

  it('requeueForEmbedding supports a bounded id cursor for fair error retry', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      for (const id of ['err-01', 'err-02', 'err-03']) {
        table.insert({ id, agentId: 'a', kind: 'semantic', content: id, status: 'error' })
      }

      expect(table.listEmbeddingStateIds('a', ['error'], 2, 'err-01')).toEqual(['err-02', 'err-03'])
      expect(table.requeueForEmbedding('a', ['error'], 1, 'err-01')).toBe(1)

      expect(table.getById('err-01')?.status).toBe('error')
      expect(table.getById('err-02')?.status).toBe('pending_embedding')
      expect(table.getById('err-03')?.status).toBe('error')
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
      setTestMemoryStatus(db, table, 'persona', 'pending_embedding')

      expect(table.listPendingEmbedding(50, 'a').map((row) => row.id)).toEqual(['mem'])
      expect(table.listPendingEmbedding(50).map((row) => row.id)).toEqual(['mem'])
    } finally {
      db.close()
    }
  })

  it('search excludes persona rows before applying the SQL limit', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      for (let index = 0; index < 10; index += 1) {
        table.insert({
          id: `persona-${index}`,
          agentId: 'a',
          kind: 'persona',
          content: `redis persona ${index}`,
          status: 'fts_only',
          createdAt: 100 + index
        })
      }
      for (let index = 0; index < 2; index += 1) {
        table.insert({
          id: `mem-${index}`,
          agentId: 'a',
          kind: 'semantic',
          content: `redis memory ${index}`,
          status: 'fts_only',
          createdAt: index
        })
      }

      const ids = table.search('a', 'redis', 2).map((row) => row.id)
      expect(ids).toHaveLength(2)
      expect(new Set(ids)).toEqual(new Set(['mem-0', 'mem-1']))
    } finally {
      db.close()
    }
  })

  it('repairs persona and working rows back to fts_only without clearing embedding refs', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'persona', agentId: 'a', kind: 'persona', content: 'self model' })
      setTestMemoryStatus(db, table, 'persona', 'pending_embedding', {
        embeddingId: 'persona',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      table.insert({ id: 'work', agentId: 'a', kind: 'working', content: 'working blob' })
      setTestMemoryStatus(db, table, 'work', 'embedded', {
        embeddingId: 'work',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      table.insert({ id: 'mem', agentId: 'a', kind: 'semantic', content: 'redis memory' })
      setTestMemoryStatus(db, table, 'mem', 'pending_embedding')

      expect(table.repairInternalKindStatuses('a')).toBe(2)
      expect(table.getById('persona')).toMatchObject({
        status: 'fts_only',
        embedding_id: 'persona',
        embedding_dim: 3,
        embedding_model: 'p:m'
      })
      expect(table.getById('work')).toMatchObject({
        status: 'fts_only',
        embedding_id: 'work',
        embedding_dim: 3,
        embedding_model: 'p:m'
      })
      expect(table.getById('mem')?.status).toBe('pending_embedding')
      expect(table.repairInternalKindStatuses('a')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('lists prunable vector refs and clears embedding refs without changing lifecycle state', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({
        id: 'active',
        agentId: 'a',
        kind: 'semantic',
        content: 'active',
        createdAt: 1
      })
      setTestMemoryStatus(db, table, 'active', 'embedded', {
        embeddingId: 'active',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      table.insert({
        id: 'persona',
        agentId: 'a',
        kind: 'persona',
        content: 'self',
        status: 'fts_only',
        createdAt: 2
      })
      setTestMemoryStatus(db, table, 'persona', 'fts_only', {
        embeddingId: 'persona',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      table.insert({
        id: 'work',
        agentId: 'a',
        kind: 'working',
        content: 'working',
        status: 'fts_only',
        createdAt: 3
      })
      setTestMemoryStatus(db, table, 'work', 'fts_only', {
        embeddingId: 'work',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      table.insert({
        id: 'archived',
        agentId: 'a',
        kind: 'semantic',
        content: 'archived',
        createdAt: 4
      })
      setTestMemoryStatus(db, table, 'archived', 'embedded', {
        embeddingId: 'archived',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      archiveTestMemory(table, 'archived')
      table.insert({
        id: 'superseded',
        agentId: 'a',
        kind: 'semantic',
        content: 'superseded',
        createdAt: 5
      })
      setTestMemoryStatus(db, table, 'superseded', 'embedded', {
        embeddingId: 'superseded',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      seedTestSupersession(db, 'superseded', 'active')

      expect(table.listPrunableVectorRefs('a', { limit: 10 })).toEqual([
        { id: 'persona', embeddingDim: 3, embeddingModel: 'p:m' },
        { id: 'work', embeddingDim: 3, embeddingModel: 'p:m' },
        { id: 'archived', embeddingDim: 3, embeddingModel: 'p:m' },
        { id: 'superseded', embeddingDim: 3, embeddingModel: 'p:m' }
      ])
      expect(
        table.filterPrunableVectorRefs('a', ['active', 'archived', 'superseded'], 3, 'p:m')
      ).toEqual(['archived', 'superseded'])
      expect(table.filterPrunableVectorRefs('a', ['missing-row'], 3, 'p:m')).toEqual([
        'missing-row'
      ])
      expect(
        table.clearPrunableEmbeddingRefs('a', ['active', 'archived', 'superseded'], 3, 'p:m')
      ).toBe(2)
      expect(table.getById('archived')).toMatchObject({
        status: 'archived',
        embedding_id: null,
        embedding_dim: null,
        embedding_model: null
      })
      expect(table.getById('superseded')).toMatchObject({
        superseded_by: 'active',
        status: 'embedded',
        embedding_id: null,
        embedding_dim: null,
        embedding_model: null
      })
      expect(table.getById('active')?.embedding_id).toBe('active')
    } finally {
      db.close()
    }
  })

  it('filters prunable vector refs by embedding model before applying the limit', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      for (let index = 0; index < 260; index += 1) {
        const id = `old-${index}`
        table.insert({
          id,
          agentId: 'a',
          kind: 'semantic',
          content: `old archived ${index}`,
          createdAt: index
        })
        setTestMemoryStatus(db, table, id, 'embedded', {
          embeddingId: id,
          embeddingDim: 3,
          embeddingModel: 'old:model'
        })
        archiveTestMemory(table, id)
      }
      for (let index = 0; index < 2; index += 1) {
        const id = `current-${index}`
        table.insert({
          id,
          agentId: 'a',
          kind: 'semantic',
          content: `current archived ${index}`,
          createdAt: 1000 + index
        })
        setTestMemoryStatus(db, table, id, 'embedded', {
          embeddingId: id,
          embeddingDim: 3,
          embeddingModel: 'p:m'
        })
        archiveTestMemory(table, id)
      }

      expect(
        table.listPrunableVectorRefs('a', { limit: 2, embeddingModel: 'p:m' }).map((ref) => ref.id)
      ).toEqual(['current-0', 'current-1'])
    } finally {
      db.close()
    }
  })

  it('filters prunable vector refs by embedding dim before applying the limit', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      for (let index = 0; index < 260; index += 1) {
        const id = `old-dim-${index}`
        table.insert({
          id,
          agentId: 'a',
          kind: 'semantic',
          content: `old dim archived ${index}`,
          createdAt: index
        })
        setTestMemoryStatus(db, table, id, 'embedded', {
          embeddingId: id,
          embeddingDim: 8,
          embeddingModel: 'p:m'
        })
        archiveTestMemory(table, id)
      }
      for (let index = 0; index < 2; index += 1) {
        const id = `current-dim-${index}`
        table.insert({
          id,
          agentId: 'a',
          kind: 'semantic',
          content: `current dim archived ${index}`,
          createdAt: 1000 + index
        })
        setTestMemoryStatus(db, table, id, 'embedded', {
          embeddingId: id,
          embeddingDim: 4,
          embeddingModel: 'p:m'
        })
        archiveTestMemory(table, id)
      }

      expect(
        table
          .listPrunableVectorRefs('a', { limit: 2, embeddingModel: 'p:m', embeddingDim: 4 })
          .map((ref) => ref.id)
      ).toEqual(['current-dim-0', 'current-dim-1'])
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
      dropV42CanonicalArtifacts(db)
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
      dropV42CanonicalArtifacts(db)
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_fairness')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_archive_eligible')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_fairness_v2')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_archive_eligible_v2')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_state_anomaly_v2')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_lifecycle_maintenance')
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
      table.assertCurrentSchema()
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_memory_archive_eligible_v2'"
          )
          .get()
      ).toBeUndefined()
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

  it('v41 migration adds decision revision with a stable legacy default', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      db.exec('ALTER TABLE agent_memory DROP COLUMN decision_revision')
      db.prepare(
        'INSERT INTO agent_memory (id, agent_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('legacy-revision', 'a', 'semantic', 'legacy fact', 1000)

      db.exec(table.getMigrationSQL(41) ?? '')

      expect(table.getById('legacy-revision')?.decision_revision).toBe(1)
      expect(() => db.exec(table.getMigrationSQL(41) ?? '')).toThrow(/duplicate column name/i)
    } finally {
      db.close()
    }
  })

  it('bumps decision revision only for semantic mutations', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({ id: 'revisioned', agentId: 'a', kind: 'semantic', content: 'fact' })

      table.recordAccess('revisioned', 100)
      table.updateDecayScore('revisioned', 0.8, 100)
      setTestMemoryStatus(db, table, 'revisioned', 'embedded', {
        embeddingId: 'revisioned',
        embeddingDim: 3,
        embeddingModel: 'p:m'
      })
      expect(table.getById('revisioned')?.decision_revision).toBe(1)

      seedTestContentUpdate(db, 'revisioned', 'refined fact', 'key', 200)
      const contentRevision = table.getById('revisioned')!.decision_revision
      expect(
        table.updateUserMetadataIfRevision({
          agentId: 'a',
          id: 'revisioned',
          expectedRevision: contentRevision,
          importance: 0.9
        })
      ).toBe(true)
      table.setAnchor('revisioned', true)
      expect(table.getById('revisioned')?.decision_revision).toBe(4)
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
      seedTestSupersession(db, superseded.id, 'legacy-active')
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

      archiveTestMemory(table, 'gone')
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

      seedTestContentUpdate(db, 'm1', 'new', 'new-key', 1234)
      expect(table.getById('m1')?.content).toBe('new')
      expect(table.getById('m1')?.provenance_key).toBe('new-key')
      expect(table.getById('m1')?.category).toBeNull()
      expect(table.getById('m1')?.last_consolidated_at).toBeNull()
      // A content rewrite re-anchors the forgetting clock so the row reads as freshly touched.
      expect(table.getById('m1')?.last_accessed).toBe(1234)
      seedTestContentUpdate(db, 'm1', 'newer', 'newer-key', 1235, 'project_fact')
      expect(table.getById('m1')?.category).toBe('project_fact')

      table.setConfidence('m1', 0.8)
      expect(table.getById('m1')?.confidence).toBe(0.8)
      table.setConfidence('m1', 0.6)
      expect(table.getById('m1')?.confidence).toBe(0.8)

      let revision = table.getById('m1')!.decision_revision
      expect(
        table.updateUserMetadataIfRevision({
          agentId: 'a',
          id: 'm1',
          expectedRevision: revision,
          importance: 0.4
        })
      ).toBe(true)
      expect(table.getById('m1')?.importance).toBe(0.4)
      revision = table.getById('m1')!.decision_revision
      expect(
        table.updateUserMetadataIfRevision({
          agentId: 'a',
          id: 'm1',
          expectedRevision: revision,
          importance: 0.2
        })
      ).toBe(true)
      expect(table.getById('m1')?.importance).toBe(0.2)

      seedTestConflictState(db, 'm1', 'challenged')
      expect(table.getById('m1')?.conflict_state).toBe('challenged')
      seedTestConflictState(db, 'm1', null)
      expect(table.getById('m1')?.conflict_state).toBe(null)
    } finally {
      db.close()
    }
  })

  it('guards unresolved conflict participants and excludes challenged targets from archive scans', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      table.insert({
        id: 'target',
        agentId: 'a',
        kind: 'semantic',
        content: 'target',
        createdAt: 1
      })
      table.insert({
        id: 'challenger',
        agentId: 'a',
        kind: 'semantic',
        content: 'challenger',
        status: 'conflicted',
        conflictWith: 'target',
        createdAt: 2
      })
      seedTestConflictState(db, 'target', 'challenged')
      table.updateDecayScore('target', 0.001)

      expect(table.isUnresolvedConflictParticipant('a', 'target')).toBe(true)
      expect(table.isUnresolvedConflictParticipant('a', 'challenger')).toBe(true)
      expect(table.isUnresolvedConflictParticipant('b', 'target')).toBe(false)
      expect(table.listConflictIntegrityRows('a').map((row) => row.id)).toEqual([
        'target',
        'challenger'
      ])
      expect(table.listArchiveCandidateLifecycleRows('a', 100, 10)).toEqual([])
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

  it('agent memory audit hasForgetEvent honors restore ordering', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      table.insert({
        id: 'forget-1',
        agentId: 'a',
        eventType: 'memory/forget',
        actorType: 'runtime',
        status: 'completed',
        inputRefs: { memoryId: 'm1' },
        outputRefs: { memoryId: 'm1' },
        createdAt: 100
      })
      expect(table.hasForgetEvent('a', 'm1')).toBe(true)

      table.insert({
        id: 'restore-1',
        agentId: 'a',
        eventType: 'memory/restore',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: 'm1' },
        outputRefs: { memoryId: 'm1' },
        createdAt: 200
      })
      expect(table.hasForgetEvent('a', 'm1')).toBe(false)

      table.insert({
        id: 'archive-1',
        agentId: 'a',
        eventType: 'memory/archive',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: 'm1' },
        outputRefs: { memoryId: 'm1' },
        createdAt: 300
      })
      expect(table.hasForgetEvent('a', 'm1')).toBe(true)

      table.insert({
        id: 'restore-failed',
        agentId: 'a',
        eventType: 'memory/restore',
        actorType: 'user',
        status: 'failed',
        inputRefs: { memoryId: 'm1' },
        outputRefs: { memoryId: 'm1' },
        createdAt: 400
      })
      expect(table.hasForgetEvent('a', 'm1')).toBe(true)
      expect(table.hasForgetEvent('a', 'other')).toBe(false)
    } finally {
      db.close()
    }
  })

  it('agent memory audit derives memory_ref_id and falls back for legacy rows', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      table.insert({
        id: 'forget-indexed',
        agentId: 'a',
        eventType: 'memory/forget',
        actorType: 'runtime',
        status: 'completed',
        inputRefs: { memoryId: 'm-indexed' },
        outputRefs: { memoryId: 'm-indexed' },
        createdAt: 100
      })
      expect(
        db
          .prepare('SELECT memory_ref_id FROM agent_memory_audit WHERE id = ?')
          .get('forget-indexed')
      ).toEqual({ memory_ref_id: 'm-indexed' })

      table.insert({
        id: 'forget-legacy',
        agentId: 'a',
        eventType: 'memory/forget',
        actorType: 'runtime',
        status: 'completed',
        inputRefs: { memoryId: 'm-legacy' },
        outputRefs: { memoryId: 'm-legacy' },
        createdAt: 200
      })
      db.prepare(
        "UPDATE agent_memory_audit SET memory_ref_id = NULL WHERE id = 'forget-legacy'"
      ).run()

      expect(table.hasForgetEvent('a', 'm-legacy')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('agent memory audit orders indexed and legacy memory refs together', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      table.insert({
        id: 'indexed-restore',
        agentId: 'a',
        eventType: 'memory/restore',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: 'm-mixed' },
        outputRefs: { memoryId: 'm-mixed' },
        createdAt: 100
      })
      table.insert({
        id: 'legacy-forget',
        agentId: 'a',
        eventType: 'memory/forget',
        actorType: 'runtime',
        status: 'completed',
        inputRefs: { memoryId: 'm-mixed' },
        outputRefs: { memoryId: 'm-mixed' },
        createdAt: 200
      })
      db.prepare(
        "UPDATE agent_memory_audit SET memory_ref_id = NULL WHERE id = 'legacy-forget'"
      ).run()
      expect(table.hasForgetEvent('a', 'm-mixed')).toBe(true)

      table.insert({
        id: 'legacy-restore',
        agentId: 'a',
        eventType: 'memory/restore',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: 'm-mixed' },
        outputRefs: { memoryId: 'm-mixed' },
        createdAt: 300
      })
      db.prepare(
        "UPDATE agent_memory_audit SET memory_ref_id = NULL WHERE id = 'legacy-restore'"
      ).run()
      expect(table.hasForgetEvent('a', 'm-mixed')).toBe(false)

      table.insert({
        id: 'indexed-archive',
        agentId: 'a',
        eventType: 'memory/archive',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: 'm-mixed' },
        outputRefs: { memoryId: 'm-mixed' },
        createdAt: 400
      })
      expect(table.hasForgetEvent('a', 'm-mixed')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('agent memory audit migration tolerates malformed refs while backfilling memory_ref_id', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      db.exec(`
        CREATE TABLE agent_memory_audit (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          session_id TEXT,
          input_refs_json TEXT NOT NULL DEFAULT '{}',
          output_refs_json TEXT NOT NULL DEFAULT '{}',
          model_provider_id TEXT,
          model_id TEXT,
          status TEXT NOT NULL,
          reason TEXT,
          created_at INTEGER NOT NULL
        );
      `)
      const insert = db.prepare(
        `INSERT INTO agent_memory_audit (
           id,
           agent_id,
           event_type,
           actor_type,
           input_refs_json,
           output_refs_json,
           status,
           created_at
         )
         VALUES (?, 'a', 'memory/forget', 'runtime', ?, ?, 'completed', ?)`
      )
      insert.run('valid-input', '{"memoryId":"m-input"}', 'not-json', 100)
      insert.run('malformed-only', 'not-json', 'also-not-json', 200)

      expect(() => db.exec(table.getMigrationSQL(38) ?? '')).not.toThrow()
      expect(
        db.prepare('SELECT memory_ref_id FROM agent_memory_audit WHERE id = ?').get('valid-input')
      ).toEqual({ memory_ref_id: 'm-input' })
      expect(
        db
          .prepare('SELECT memory_ref_id FROM agent_memory_audit WHERE id = ?')
          .get('malformed-only')
      ).toEqual({ memory_ref_id: null })
    } finally {
      db.close()
    }
  })

  it('agent memory audit hasForgetEvent does not miss older memory refs behind newer events', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      table.insert({
        id: 'old-forget',
        agentId: 'a',
        eventType: 'memory/forget',
        actorType: 'runtime',
        status: 'completed',
        inputRefs: { memoryId: 'm-old' },
        outputRefs: { memoryId: 'm-old' },
        createdAt: 1
      })
      for (let index = 0; index < 205; index += 1) {
        table.insert({
          id: `newer-other-${index}`,
          agentId: 'a',
          eventType: 'memory/restore',
          actorType: 'user',
          status: 'completed',
          inputRefs: { memoryId: `other-${index}` },
          outputRefs: { memoryId: `other-${index}` },
          createdAt: 1000 + index
        })
      }

      expect(table.hasForgetEvent('a', 'm-old')).toBe(true)

      table.insert({
        id: 'new-restore',
        agentId: 'a',
        eventType: 'memory/restore',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: 'm-old' },
        outputRefs: { memoryId: 'm-old' },
        createdAt: 2000
      })
      expect(table.hasForgetEvent('a', 'm-old')).toBe(false)

      table.insert({
        id: 'new-archive',
        agentId: 'a',
        eventType: 'memory/archive',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: 'm-old' },
        outputRefs: { memoryId: 'm-old' },
        createdAt: 2001
      })
      expect(table.hasForgetEvent('a', 'm-old')).toBe(true)
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
