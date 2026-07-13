import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')

const presenterModule = Database
  ? await import('@/presenter/sqlitePresenter').catch(() => null)
  : null
const importerModule = Database
  ? await import('@/presenter/sqlitePresenter/importData').catch(() => null)
  : null

const SQLitePresenter = presenterModule?.SQLitePresenter
const DataImporter = importerModule?.DataImporter
const DatabaseCtor = Database!
const SQLitePresenterCtor = SQLitePresenter!
const DataImporterCtor = DataImporter!
const describeIfNative = nativeSqliteDescribeIf(
  Boolean(SQLitePresenter && DataImporter),
  'Native SQLite presenter or importer is unavailable'
)

function withTemporaryDatabase(run: (databasePath: string) => void): void {
  const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-migration-'))
  try {
    run(join(directory, 'agent.db'))
  } finally {
    actualFs.rmSync(directory, { recursive: true, force: true })
  }
}

describeIfNative('Memory native SQLite migration', () => {
  it('creates the fresh v41 schema with FTS and reopens idempotently', () => {
    withTemporaryDatabase((databasePath) => {
      const first = new SQLitePresenterCtor(databasePath)
      const db = first.getDatabase()
      const columns = db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{ name: string }>
      expect(columns.some((column) => column.name === 'decision_revision')).toBe(true)
      expect(
        db.prepare("SELECT 1 AS present FROM sqlite_master WHERE name = 'agent_memory_fts'").get()
      ).toEqual({ present: 1 })
      first.close()

      const reopened = new SQLitePresenterCtor(databasePath)
      expect(reopened.getLatestSchemaVersion()).toBeGreaterThanOrEqual(41)
      reopened.close()
    })
  })

  it('invalidates clean FTS metadata after incremental memory import and rebuilds on reopen', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-import-'))
    const sourcePath = join(directory, 'source.db')
    const targetPath = join(directory, 'target.db')
    try {
      const source = new SQLitePresenterCtor(sourcePath)
      source.agentMemoryTable.insert({
        id: 'imported-memory',
        agentId: 'a',
        kind: 'semantic',
        content: 'incrementally imported redis memory'
      })
      source.close()

      const target = new SQLitePresenterCtor(targetPath)
      target.agentMemoryTable.insert({
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

      const reopened = new SQLitePresenterCtor(targetPath)
      const result = reopened.agentMemoryTable.searchWithStrategy('a', 'imported', 10)
      expect(result.strategy).toBe('fts-only')
      expect(result.rows.map((row) => row.id)).toContain('imported-memory')
      reopened.close()
    } finally {
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  for (const version of [34, 37, 38, 40]) {
    it(`migrates schema version ${version} to v41 and preserves legacy rows`, () => {
      withTemporaryDatabase((databasePath) => {
        const seeded = new SQLitePresenterCtor(databasePath)
        seeded
          .getDatabase()
          .prepare(
            `INSERT INTO agent_memory (id, agent_id, kind, content, created_at)
           VALUES ('legacy', 'a', 'semantic', 'legacy content', 1)`
          )
          .run()
        seeded.close()

        const legacy = new DatabaseCtor(databasePath)
        legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_target')
        if (version === 34) {
          legacy.exec('DROP INDEX IF EXISTS idx_agent_memory_conflict_link_anomaly_v2')
          legacy.exec('ALTER TABLE agent_memory DROP COLUMN conflict_with')
        }
        legacy.exec('ALTER TABLE agent_memory DROP COLUMN decision_revision')
        legacy.exec('DELETE FROM schema_versions')
        legacy
          .prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)')
          .run(version, 1)
        legacy.close()

        const migrated = new SQLitePresenterCtor(databasePath)
        const db = migrated.getDatabase()
        expect(
          db.prepare('SELECT decision_revision FROM agent_memory WHERE id = ?').get('legacy')
        ).toEqual({ decision_revision: 1 })
        expect(
          db
            .prepare(
              "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_memory_conflict_target'"
            )
            .get()
        ).toEqual({ present: 1 })
        const columns = db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
          name: string
        }>
        expect(columns.some((column) => column.name === 'conflict_with')).toBe(true)
        migrated.close()

        const reopened = new SQLitePresenterCtor(databasePath)
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

  it('fails hard when schema version claims v41 but the required column is missing', () => {
    withTemporaryDatabase((databasePath) => {
      const seeded = new SQLitePresenterCtor(databasePath)
      seeded.close()
      const broken = new DatabaseCtor(databasePath)
      broken.exec('ALTER TABLE agent_memory DROP COLUMN decision_revision')
      broken.close()

      expect(() => new SQLitePresenterCtor(databasePath)).toThrow(/decision_revision/)
    })
  })
})
