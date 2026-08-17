import { afterEach, describe, expect, it, vi } from 'vitest'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os')
const path = await vi.importActual<typeof import('node:path')>('node:path')
import {
  OrphanWalDatabaseError,
  SQLITE_MAGIC_HEADER,
  assertNoOrphanWalSidecar,
  allocateQuarantineDirectory,
  classifyDatabaseStartupFailure,
  hasOrphanWalSidecar,
  quarantineDatabaseFiles,
  sqliteShmPath,
  sqliteWalPath
} from '../../../src/main/data/databaseStartupRecovery'

const tempDirs: string[] = []

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'deepchat-db-startup-'))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('database startup recovery classification', () => {
  it('classifies leftover WAL without a main file as an orphan sidecar', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(sqliteWalPath(dbPath), 'wal')

    expect(
      classifyDatabaseStartupFailure({
        error: new Error('SQLITE_CANTOPEN: unable to open database file'),
        dbPath
      })
    ).toBe('orphaned-sidecar')
    expect(hasOrphanWalSidecar(dbPath)).toBe(true)
  })

  it('classifies a validated-password failure as true corruption even without a SQLite header', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(dbPath, Buffer.from('not-a-sqlite-header!!'))

    expect(
      classifyDatabaseStartupFailure({
        error: new Error('SQLITE_CORRUPT: malformed page'),
        dbPath,
        password: 'secret'
      })
    ).toBe('true-corruption')
  })

  it('classifies a plaintext SQLite header plus corruption as true corruption', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(dbPath, SQLITE_MAGIC_HEADER)

    expect(
      classifyDatabaseStartupFailure({
        error: new Error('database disk image is malformed'),
        dbPath
      })
    ).toBe('true-corruption')
  })

  it('classifies a truncated header shorter than the SQLite magic as true corruption', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(dbPath, Buffer.from('SQLite'))

    expect(
      classifyDatabaseStartupFailure({
        error: new Error('file is not a database'),
        dbPath
      })
    ).toBe('true-corruption')
  })

  it('classifies a nonempty non-magic file without a password as unreadable', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(dbPath, Buffer.from('encrypted-or-garbage'))

    expect(
      classifyDatabaseStartupFailure({
        error: new Error('file is not a database'),
        dbPath
      })
    ).toBe('unreadable')
  })

  it('treats decrypted page corruption as distinct from a wrong SQLCipher password', async () => {
    const { isDecryptedDatabaseCorruptionError } =
      await import('../../../src/main/data/databaseStartupRecovery')

    expect(isDecryptedDatabaseCorruptionError(new Error('SQLITE_CORRUPT: malformed page'))).toBe(
      true
    )
    expect(isDecryptedDatabaseCorruptionError(new Error('database disk image is malformed'))).toBe(
      true
    )
    expect(isDecryptedDatabaseCorruptionError(new Error('file is not a database'))).toBe(false)
    expect(isDecryptedDatabaseCorruptionError(new Error('SQLITE_NOTADB: invalid header'))).toBe(
      false
    )
  })

  it('ignores leftover SHM without a WAL when the main file is missing', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(sqliteShmPath(dbPath), 'shm')

    expect(hasOrphanWalSidecar(dbPath)).toBe(false)
    expect(
      classifyDatabaseStartupFailure({
        error: new Error('SQLITE_CANTOPEN: unable to open database file'),
        dbPath
      })
    ).toBeNull()
  })

  it('does not treat a zero-byte main file plus WAL as an orphan', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(dbPath, '')
    fs.writeFileSync(sqliteWalPath(dbPath), 'wal')

    expect(hasOrphanWalSidecar(dbPath)).toBe(false)
    expect(() => assertNoOrphanWalSidecar(dbPath)).not.toThrow()
  })
})

describe('database file quarantine', () => {
  it('moves shm, wal, then the main file into a timestamped directory', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(dbPath, 'main')
    fs.writeFileSync(sqliteWalPath(dbPath), 'wal')
    fs.writeFileSync(sqliteShmPath(dbPath), 'shm')

    const directory = allocateQuarantineDirectory(dbPath)
    expect(directory).toMatch(/agent\.db\.corrupt\./)
    expect(fs.existsSync(directory)).toBe(false)
    quarantineDatabaseFiles(dbPath, directory)

    expect(fs.existsSync(dbPath)).toBe(false)
    expect(fs.existsSync(sqliteWalPath(dbPath))).toBe(false)
    expect(fs.existsSync(sqliteShmPath(dbPath))).toBe(false)
    expect(fs.readFileSync(path.join(directory, 'agent.db'), 'utf8')).toBe('main')
    expect(fs.readFileSync(path.join(directory, 'agent.db-wal'), 'utf8')).toBe('wal')
    expect(fs.readFileSync(path.join(directory, 'agent.db-shm'), 'utf8')).toBe('shm')
  })

  it('leaves a remaining main file in place if sidecars were already moved', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(dbPath, 'main')
    fs.writeFileSync(sqliteWalPath(dbPath), 'wal')

    const first = allocateQuarantineDirectory(dbPath)
    quarantineDatabaseFiles(dbPath, first)
    fs.writeFileSync(dbPath, 'main-again')
    const second = allocateQuarantineDirectory(dbPath)
    quarantineDatabaseFiles(dbPath, second)

    expect(first).not.toBe(second)
    expect(fs.existsSync(path.join(first, 'agent.db-wal'))).toBe(true)
    expect(fs.readFileSync(path.join(second, 'agent.db'), 'utf8')).toBe('main-again')
  })

  it('keeps the original WAL when the sidecar move fails after the main file', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(dbPath, 'main')
    fs.writeFileSync(sqliteWalPath(dbPath), 'wal')
    const directory = allocateQuarantineDirectory(dbPath)
    fs.mkdirSync(directory, { recursive: true })
    fs.mkdirSync(path.join(directory, 'agent.db-wal'))

    expect(() => quarantineDatabaseFiles(dbPath, directory)).toThrow()
    expect(fs.existsSync(dbPath)).toBe(false)
    expect(fs.existsSync(sqliteWalPath(dbPath))).toBe(true)
    expect(hasOrphanWalSidecar(dbPath)).toBe(true)

    fs.rmSync(path.join(directory, 'agent.db-wal'), { recursive: true, force: true })
    quarantineDatabaseFiles(dbPath, directory)
    expect(hasOrphanWalSidecar(dbPath)).toBe(false)
    expect(fs.readFileSync(path.join(directory, 'agent.db'), 'utf8')).toBe('main')
    expect(fs.readFileSync(path.join(directory, 'agent.db-wal'), 'utf8')).toBe('wal')
  })
})

describe('orphan WAL guard', () => {
  it('throws before a caller can create a replacement main file', () => {
    const dbPath = path.join(tempDir(), 'agent.db')
    fs.writeFileSync(sqliteWalPath(dbPath), 'wal')

    expect(() => assertNoOrphanWalSidecar(dbPath)).toThrow(OrphanWalDatabaseError)
    expect(fs.existsSync(dbPath)).toBe(false)
  })
})

describe('zero-byte main file with WAL', () => {
  it('opens and replays a zero-byte WAL database when native sqlite is available', async () => {
    const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
    if (!sqliteModule?.default) {
      return
    }

    const Database = sqliteModule.default
    try {
      const probe = new Database(':memory:')
      probe.close()
    } catch {
      return
    }

    const dbPath = path.join(tempDir(), 'agent.db')
    const seed = new Database(dbPath)
    try {
      seed.pragma('journal_mode = WAL')
      seed.pragma('wal_autocheckpoint = 0')
      seed.exec('CREATE TABLE items (id INTEGER PRIMARY KEY); INSERT INTO items (id) VALUES (1);')
    } finally {
      seed.close()
    }

    expect(hasOrphanWalSidecar(dbPath)).toBe(false)
    expect(fs.existsSync(dbPath)).toBe(true)

    if (fs.statSync(dbPath).size > 0) {
      return
    }

    const restored = new Database(dbPath)
    try {
      expect(restored.prepare('SELECT id FROM items').get()).toEqual({ id: 1 })
    } finally {
      restored.close()
    }
  })
})
