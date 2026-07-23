import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { expect, it, vi } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')

const presenterModule = Database ? await import('@/data/mainDatabase').catch(() => null) : null
const importerModule = Database ? await import('@/sync/dataImporter').catch(() => null) : null
const memoryDatabaseModule = Database
  ? await import('@/memory/data/database').catch(() => null)
  : null

const MainDatabase = presenterModule?.MainDatabase
const DataImporter = importerModule?.DataImporter
const MemoryDatabase = memoryDatabaseModule?.MemoryDatabase
const DatabaseCtor = Database!
const MainDatabaseCtor = MainDatabase!
const DataImporterCtor = DataImporter!
const MemoryDatabaseCtor = MemoryDatabase!
const describeIfNative = nativeSqliteDescribeIf(
  Boolean(MainDatabase && DataImporter && MemoryDatabase),
  'Native SQLite database, memory database, or importer is unavailable'
)
const memoryDatabases = new WeakMap<
  InstanceType<typeof MainDatabaseCtor>,
  InstanceType<typeof MemoryDatabaseCtor>
>()

function memoryTable(database: InstanceType<typeof MainDatabaseCtor>) {
  let memoryDatabase = memoryDatabases.get(database)
  if (!memoryDatabase) {
    memoryDatabase = new MemoryDatabaseCtor(database)
    memoryDatabases.set(database, memoryDatabase)
  }
  return memoryDatabase.agentMemoryTable
}

function withTemporaryDatabase(run: (databasePath: string) => void): void {
  const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-migration-'))
  try {
    run(join(directory, 'agent.db'))
  } finally {
    actualFs.rmSync(directory, { recursive: true, force: true })
  }
}

function dropV42CanonicalArtifacts(db: InstanceType<typeof DatabaseCtor>): void {
  db.exec(`
    DROP TRIGGER IF EXISTS agent_memory_legacy_status_bridge_ai;
    DROP TRIGGER IF EXISTS agent_memory_legacy_status_bridge_au;
    DROP INDEX IF EXISTS idx_agent_memory_active_recall;
    DROP INDEX IF EXISTS idx_agent_memory_management_page_v3;
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

function seedReadyEmbedding(
  db: InstanceType<typeof DatabaseCtor>,
  id: string,
  embeddingId: string,
  embeddingDim: number,
  embeddingModel: string
): void {
  db.prepare(
    `UPDATE agent_memory
     SET embedding_state = 'ready', status = 'embedded',
         embedding_id = ?, embedding_dim = ?, embedding_model = ?
     WHERE id = ?`
  ).run(embeddingId, embeddingDim, embeddingModel, id)
}

describeIfNative('Memory native SQLite migration', () => {
  it('creates the fresh v42 schema with canonical memory state and reopens idempotently', () => {
    withTemporaryDatabase((databasePath) => {
      const first = new MainDatabaseCtor(databasePath)
      const db = first.getDatabase()
      const columns = db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      expect(columns.some((column) => column.name === 'decision_revision')).toBe(true)
      expect(columns.some((column) => column.name === 'lifecycle_state')).toBe(true)
      expect(columns.some((column) => column.name === 'embedding_state')).toBe(true)
      expect(() =>
        db.exec(
          "INSERT INTO agent_memory (id, agent_id, kind, content, lifecycle_state, created_at) VALUES ('bad-life', 'a', 'semantic', 'bad', 'invalid', 1)"
        )
      ).toThrow(/CHECK constraint failed/)
      expect(() =>
        db.exec(
          "INSERT INTO agent_memory (id, agent_id, kind, content, embedding_state, created_at) VALUES ('bad-embedding', 'a', 'semantic', 'bad', 'invalid', 1)"
        )
      ).toThrow(/CHECK constraint failed/)
      expect(
        db.prepare("SELECT 1 AS present FROM sqlite_master WHERE name = 'agent_memory_fts'").get()
      ).toEqual({ present: 1 })
      first.close()

      const reopened = new MainDatabaseCtor(databasePath)
      expect(reopened.getLatestSchemaVersion()).toBeGreaterThanOrEqual(42)
      reopened.close()
    })
  })

  it('repairs missing or stale bridge definitions only when canonical shadow is consistent', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new MainDatabaseCtor(databasePath)
      memoryTable(seeded).insert({
        id: 'consistent',
        agentId: 'a',
        kind: 'semantic',
        content: 'consistent'
      })
      seeded.close()

      const broken = new DatabaseCtor(databasePath)
      broken.exec(`
        DROP TRIGGER agent_memory_legacy_status_bridge_ai;
        DROP TRIGGER agent_memory_legacy_status_bridge_au;
        CREATE TRIGGER agent_memory_legacy_status_bridge_ai
        AFTER INSERT ON agent_memory BEGIN SELECT 1; END;
      `)
      broken.close()

      const repaired = new MainDatabaseCtor(databasePath)
      const db = repaired.getDatabase()
      const triggers = db
        .prepare(
          `SELECT name, sql FROM sqlite_master
           WHERE type = 'trigger' AND name LIKE 'agent_memory_legacy_status_bridge_%'
           ORDER BY name`
        )
        .all() as Array<{ name: string; sql: string }>
      expect(triggers.map((trigger) => trigger.name)).toEqual([
        'agent_memory_legacy_status_bridge_ai',
        'agent_memory_legacy_status_bridge_au'
      ])
      expect(
        triggers.every((trigger) => trigger.sql.includes('invalid legacy agent_memory status'))
      ).toBe(true)
      repaired.close()
    })
  })

  it('backs up and repairs mismatches before replacing a missing bridge', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new MainDatabaseCtor(databasePath)
      memoryTable(seeded).insert({
        id: 'mismatch',
        agentId: 'a',
        kind: 'semantic',
        content: 'mismatch'
      })
      seedReadyEmbedding(seeded.getDatabase(), 'mismatch', 'vector', 4, 'p:m')
      memoryTable(seeded).insert({
        id: 'internal-mismatch',
        agentId: 'a',
        kind: 'persona',
        content: 'internal mismatch'
      })
      seeded
        .getDatabase()
        .exec(
          "UPDATE agent_memory SET lifecycle_state = 'archived', status = 'archived' WHERE id = 'internal-mismatch'"
        )
      seeded.close()

      const broken = new DatabaseCtor(databasePath)
      broken.exec('DROP TRIGGER agent_memory_legacy_status_bridge_au')
      broken.exec("UPDATE agent_memory SET status = 'error' WHERE id = 'mismatch'")
      broken.exec("UPDATE agent_memory SET status = 'fts_only' WHERE id = 'internal-mismatch'")
      broken.close()

      const repaired = new MainDatabaseCtor(databasePath)
      expect(
        repaired
          .getDatabase()
          .prepare(
            `SELECT lifecycle_state, embedding_state, status
             FROM agent_memory WHERE id = 'mismatch'`
          )
          .get()
      ).toEqual({ lifecycle_state: 'active', embedding_state: 'error', status: 'error' })
      expect(
        repaired
          .getDatabase()
          .prepare(
            `SELECT lifecycle_state, embedding_state, status
             FROM agent_memory WHERE id = 'internal-mismatch'`
          )
          .get()
      ).toEqual({
        lifecycle_state: 'archived',
        embedding_state: 'not_applicable',
        status: 'archived'
      })
      repaired.close()

      expect(
        actualFs
          .readdirSync(dirname(databasePath))
          .some((entry) => entry.endsWith('.memory-state-repair.bak'))
      ).toBe(true)
    })
  })

  it('rolls targeted bridge recovery back after creating its safety backup', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new MainDatabaseCtor(databasePath)
      memoryTable(seeded).insert({
        id: 'rollback-mismatch',
        agentId: 'a',
        kind: 'semantic',
        content: 'rollback mismatch'
      })
      seeded.close()

      const broken = new DatabaseCtor(databasePath)
      broken.exec('DROP TRIGGER agent_memory_legacy_status_bridge_au')
      broken.exec('CREATE TABLE agent_memory_legacy_status_bridge_au (id INTEGER)')
      broken.exec("UPDATE agent_memory SET status = 'error' WHERE id = 'rollback-mismatch'")
      broken.close()

      expect(() => new MainDatabaseCtor(databasePath)).toThrow(/name is occupied by table/)

      const rolledBack = new DatabaseCtor(databasePath)
      expect(
        rolledBack
          .prepare(
            `SELECT lifecycle_state, embedding_state, status
             FROM agent_memory WHERE id = 'rollback-mismatch'`
          )
          .get()
      ).toEqual({
        lifecycle_state: 'active',
        embedding_state: 'pending',
        status: 'error'
      })
      expect(
        rolledBack
          .prepare(
            `SELECT type FROM sqlite_master
             WHERE name = 'agent_memory_legacy_status_bridge_au'`
          )
          .get()
      ).toEqual({ type: 'table' })
      rolledBack.close()
      expect(
        actualFs
          .readdirSync(dirname(databasePath))
          .some((entry) => entry.endsWith('.memory-state-repair.bak'))
      ).toBe(true)
    })
  })

  it('rolls back v42 columns and version when bridge finalization fails', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new MainDatabaseCtor(databasePath)
      seeded.close()

      const legacy = new DatabaseCtor(databasePath)
      dropV42CanonicalArtifacts(legacy)
      legacy.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
      legacy.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')
      legacy.exec('DELETE FROM schema_versions')
      legacy.exec('INSERT INTO schema_versions (version, applied_at) VALUES (41, 1)')
      legacy.exec('CREATE TABLE agent_memory_legacy_status_bridge_ai (id INTEGER)')
      legacy.close()

      expect(() => new MainDatabaseCtor(databasePath)).toThrow()

      const rolledBack = new DatabaseCtor(databasePath)
      const columns = rolledBack.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
        name: string
      }>
      expect(columns.some((column) => column.name === 'lifecycle_state')).toBe(false)
      expect(columns.some((column) => column.name === 'embedding_state')).toBe(false)
      expect(
        rolledBack.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
      ).toEqual({ version: 41 })
      rolledBack.close()
    })
  })

  it('invalidates clean FTS metadata after incremental memory import and rebuilds on reopen', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-import-'))
    const sourcePath = join(directory, 'source.db')
    const targetPath = join(directory, 'target.db')
    try {
      const source = new MainDatabaseCtor(sourcePath)
      memoryTable(source).insert({
        id: 'imported-memory',
        agentId: 'a',
        kind: 'semantic',
        content: 'incrementally imported redis memory'
      })
      source.close()

      const target = new MainDatabaseCtor(targetPath)
      memoryTable(target).insert({
        id: 'existing-memory',
        agentId: 'a',
        kind: 'semantic',
        content: 'existing redis memory'
      })
      expect(
        target
          .getDatabase()
          .prepare("SELECT key FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'")
          .get()
      ).toEqual({ key: 'agent_memory_fts' })
      target.close()

      const importer = new DataImporterCtor(sourcePath, targetPath)
      await importer.importData()
      importer.close()

      const reopened = new MainDatabaseCtor(targetPath)
      const result = memoryTable(reopened).searchWithStrategy('a', 'imported', 10)
      expect(result.strategy).toBe('fts-only')
      expect(result.rows.map((row) => row.id)).toContain('imported-memory')
      reopened.close()
    } finally {
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('promotes clean v41 FTS metadata in place and rebuilds partial or dirty variants', () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-fts-upgrade-'))
    try {
      for (const variant of ['normal', 'partial', 'dirty'] as const) {
        const databasePath = join(directory, `${variant}.db`)
        const seeded = new MainDatabaseCtor(databasePath)
        memoryTable(seeded).insert({
          id: 'authoritative',
          agentId: 'a',
          kind: 'semantic',
          content: 'authoritative memory'
        })
        seeded
          .getDatabase()
          .exec(
            "INSERT INTO agent_memory_fts(rowid, content, agent_id) VALUES (999999, 'upgrade sentinel', 'a')"
          )
        seeded.close()

        const legacy = new DatabaseCtor(databasePath)
        dropV42CanonicalArtifacts(legacy)
        legacy.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
        if (variant !== 'partial') {
          legacy.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')
        }
        legacy.exec(
          `UPDATE agent_memory_fts_meta
           SET policy_version = 2,
               mutation_generation = mutation_generation + ${variant === 'dirty' ? 1 : 0}`
        )
        legacy.exec('DELETE FROM schema_versions')
        legacy.exec('INSERT INTO schema_versions (version, applied_at) VALUES (41, 1)')
        legacy.close()

        const migrated = new MainDatabaseCtor(databasePath)
        const sentinel = migrated
          .getDatabase()
          .prepare("SELECT rowid FROM agent_memory_fts WHERE agent_memory_fts MATCH 'sentinel'")
          .get()
        expect(Boolean(sentinel)).toBe(variant === 'normal')
        expect(memoryTable(migrated).search('a', 'authoritative')).toHaveLength(1)
        migrated.close()
      }
    } finally {
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('migrates a v41 database that predates FTS policy metadata', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new MainDatabaseCtor(databasePath)
      memoryTable(seeded).insert({
        id: 'pre-fts-meta',
        agentId: 'a',
        kind: 'semantic',
        content: 'pre metadata memory'
      })
      seeded.close()

      const legacy = new DatabaseCtor(databasePath)
      dropV42CanonicalArtifacts(legacy)
      legacy.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
      legacy.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')
      legacy.exec('DROP TABLE agent_memory_fts')
      legacy.exec('DROP TABLE agent_memory_fts_meta')
      legacy.exec('DELETE FROM schema_versions')
      legacy.exec('INSERT INTO schema_versions (version, applied_at) VALUES (41, 1)')
      legacy.close()

      const migrated = new MainDatabaseCtor(databasePath)
      expect(
        migrated
          .getDatabase()
          .prepare('SELECT version FROM schema_versions WHERE version = 42')
          .get()
      ).toEqual({ version: 42 })
      expect(
        memoryTable(migrated)
          .search('a', 'metadata')
          .map((row) => row.id)
      ).toEqual(['pre-fts-meta'])
      migrated.close()
    })
  })

  it('normalizes legacy, partial-canonical, and canonical incremental memory imports', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-state-import-'))
    try {
      const cases = [
        {
          name: 'legacy',
          lifecycleState: 'archived',
          embeddingState: 'ready',
          status: 'archived',
          dropColumns: ['embedding_state', 'lifecycle_state']
        },
        {
          name: 'lifecycle-only',
          lifecycleState: 'archived',
          embeddingState: 'error',
          status: 'error',
          dropColumns: ['embedding_state']
        },
        {
          name: 'embedding-only',
          lifecycleState: 'conflicted',
          embeddingState: 'ready',
          status: 'conflicted',
          dropColumns: ['lifecycle_state']
        },
        {
          name: 'canonical',
          lifecycleState: 'archived',
          embeddingState: 'ready',
          status: 'error',
          dropColumns: []
        }
      ] as const

      for (const testCase of cases) {
        const sourcePath = join(directory, `${testCase.name}-source.db`)
        const targetPath = join(directory, `${testCase.name}-target.db`)
        const source = new MainDatabaseCtor(sourcePath)
        memoryTable(source).insert({
          id: testCase.name,
          agentId: 'a',
          kind: 'semantic',
          content: testCase.name
        })
        seedReadyEmbedding(source.getDatabase(), testCase.name, `${testCase.name}-vector`, 4, 'p:m')
        if (testCase.lifecycleState === 'archived') {
          const row = memoryTable(source).getById(testCase.name)!
          memoryTable(source).archiveActiveMemory({
            agentId: row.agent_id,
            id: row.id,
            expectedRevision: row.decision_revision
          })
        }
        source.close()

        const sourceDb = new DatabaseCtor(sourcePath)
        dropV42CanonicalArtifacts(sourceDb)
        sourceDb.prepare('UPDATE agent_memory SET status = ?').run(testCase.status)
        for (const column of testCase.dropColumns) {
          sourceDb.exec(`ALTER TABLE agent_memory DROP COLUMN ${column}`)
        }
        sourceDb.close()

        const target = new MainDatabaseCtor(targetPath)
        target.close()
        const importer = new DataImporterCtor(sourcePath, targetPath)
        await importer.importData()
        importer.close()

        const imported = new DatabaseCtor(targetPath)
        expect(
          imported
            .prepare(
              `SELECT lifecycle_state, embedding_state, status
               FROM agent_memory WHERE id = ?`
            )
            .get(testCase.name)
        ).toEqual({
          lifecycle_state: testCase.lifecycleState,
          embedding_state: testCase.embeddingState,
          status: testCase.lifecycleState === 'archived' ? 'archived' : 'conflicted'
        })
        imported.close()
      }
    } finally {
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('repairs malformed legacy shadow and skips only malformed canonical rows', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-invalid-import-'))
    const sourcePath = join(directory, 'source.db')
    const targetPath = join(directory, 'target.db')
    const canonicalTargetPath = join(directory, 'canonical-target.db')
    try {
      const source = new MainDatabaseCtor(sourcePath)
      memoryTable(source).insert({
        id: 'valid',
        agentId: 'a',
        kind: 'semantic',
        content: 'valid'
      })
      memoryTable(source).insert({
        id: 'invalid',
        agentId: 'a',
        kind: 'semantic',
        content: 'invalid'
      })
      source.close()
      const sourceDb = new DatabaseCtor(sourcePath)
      sourceDb.exec('DROP TRIGGER agent_memory_legacy_status_bridge_au')
      sourceDb.exec("UPDATE agent_memory SET status = 'invalid' WHERE id = 'invalid'")
      sourceDb.close()

      const target = new MainDatabaseCtor(targetPath)
      target.close()
      const importer = new DataImporterCtor(sourcePath, targetPath)
      const legacySummary = await importer.importData()
      importer.close()

      const targetDb = new DatabaseCtor(targetPath)
      expect(
        targetDb.prepare("SELECT COUNT(*) AS count FROM agent_memory WHERE agent_id = 'a'").get()
      ).toEqual({ count: 2 })
      expect(legacySummary.repairedRowCounts).toEqual({ agent_memory: 1 })
      expect(legacySummary.skippedRowCounts).toEqual({})
      targetDb.close()

      const malformedCanonical = new DatabaseCtor(sourcePath)
      malformedCanonical.exec("UPDATE agent_memory SET status = 'pending_embedding'")
      dropV42CanonicalArtifacts(malformedCanonical)
      malformedCanonical.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')
      malformedCanonical.exec('ALTER TABLE agent_memory ADD COLUMN lifecycle_state TEXT')
      malformedCanonical.exec(
        "UPDATE agent_memory SET lifecycle_state = CASE id WHEN 'valid' THEN 'active' ELSE 'invalid' END"
      )
      malformedCanonical.close()

      const canonicalTarget = new MainDatabaseCtor(canonicalTargetPath)
      canonicalTarget.close()
      const canonicalImporter = new DataImporterCtor(sourcePath, canonicalTargetPath)
      const canonicalSummary = await canonicalImporter.importData()
      canonicalImporter.close()
      const canonicalTargetDb = new DatabaseCtor(canonicalTargetPath)
      expect(canonicalTargetDb.prepare('SELECT COUNT(*) AS count FROM agent_memory').get()).toEqual(
        {
          count: 1
        }
      )
      expect(canonicalSummary.tableCounts.agent_memory).toBe(1)
      expect(canonicalSummary.skippedRowCounts).toEqual({ agent_memory: 1 })
      canonicalTargetDb.close()
    } finally {
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a canonical import target without the required legacy status shadow', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-import-schema-'))
    const sourcePath = join(directory, 'source.db')
    const targetPath = join(directory, 'target.db')
    try {
      const source = new DatabaseCtor(sourcePath)
      source.exec(`
        CREATE TABLE aaa_probe (id TEXT PRIMARY KEY);
        INSERT INTO aaa_probe (id) VALUES ('must-roll-back');
        CREATE TABLE agent_memory (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        INSERT INTO agent_memory (id, agent_id, kind, content, status, created_at)
        VALUES ('memory', 'a', 'semantic', 'memory content', 'pending_embedding', 1);
      `)
      source.close()

      const target = new DatabaseCtor(targetPath)
      target.exec(`
        CREATE TABLE aaa_probe (id TEXT PRIMARY KEY);
        CREATE TABLE agent_memory (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          lifecycle_state TEXT NOT NULL DEFAULT 'active',
          embedding_state TEXT NOT NULL DEFAULT 'pending'
        );
      `)
      target.close()

      const importer = new DataImporterCtor(sourcePath, targetPath)
      await expect(importer.importData()).rejects.toThrow(
        /Unsupported target agent_memory schema: canonical state requires legacy status shadow/
      )
      importer.close()

      const reopened = new DatabaseCtor(targetPath)
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM aaa_probe').get()).toEqual({
        count: 0
      })
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM agent_memory').get()).toEqual({
        count: 0
      })
      reopened.close()
    } finally {
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  for (const version of [34, 37, 38, 40, 41]) {
    it(`migrates schema version ${version} through v41 to v42 and preserves legacy rows`, () => {
      withTemporaryDatabase((databasePath) => {
        const seeded = new MainDatabaseCtor(databasePath)
        seeded
          .getDatabase()
          .prepare(
            `INSERT INTO agent_memory (id, agent_id, kind, content, created_at)
           VALUES ('legacy', 'a', 'semantic', 'legacy content', 1)`
          )
          .run()
        seeded.close()

        const legacy = new DatabaseCtor(databasePath)
        dropV42CanonicalArtifacts(legacy)
        legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_active_recall')
        legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_recall_importance_v5')
        legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_embedding_queue')
        legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_lifecycle_maintenance')
        legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_target_v2')
        legacy.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
        legacy.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')
        legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_target')
        if (version === 34) {
          legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_link_anomaly_v2')
          legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_target_v2')
          legacy.exec('ALTER TABLE agent_memory DROP COLUMN conflict_with')
        }
        if (version < 41) {
          legacy.exec('ALTER TABLE agent_memory DROP COLUMN decision_revision')
        }
        legacy.exec('DELETE FROM schema_versions')
        legacy
          .prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)')
          .run(version, 1)
        legacy.close()

        const migrated = new MainDatabaseCtor(databasePath)
        const db = migrated.getDatabase()
        expect(
          db
            .prepare(
              `SELECT decision_revision, lifecycle_state, embedding_state, status
               FROM agent_memory WHERE id = ?`
            )
            .get('legacy')
        ).toEqual({
          decision_revision: 1,
          lifecycle_state: 'active',
          embedding_state: 'pending',
          status: 'pending_embedding'
        })
        expect(
          db
            .prepare(
              "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_memory_management_page_v3'"
            )
            .get()
        ).toEqual({ present: 1 })
        expect(
          db
            .prepare(
              "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_memory_conflict_target'"
            )
            .get()
        ).toBeUndefined()
        const columns = db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
          name: string
        }>
        expect(columns.some((column) => column.name === 'conflict_with')).toBe(true)
        migrated.close()

        const reopened = new MainDatabaseCtor(databasePath)
        expect(
          reopened
            .getDatabase()
            .prepare('SELECT decision_revision FROM agent_memory WHERE id = ?')
            .get('legacy')
        ).toEqual({ decision_revision: 1 })
        reopened.close()
      })
    })
  }

  it('tolerantly normalizes unknown v41 status by kind and embedding-ref completeness', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new MainDatabaseCtor(databasePath)
      for (const [id, kind] of [
        ['user-ready', 'semantic'],
        ['user-pending', 'semantic'],
        ['persona-ready', 'persona'],
        ['working-pending', 'working']
      ] as const) {
        memoryTable(seeded).insert({ id, agentId: 'a', kind, content: id })
      }
      seeded.close()

      const legacy = new DatabaseCtor(databasePath)
      dropV42CanonicalArtifacts(legacy)
      legacy.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
      legacy.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')
      legacy.exec("UPDATE agent_memory SET status = 'unknown_legacy_state'")
      legacy.exec(
        `UPDATE agent_memory
         SET embedding_id = id || '-vector', embedding_dim = 4, embedding_model = 'p:m'
         WHERE id IN ('user-ready', 'persona-ready')`
      )
      legacy.exec('DELETE FROM schema_versions')
      legacy.exec('INSERT INTO schema_versions (version, applied_at) VALUES (41, 1)')
      legacy.close()

      const migrated = new MainDatabaseCtor(databasePath)
      expect(
        migrated
          .getDatabase()
          .prepare(
            `SELECT id, lifecycle_state, embedding_state, status
             FROM agent_memory ORDER BY id`
          )
          .all()
      ).toEqual([
        {
          id: 'persona-ready',
          lifecycle_state: 'active',
          embedding_state: 'not_applicable',
          status: 'fts_only'
        },
        {
          id: 'user-pending',
          lifecycle_state: 'active',
          embedding_state: 'pending',
          status: 'pending_embedding'
        },
        {
          id: 'user-ready',
          lifecycle_state: 'active',
          embedding_state: 'ready',
          status: 'embedded'
        },
        {
          id: 'working-pending',
          lifecycle_state: 'active',
          embedding_state: 'not_applicable',
          status: 'fts_only'
        }
      ])
      migrated.close()
    })
  })

  it('preserves existing canonical axes when v42 migration adds only the missing column', () => {
    withTemporaryDatabase((databasePath) => {
      for (const variant of ['lifecycle-only', 'embedding-only', 'both-present'] as const) {
        const variantPath = `${databasePath}-${variant}`
        const seeded = new MainDatabaseCtor(variantPath)
        memoryTable(seeded).insert({
          id: variant,
          agentId: 'a',
          kind: 'semantic',
          content: variant
        })
        seedReadyEmbedding(seeded.getDatabase(), variant, `${variant}-vector`, 4, 'p:m')
        seeded
          .getDatabase()
          .prepare(
            "UPDATE agent_memory SET lifecycle_state = 'archived', status = 'archived' WHERE id = ?"
          )
          .run(variant)
        seeded.close()

        const partial = new DatabaseCtor(variantPath)
        dropV42CanonicalArtifacts(partial)
        if (variant === 'lifecycle-only') {
          partial.exec("UPDATE agent_memory SET status = 'error'")
          partial.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
        } else if (variant === 'embedding-only') {
          partial.exec("UPDATE agent_memory SET status = 'conflicted'")
          partial.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')
        } else {
          partial.exec("UPDATE agent_memory SET status = 'error'")
        }
        partial.exec('DELETE FROM schema_versions')
        partial.exec('INSERT INTO schema_versions (version, applied_at) VALUES (41, 1)')
        partial.close()

        const migrated = new MainDatabaseCtor(variantPath)
        expect(
          migrated
            .getDatabase()
            .prepare(
              `SELECT lifecycle_state, embedding_state, status
               FROM agent_memory WHERE id = ?`
            )
            .get(variant)
        ).toEqual(
          variant === 'lifecycle-only'
            ? { lifecycle_state: 'archived', embedding_state: 'error', status: 'archived' }
            : variant === 'embedding-only'
              ? { lifecycle_state: 'conflicted', embedding_state: 'ready', status: 'conflicted' }
              : { lifecycle_state: 'archived', embedding_state: 'ready', status: 'archived' }
        )
        migrated.close()
      }
    })
  })

  it('fails hard when schema version claims v42 but a required canonical column is missing', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new MainDatabaseCtor(databasePath)
      seeded.close()
      const broken = new DatabaseCtor(databasePath)
      dropV42CanonicalArtifacts(broken)
      broken.exec('DROP INDEX IF EXISTS idx_agent_memory_embedding_queue')
      broken.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
      broken.close()

      expect(() => new MainDatabaseCtor(databasePath)).toThrow(/embedding_state/)
    })
  })

  it('fails hard when canonical columns exist without the v42 constraints', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new MainDatabaseCtor(databasePath)
      seeded.close()
      const broken = new DatabaseCtor(databasePath)
      dropV42CanonicalArtifacts(broken)
      broken.exec(`
        DROP TABLE IF EXISTS agent_memory_fts;
        DROP TABLE IF EXISTS agent_memory_fts_meta;
        CREATE TABLE agent_memory_weak AS SELECT * FROM agent_memory;
        DROP TABLE agent_memory;
        ALTER TABLE agent_memory_weak RENAME TO agent_memory;
      `)
      broken.close()

      expect(() => new MainDatabaseCtor(databasePath)).toThrow(
        /lifecycle_state constraints are incomplete/
      )
    })
  })

  it('catalog repair backfills only newly added canonical columns and preserves valid state', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-catalog-repair-'))
    try {
      for (const missingColumns of [['embedding_state'], ['embedding_state', 'lifecycle_state']]) {
        const databasePath = join(directory, `${missingColumns.length}.db`)
        const presenter = new MainDatabaseCtor(databasePath)
        const table = memoryTable(presenter)
        const db = presenter.getDatabase()
        table.insert({
          id: 'archived-ready',
          agentId: 'a',
          kind: 'semantic',
          content: 'archived ready'
        })
        seedReadyEmbedding(db, 'archived-ready', 'archived-ready', 4, 'provider:model')
        const archivedReady = table.getById('archived-ready')!
        expect(
          table.archiveActiveMemory({
            agentId: archivedReady.agent_id,
            id: archivedReady.id,
            expectedRevision: archivedReady.decision_revision
          })
        ).toBe(true)
        table.insert({
          id: 'persona',
          agentId: 'a',
          kind: 'persona',
          content: 'self model',
          lifecycleState: 'active',
          embeddingState: 'not_applicable'
        })

        dropV42CanonicalArtifacts(db)
        db.exec('DROP INDEX IF EXISTS idx_agent_memory_embedding_queue')
        if (missingColumns.includes('lifecycle_state')) {
          db.exec('DROP INDEX IF EXISTS idx_agent_memory_active_recall')
          db.exec('DROP INDEX IF EXISTS idx_agent_memory_recall_importance_v5')
          db.exec('DROP INDEX IF EXISTS idx_agent_memory_lifecycle_maintenance')
          db.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_target_v2')
        }
        db.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
        if (missingColumns.includes('lifecycle_state')) {
          db.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')
        }

        const report = await presenter.repairSchema()
        expect(report.status).toBe('repaired')
        expect(
          db
            .prepare(
              `SELECT lifecycle_state, embedding_state, status
               FROM agent_memory WHERE id = 'archived-ready'`
            )
            .get()
        ).toEqual({
          lifecycle_state: 'archived',
          embedding_state: 'ready',
          status: 'archived'
        })
        expect(
          db
            .prepare(
              `SELECT lifecycle_state, embedding_state, status
               FROM agent_memory WHERE id = 'persona'`
            )
            .get()
        ).toEqual({
          lifecycle_state: 'active',
          embedding_state: 'not_applicable',
          status: 'fts_only'
        })
        presenter.close()
      }
    } finally {
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('normalizes malformed legacy state during catalog repair', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-repair-rollback-'))
    const databasePath = join(directory, 'agent.db')
    try {
      const presenter = new MainDatabaseCtor(databasePath)
      const db = presenter.getDatabase()
      memoryTable(presenter).insert({
        id: 'malformed',
        agentId: 'a',
        kind: 'semantic',
        content: 'malformed'
      })
      db.exec('DROP TRIGGER IF EXISTS agent_memory_legacy_status_bridge_au')
      db.exec("UPDATE agent_memory SET status = 'invalid_state' WHERE id = 'malformed'")
      dropV42CanonicalArtifacts(db)
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_active_recall')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_recall_importance_v5')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_embedding_queue')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_lifecycle_maintenance')
      db.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_target_v2')
      db.exec('ALTER TABLE agent_memory DROP COLUMN embedding_state')
      db.exec('ALTER TABLE agent_memory DROP COLUMN lifecycle_state')

      await expect(presenter.repairSchema()).resolves.toBeDefined()
      const columns = db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      expect(columns.some((column) => column.name === 'lifecycle_state')).toBe(true)
      expect(columns.some((column) => column.name === 'embedding_state')).toBe(true)
      expect(
        db
          .prepare(
            `SELECT lifecycle_state, embedding_state, status
             FROM agent_memory WHERE id = 'malformed'`
          )
          .get()
      ).toEqual({
        lifecycle_state: 'active',
        embedding_state: 'pending',
        status: 'pending_embedding'
      })
      presenter.close()
    } finally {
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
