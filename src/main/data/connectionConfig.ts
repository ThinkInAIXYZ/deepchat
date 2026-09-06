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
  // NORMAL is what every connection has been running with: the bundled
  // better-sqlite3-multiple-ciphers build compiles in SQLITE_DEFAULT_WAL_SYNCHRONOUS=1, which
  // applies only while the application never sets the pragma itself. Stating it here keeps the
  // durability contract (commits survive a process crash, a power loss may drop the newest
  // committed transactions but never corrupts the file) independent of that build flag.
  db.pragma('synchronous = NORMAL')
  // 64 MiB page cache ceiling (negative = KiB) for every connection opened through this helper.
  // It is sized for the main database: SQLCipher decrypts every page it loads, so the whole-session
  // Tape reads before each provider request must stay resident to be cheap. Other connections
  // (importer, OCR store, utility hosts) only grow the cache to the pages they actually touch.
  db.pragma('cache_size = -65536')
}
