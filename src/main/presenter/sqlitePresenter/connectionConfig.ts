import type Database from 'better-sqlite3-multiple-ciphers'

export const SQLCIPHER_COMPATIBILITY_VERSION = 4

export function configureSQLCipherCompatibility(db: Database.Database): void {
  db.pragma("cipher='sqlcipher'")
  db.pragma(`legacy=${SQLCIPHER_COMPATIBILITY_VERSION}`)
}

export function applySQLitePassword(db: Database.Database, password: string): void {
  configureSQLCipherCompatibility(db)
  db.key(Buffer.from(password, 'utf8'))
}

export function configureSQLiteConnection(db: Database.Database, password?: string): void {
  if (password) {
    applySQLitePassword(db, password)
  }

  db.pragma('journal_mode = WAL')
}
