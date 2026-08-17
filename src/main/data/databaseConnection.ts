import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import { configureSQLiteConnection } from './connectionConfig'
import { assertNoOrphanWalSidecar } from './databaseStartupRecovery'

export interface DatabaseConnectionProvider {
  getDatabase(): Database.Database
}

function ensureDatabaseDirectory(dbPath: string): void {
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
}

export function openSQLiteDatabase(dbPath: string, password?: string): Database.Database {
  ensureDatabaseDirectory(dbPath)
  assertNoOrphanWalSidecar(dbPath)
  const db = new Database(dbPath)
  try {
    configureSQLiteConnection(db, password)
    return db
  } catch (error) {
    try {
      db.close()
    } catch {
      // Preserve the configuration error; the failed connection must not escape this boundary.
    }
    throw error
  }
}
