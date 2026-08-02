import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const mainDatabaseModule = Database ? await import('@/data/mainDatabase').catch(() => null) : null
const liveDelegationsModule = Database
  ? await import('@/orchestration/data/tables/liveDelegations').catch(() => null)
  : null
const MainDatabaseCtor = mainDatabaseModule?.MainDatabase!
const LIVE_DELEGATION_DATABASE_SCHEMA_VERSION =
  liveDelegationsModule?.LIVE_DELEGATION_DATABASE_SCHEMA_VERSION
const DatabaseCtor = Database!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(MainDatabaseCtor && LIVE_DELEGATION_DATABASE_SCHEMA_VERSION),
  'Live delegation migration modules are unavailable'
)

describeIfSqlite('live delegation schema migration', () => {
  const tempDirectories: string[] = []

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('adds durable delegation, turn, and event tables from v59', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-live-delegation-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      DROP TABLE live_delegation_events;
      DROP TABLE live_delegation_turns;
      DROP TABLE live_delegations;
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (59, 100);
    `)
    bootstrap.close()

    const migrated = new MainDatabaseCtor(databasePath)
    expect(migrated.getLatestSchemaVersion()).toBe(LIVE_DELEGATION_DATABASE_SCHEMA_VERSION)
    migrated.close()

    const verification = new DatabaseCtor(databasePath)
    const tables = verification
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'live_delegations', 'live_delegation_turns', 'live_delegation_events'
           )
         ORDER BY name`
      )
      .all()
    expect(tables).toEqual([
      { name: 'live_delegation_events' },
      { name: 'live_delegation_turns' },
      { name: 'live_delegations' }
    ])
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({
      version: LIVE_DELEGATION_DATABASE_SCHEMA_VERSION
    })
    verification.close()
  })
})
