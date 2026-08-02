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

  it('adds effect evidence to existing v60 turns without losing rows', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-live-effect-migration-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'agent.db')
    const current = new MainDatabaseCtor(databasePath)
    current.close()

    const bootstrap = new DatabaseCtor(databasePath)
    bootstrap.exec(`
      ALTER TABLE live_delegation_turns DROP COLUMN effect_evidence_json;
      ALTER TABLE live_delegation_turns DROP COLUMN effect_state;
      INSERT INTO new_sessions (id, agent_id, title, created_at, updated_at)
      VALUES ('parent', 'agent-1', 'Parent', 100, 100);
      INSERT INTO live_delegations (
        delegation_id, parent_session_id, slot_id, target_agent_id, title, status,
        last_turn_seq, created_at, updated_at
      ) VALUES (
        'delegation-1', 'parent', 'reviewer', 'agent-1', 'Review', 'running', 1, 100, 100
      );
      INSERT INTO live_delegation_turns (
        turn_id, delegation_id, seq, kind, prompt, status, created_at, started_at, updated_at
      ) VALUES ('turn-1', 'delegation-1', 1, 'initial', 'Review it.', 'running', 100, 110, 110);
      DELETE FROM schema_versions;
      INSERT INTO schema_versions (version, applied_at) VALUES (60, 100);
    `)
    bootstrap.close()

    const migrated = new MainDatabaseCtor(databasePath)
    expect(migrated.getLatestSchemaVersion()).toBe(LIVE_DELEGATION_DATABASE_SCHEMA_VERSION)
    migrated.close()

    const verification = new DatabaseCtor(databasePath)
    expect(
      verification
        .prepare(
          `SELECT effect_state, effect_evidence_json
           FROM live_delegation_turns
           WHERE turn_id = 'turn-1'`
        )
        .get()
    ).toEqual({ effect_state: 'none', effect_evidence_json: null })
    expect(
      verification.prepare('SELECT MAX(version) AS version FROM schema_versions').get()
    ).toEqual({ version: LIVE_DELEGATION_DATABASE_SCHEMA_VERSION })
    verification.close()
  })
})
