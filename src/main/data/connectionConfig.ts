import type Database from 'better-sqlite3-multiple-ciphers'

export const SQLCIPHER_COMPATIBILITY_VERSION = 4

/**
 * Page cache ceiling in KiB (negative `cache_size` values are KiB). SQLCipher decrypts every page
 * it loads, so the whole-session Tape reads that run before each provider request pay the
 * decryption cost again whenever the session no longer fits in the cache. 64 MiB keeps a
 * 10k-entry session resident; the cache only grows to the pages actually touched.
 */
export const SQLITE_PAGE_CACHE_KIB = 65_536

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
  db.pragma(`cache_size = -${SQLITE_PAGE_CACHE_KIB}`)
}
