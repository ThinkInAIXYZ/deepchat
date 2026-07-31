import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const mainDatabaseModule = Database ? await import('@/data/mainDatabase').catch(() => null) : null
const workflowRunsModule = Database
  ? await import('@/workflow/data/tables/workflowRuns').catch(() => null)
  : null
const MainDatabase = mainDatabaseModule?.MainDatabase
const WORKFLOW_SCHEMA_VERSION = workflowRunsModule?.WORKFLOW_SCHEMA_VERSION
const DatabaseCtor = Database!
const MainDatabaseCtor = MainDatabase!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(MainDatabase && WORKFLOW_SCHEMA_VERSION),
  'Workflow migration modules are unavailable'
)

describeIfSqlite('workflow schema migration', () => {
  const tempDirectories: string[] = []

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('migrates a v52 database to the workflow schema atomically', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workflow-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      DROP TRIGGER IF EXISTS trg_workflow_sessions_delete_references;
      DROP TABLE IF EXISTS workflow_invocations;
      DROP TABLE IF EXISTS workflow_runs;
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (52, 100);
    `)
    bootstrap.close()

    const database = new MainDatabaseCtor(databasePath)
    expect(database.getLatestSchemaVersion()).toBe(WORKFLOW_SCHEMA_VERSION)
    database.close()

    const migrated = new DatabaseCtor(databasePath)
    const tables = migrated
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('workflow_runs', 'workflow_invocations')
         ORDER BY name`
      )
      .all()
    expect(tables).toEqual([{ name: 'workflow_invocations' }, { name: 'workflow_runs' }])
    expect(migrated.prepare('SELECT MAX(version) AS version FROM schema_versions').get()).toEqual({
      version: WORKFLOW_SCHEMA_VERSION
    })

    const triggers = migrated
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'trigger'
           AND name LIKE 'trg_workflow_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
    expect(triggers.map((row) => row.name)).toEqual([
      'trg_workflow_invocations_child_insert',
      'trg_workflow_invocations_child_update',
      'trg_workflow_invocations_immutable_identity',
      'trg_workflow_invocations_run_insert',
      'trg_workflow_runs_delete_invocations',
      'trg_workflow_runs_immutable_snapshot',
      'trg_workflow_runs_parent_insert',
      'trg_workflow_sessions_delete_references'
    ])
    migrated.close()
  })
})
