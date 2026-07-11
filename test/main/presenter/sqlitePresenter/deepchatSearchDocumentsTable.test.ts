import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/deepchatSearchDocuments').catch(() => null)
  : null
const Database = sqliteModule?.default
const DeepChatSearchDocumentsTable = tableModule?.DeepChatSearchDocumentsTable
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
  sqliteAvailable && DeepChatSearchDocumentsTable
    ? describe
    : requireNativeSqlite
      ? (name: string, _suite: () => void) =>
          describe(name, () => {
            it('requires native SQLite support', () => {
              throw new Error('Native SQLite search document harness is unavailable')
            })
          })
      : describe.skip

describeIfSqlite('DeepChatSearchDocumentsTable', () => {
  const DatabaseCtor = Database!
  const TableCtor = DeepChatSearchDocumentsTable!
  let db: InstanceType<typeof DatabaseCtor> | null
  let table: InstanceType<typeof TableCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    table = new TableCtor(db)
    table.createTable()
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  it('distinguishes an available empty result from an unavailable index', () => {
    expect(table.searchFts('missing', 10)).toEqual({ kind: 'available', rows: [] })

    table.upsert({
      documentKey: 'session:session-1',
      sessionId: 'session-1',
      documentKind: 'session',
      title: 'Release checklist',
      content: '',
      updatedAt: 10
    })

    expect(table.searchFts('release', 10)).toMatchObject({
      kind: 'available',
      rows: [
        {
          document_key: 'session:session-1',
          session_id: 'session-1',
          document_kind: 'session',
          title: 'Release checklist'
        }
      ]
    })
  })

  it.each([
    'deepchat_search_documents_ai',
    'deepchat_search_documents_ad',
    'deepchat_search_documents_au'
  ])('treats a missing %s trigger as unavailable', (triggerName) => {
    db!.exec(`DROP TRIGGER ${triggerName}`)

    expect(table.isFtsAvailable()).toBe(false)
    expect(table.searchFts('release', 10)).toEqual({ kind: 'unavailable' })
  })
})
