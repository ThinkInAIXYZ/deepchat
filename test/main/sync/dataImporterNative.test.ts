import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, vi } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const importerModule = Database ? await import('@/sync/dataImporter').catch(() => null) : null
const DatabaseCtor = Database!
const DataImporterCtor = importerModule?.DataImporter!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(DatabaseCtor && DataImporterCtor),
  'Data importer persistence modules are unavailable'
)

const SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE new_sessions (
    id TEXT PRIMARY KEY,
    session_kind TEXT NOT NULL,
    parent_session_id TEXT
  );
  CREATE TABLE live_delegations (
    delegation_id TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT,
    slot_id TEXT NOT NULL,
    target_agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    last_turn_seq INTEGER NOT NULL,
    last_summary TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL
  );
  CREATE TABLE live_delegation_turns (
    turn_id TEXT PRIMARY KEY,
    delegation_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    result_summary TEXT,
    error TEXT,
    started_at INTEGER,
    finished_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    effect_state TEXT NOT NULL,
    effect_evidence_json TEXT,
    execution_snapshot_json TEXT,
    result_ref_json TEXT,
    FOREIGN KEY (delegation_id) REFERENCES live_delegations(delegation_id)
  );
  CREATE TABLE live_delegation_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    related_turn_id TEXT,
    consumed_by_turn_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (delegation_id) REFERENCES live_delegations(delegation_id),
    FOREIGN KEY (related_turn_id) REFERENCES live_delegation_turns(turn_id),
    FOREIGN KEY (consumed_by_turn_id) REFERENCES live_delegation_turns(turn_id)
  );
  CREATE TRIGGER trg_live_delegations_parent_insert
  BEFORE INSERT ON live_delegations
  WHEN NOT EXISTS (SELECT 1 FROM new_sessions WHERE id = NEW.parent_session_id)
  BEGIN
    SELECT RAISE(ABORT, 'live delegation parent session does not exist');
  END;
`

describeIfSqlite('DataImporter native copy order', () => {
  let temporaryDirectory: string | null = null

  afterEach(() => {
    if (temporaryDirectory) actualFs.rmSync(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = null
  })

  it('imports a complete live delegation graph under foreign-key enforcement', async () => {
    temporaryDirectory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-import-order-'))
    const sourcePath = join(temporaryDirectory, 'source.db')
    const source = new DatabaseCtor(sourcePath)
    source.exec(SCHEMA_SQL)
    source.exec(`
      INSERT INTO new_sessions VALUES ('parent', 'regular', NULL);
      INSERT INTO live_delegations VALUES (
        'delegation-1', 'parent', NULL, 'reviewer', 'deepchat', 'Review', 'idle', 1,
        'Done', NULL, 1, 2, 3
      );
      INSERT INTO live_delegation_turns VALUES (
        'turn-1', 'delegation-1', 1, 'initial', 'Review', 'completed', 'Done', NULL,
        1, 2, 1, 2, 'none', NULL, NULL, NULL
      );
      INSERT INTO live_delegation_events (
        delegation_id, parent_session_id, direction, kind, content, related_turn_id,
        consumed_by_turn_id, created_at
      ) VALUES (
        'delegation-1', 'parent', 'child_to_parent', 'turn_completed', 'Done', 'turn-1', NULL, 2
      );
    `)
    source.close()

    const target = new DatabaseCtor(':memory:')
    target.exec(SCHEMA_SQL)
    const importer = new DataImporterCtor(sourcePath, target)

    try {
      await expect(importer.importData()).resolves.toMatchObject({
        tableCounts: {
          new_sessions: 1,
          live_delegations: 1,
          live_delegation_turns: 1,
          live_delegation_events: 1
        }
      })
      expect(target.prepare('SELECT content FROM live_delegation_events').get()).toEqual({
        content: 'Done'
      })
    } finally {
      importer.close()
    }
  })

  it('keeps active desktop history while retaining imported native ownership across repeated merges', async () => {
    temporaryDirectory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-import-native-'))
    const sourcePath = join(temporaryDirectory, 'source.db')
    const source = new DatabaseCtor(sourcePath)
    const target = new DatabaseCtor(':memory:')
    const nativeSchema = `
      ${SCHEMA_SQL}
      CREATE TABLE dim_session_bindings (
        session_id TEXT PRIMARY KEY, dim_session_id TEXT NOT NULL, branch_id TEXT NOT NULL,
        generation INTEGER NOT NULL, UNIQUE(dim_session_id,branch_id)
      );
      CREATE TABLE dim_session_scopes (
        session_id TEXT NOT NULL, generation INTEGER NOT NULL, dim_session_id TEXT NOT NULL,
        branch_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(session_id,generation), UNIQUE(dim_session_id,branch_id)
      );
      CREATE TABLE deepchat_messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL
      );
      CREATE TABLE message_attachments (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES deepchat_messages(id)
      );
      CREATE TABLE dim_timeline_inspector_heads (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, native_session_id TEXT NOT NULL,
        branch_id TEXT NOT NULL, generation INTEGER NOT NULL
      );
      CREATE TABLE dim_timeline_inspector_facts (
        entry_id INTEGER PRIMARY KEY, head_id TEXT NOT NULL REFERENCES dim_timeline_inspector_heads(id)
      );
    `
    source.exec(nativeSchema)
    target.exec(nativeSchema)
    source.exec(`
      INSERT INTO new_sessions VALUES ('existing', 'regular', NULL), ('new', 'regular', NULL), ('shared', 'regular', NULL);
      INSERT INTO dim_session_bindings VALUES ('existing', 'imported', 'main', 3), ('new', 'new-native', 'main', 1), ('shared', 'shared-native', 'main', 1);
      INSERT INTO dim_session_scopes VALUES ('existing', 3, 'imported', 'main', 1), ('new', 1, 'new-native', 'main', 1), ('shared', 1, 'shared-native', 'main', 1);
      INSERT INTO deepchat_messages VALUES ('incoming-message', 'existing', 'Do not mix'), ('new-message', 'new', 'Import'), ('shared-incoming', 'shared', 'Replay from local cursor');
      INSERT INTO message_attachments VALUES ('incoming-file', 'incoming-message'), ('new-file', 'new-message');
      INSERT INTO dim_timeline_inspector_heads VALUES ('incoming-head', 'existing', 'imported', 'main', 3);
      INSERT INTO dim_timeline_inspector_facts VALUES (1, 'incoming-head');
    `)
    target.exec(`
      INSERT INTO new_sessions VALUES ('existing', 'regular', NULL), ('shared', 'regular', NULL);
      INSERT INTO dim_session_bindings VALUES ('existing', 'current', 'main', 3), ('shared', 'shared-native', 'main', 2);
      INSERT INTO dim_session_scopes VALUES ('existing', 3, 'current', 'main', 1), ('shared', 2, 'shared-native', 'main', 1);
      INSERT INTO deepchat_messages VALUES ('current-message', 'existing', 'Keep'), ('shared-local', 'shared', 'Keep shared projection');
    `)
    source.close()
    const importer = new DataImporterCtor(sourcePath, target)
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await importer.importData()
      }
      expect(
        target.prepare('SELECT * FROM dim_session_bindings WHERE session_id=?').get('existing')
      ).toMatchObject({ dim_session_id: 'current', generation: 3 })
      expect(target.prepare('SELECT content FROM deepchat_messages ORDER BY id').all()).toEqual([
        { content: 'Keep' },
        { content: 'Import' },
        { content: 'Keep shared projection' }
      ])
      expect(target.prepare('SELECT id FROM message_attachments').all()).toEqual([
        { id: 'new-file' }
      ])
      expect(target.prepare('SELECT * FROM dim_timeline_inspector_facts').all()).toEqual([])
      expect(
        target
          .prepare(
            'SELECT dim_session_id,generation FROM dim_session_scopes ORDER BY dim_session_id'
          )
          .all()
      ).toEqual([
        { dim_session_id: 'current', generation: 3 },
        { dim_session_id: 'imported', generation: -1 },
        { dim_session_id: 'new-native', generation: 1 },
        { dim_session_id: 'shared-native', generation: 2 }
      ])
      // The next active generation remains available after importing a closed scope.
      expect(() =>
        target
          .prepare('INSERT INTO dim_session_scopes VALUES (?,4,?,?,1)')
          .run('existing', 'next', 'main')
      ).not.toThrow()
    } finally {
      importer.close()
    }
  })
})
