import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3-multiple-ciphers'
import { SessionDatabase } from '@/session/data/database'

// The production tables and transactions with Node SQLite avoid rebuilding Electron native modules.
export function dimDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename)
  let transaction = 0
  const adapter = {
    prepare: (sql: string) => sqlite.prepare(sql),
    exec: (sql: string) => sqlite.exec(sql),
    transaction:
      <T>(operation: () => T) =>
      () => {
        const name = `projection_${transaction++}`
        sqlite.exec(`SAVEPOINT ${name}`)
        try {
          const result = operation()
          sqlite.exec(`RELEASE ${name}`)
          return result
        } catch (error) {
          sqlite.exec(`ROLLBACK TO ${name}`)
          sqlite.exec(`RELEASE ${name}`)
          throw error
        }
      }
  } as unknown as Database.Database
  const data = new SessionDatabase({ getDatabase: () => adapter })
  for (const table of [
    data.dimSessionBindingsTable,
    data.dimInputIntentsTable,
    data.dimInputProjectionTable,
    data.dimProviderGrantsTable,
    data.deepchatSessionsTable,
    data.newSessionsTable,
    data.deepchatMessagesTable,
    data.deepchatAssistantBlocksTable,
    data.deepchatUserMessagesTable,
    data.deepchatUserMessageFilesTable,
    data.deepchatUserMessageLinksTable,
    data.deepchatSearchDocumentsTable,
    data.deepchatMessageTracesTable,
    data.deepchatMessageSearchResultsTable
  ])
    sqlite.exec(table.getCreateTableSQL())
  return { data, sqlite }
}
