import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/sessionCreateOperations').catch(() => null)
  : null
const Database = sqliteModule?.default
const SessionCreateOperationsTable = tableModule?.SessionCreateOperationsTable
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
const requireNativeSqlite = process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1'
const describeIfSqlite =
  sqliteAvailable && SessionCreateOperationsTable
    ? describe
    : requireNativeSqlite
      ? (name: string, _suite: () => void) =>
          describe(name, () => {
            it('requires native SQLite support', () => {
              throw new Error('Native SQLite session create operation harness is unavailable')
            })
          })
      : describe.skip

describeIfSqlite('SessionCreateOperationsTable', () => {
  const DatabaseCtor = Database!
  const TableCtor = SessionCreateOperationsTable!
  let db: InstanceType<typeof DatabaseCtor> | null
  let table: InstanceType<typeof TableCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    db.exec('CREATE TABLE new_sessions (id TEXT PRIMARY KEY)')
    table = new TableCtor(db)
    table.createTable()
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  function insert(operationId: string, fingerprint: string, createdAt: number) {
    return table.create({
      operationId,
      sessionId: `session-${operationId}`,
      inputFingerprint: fingerprint,
      now: createdAt
    })
  }

  it('stores only content-free identity, fingerprint, state, stage, and timestamps', () => {
    insert('00000000-0000-4000-8000-000000000001', 'sha256-only', 10)

    const columns = db!.prepare('PRAGMA table_info(session_create_operations)').all() as Array<{
      name: string
    }>
    expect(columns.map((column) => column.name)).toEqual([
      'operation_id',
      'session_id',
      'input_fingerprint',
      'state',
      'stage',
      'error_code',
      'dismissed_at',
      'created_at',
      'updated_at'
    ])
    expect(JSON.stringify(columns)).not.toMatch(/message|file|payload|prompt|title|provider|model/)

    const indexes = db!
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND tbl_name = 'session_create_operations'`
      )
      .all() as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'idx_session_create_operations_fingerprint_state',
        'idx_session_create_operations_history'
      ])
    )
  })

  it('keeps dismissed unresolved rows visible to fingerprint dedupe and history', () => {
    const operationId = '00000000-0000-4000-8000-000000000001'
    insert(operationId, 'same', 10)
    table.settle(operationId, {
      state: 'unknown',
      errorCode: 'CREATE_SESSION_CLEANUP_UNCERTAIN',
      now: 11
    })
    table.dismiss(operationId, 12)

    expect(table.findUnresolvedByFingerprint('same')).toMatchObject({
      operation_id: operationId,
      state: 'unknown',
      dismissed_at: 12
    })
    expect(table.listPage({ limit: 20 }).rows).toMatchObject([
      { operation_id: operationId, dismissed_at: 12 }
    ])
  })

  it('marks incomplete operations unknown on restart without replay data', () => {
    const pendingId = '00000000-0000-4000-8000-000000000001'
    const recoverableId = '00000000-0000-4000-8000-000000000002'
    insert(pendingId, 'pending', 10)
    const recoverable = insert(recoverableId, 'complete', 11)
    table.updateStage(recoverableId, 'input_accepted', 12)
    db!.prepare('INSERT INTO new_sessions (id) VALUES (?)').run(recoverable.session_id)

    expect(table.recoverAfterRestart(20)).toEqual({ succeeded: 1, unknown: 1 })
    expect(table.get(pendingId)).toMatchObject({
      state: 'unknown',
      stage: 'accepted',
      error_code: 'CREATE_OPERATION_RESTARTED'
    })
    expect(table.get(recoverableId)).toMatchObject({ state: 'succeeded', stage: 'completed' })
  })

  it('paginates same-millisecond rows without gaps when mutable fields change', () => {
    const ids = [
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    ]
    for (const id of ids) insert(id, id, 100)
    insert('00000000-0000-4000-8000-000000000004', 'older', 99)

    const first = table.listPage({ limit: 2 })
    expect(first.rows.map((row) => row.operation_id)).toEqual(ids.slice().sort().slice(0, 2))
    expect(first.hasMore).toBe(true)
    const last = first.rows.at(-1)!
    table.dismiss(first.rows[0].operation_id, 500)
    table.settle(first.rows[0].operation_id, {
      state: 'unknown',
      errorCode: 'CREATE_SESSION_CLEANUP_UNCERTAIN',
      now: 501
    })

    const second = table.listPage({
      limit: 2,
      cursor: { createdAt: last.created_at, operationId: last.operation_id }
    })
    expect(second.rows.map((row) => row.operation_id)).toEqual([
      ids.slice().sort()[2],
      '00000000-0000-4000-8000-000000000004'
    ])
    expect(second.hasMore).toBe(false)
  })

  it('deletes only succeeded evidence when its session is deleted', () => {
    const succeeded = '00000000-0000-4000-8000-000000000001'
    const unknown = '00000000-0000-4000-8000-000000000002'
    insert(succeeded, 'success', 10)
    insert(unknown, 'unknown', 11)
    table.settle(succeeded, {
      state: 'succeeded',
      stage: 'completed',
      errorCode: null,
      now: 12
    })
    table.settle(unknown, {
      state: 'unknown',
      errorCode: 'CREATE_SESSION_CLEANUP_UNCERTAIN',
      now: 12
    })

    table.deleteSucceededBySession(`session-${succeeded}`)
    table.deleteSucceededBySession(`session-${unknown}`)

    expect(table.get(succeeded)).toBeNull()
    expect(table.get(unknown)).not.toBeNull()
  })
})
