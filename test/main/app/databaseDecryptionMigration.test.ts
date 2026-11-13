import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openSQLiteDatabase } from '@/data/databaseConnection'
import { DatabaseSecurityService } from '@/app/databaseSecurity'

vi.unmock('fs')
vi.unmock('node:fs')

const state = vi.hoisted(() => ({ metadata: {} as Record<string, unknown> }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', quit: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('electron-store', () => ({
  default: class {
    get() {
      return state.metadata
    }
    set(_key: string, metadata: Record<string, unknown>) {
      state.metadata = metadata
    }
  }
}))
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

function encryptedFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'dc-decryption-'))
  directories.push(directory)
  const file = path.join(directory, 'agent.db')
  let password: string | undefined = 'legacy-test-password'
  let db = openSQLiteDatabase(file, password)
  db.exec(
    "CREATE TABLE new_sessions(id TEXT PRIMARY KEY); INSERT INTO new_sessions VALUES ('preserved');"
  )
  state.metadata = { version: 1, enabled: true, cipher: 'sqlcipher', passwordStorage: 'manual' }
  const security = new DatabaseSecurityService({ dbPath: file })
  const port = {
    getDatabasePath: () => file,
    getDatabasePassword: () => password,
    checkpointAndClose: () => {
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.close()
    },
    close: () => db.close(),
    reopenWithPassword: (next?: string) => {
      db = openSQLiteDatabase(file, next)
      password = next
    },
    isOpen: () => db.open
  }
  return { directory, file, security, port, database: () => db }
}

it('decrypts once, preserves an encrypted recovery copy and resumes without a password', async () => {
  const fixture = encryptedFixture()
  try {
    await fixture.security.migrateLegacyEncryption(fixture.port)
    expect(fixture.port.getDatabasePassword()).toBeUndefined()
    expect(fixture.database().prepare('SELECT id FROM new_sessions').get()).toEqual({
      id: 'preserved'
    })
    expect(readFileSync(fixture.file).subarray(0, 16).toString()).toBe('SQLite format 3\0')
    expect(fixture.security.getStatus()).toMatchObject({ enabled: false, passwordStorage: 'none' })
    const backup = readdirSync(fixture.directory).find((name) =>
      name.includes('.legacy-encrypted.')
    )!
    expect(backup).toBeTruthy()
    expect(readFileSync(path.join(fixture.directory, backup)).subarray(0, 16).toString()).not.toBe(
      'SQLite format 3\0'
    )
    const original = openSQLiteDatabase(
      path.join(fixture.directory, backup),
      'legacy-test-password'
    )
    try {
      expect(original.prepare('SELECT id FROM new_sessions').get()).toEqual({ id: 'preserved' })
    } finally {
      original.close()
    }
    await fixture.security.migrateLegacyEncryption(fixture.port)
    expect(
      readdirSync(fixture.directory).filter((name) => name.includes('.legacy-encrypted.'))
    ).toHaveLength(1)
    // Simulate an exit after the file replacement, before metadata persistence.
    state.metadata = { version: 1, enabled: true, cipher: 'sqlcipher', passwordStorage: 'manual' }
    const unlock = vi.fn()
    await expect(fixture.security.resolveStartupPassword(unlock)).resolves.toBeUndefined()
    expect(unlock).not.toHaveBeenCalled()
    expect(fixture.security.getStatus().enabled).toBe(false)
    await expect(fixture.security.enableEncryption({} as never)).rejects.toThrow('retired')
    await expect(fixture.security.changePassword({} as never)).rejects.toThrow('retired')
  } finally {
    fixture.port.close()
  }
})

it('restores the encrypted database if the decrypted replacement cannot reopen', async () => {
  const fixture = encryptedFixture()
  const reopen = fixture.port.reopenWithPassword
  fixture.port.reopenWithPassword = (password) => {
    if (password === undefined) throw new Error('injected replacement failure')
    reopen(password)
  }
  try {
    await expect(fixture.security.migrateLegacyEncryption(fixture.port)).rejects.toThrow(
      'replacement failure'
    )
    expect(fixture.port.getDatabasePassword()).toBe('legacy-test-password')
    expect(fixture.database().prepare('SELECT id FROM new_sessions').get()).toEqual({
      id: 'preserved'
    })
    expect(fixture.security.getStatus().enabled).toBe(true)
    expect(readdirSync(fixture.directory).some((name) => name.includes('.legacy-encrypted.'))).toBe(
      true
    )
  } finally {
    fixture.port.close()
  }
})

it('decrypts an extracted legacy backup without changing active database metadata', () => {
  const fixture = encryptedFixture()
  fixture.port.checkpointAndClose()
  const target = path.join(fixture.directory, 'decrypted.db')
  fixture.security.decryptLegacyBackup(fixture.file, target, 'legacy-test-password')
  const db = openSQLiteDatabase(target)
  try {
    expect(db.prepare('SELECT id FROM new_sessions').get()).toEqual({ id: 'preserved' })
  } finally {
    db.close()
  }
  expect(fixture.security.getStatus().enabled).toBe(true)
  expect(readFileSync(fixture.file).subarray(0, 16).toString()).not.toBe('SQLite format 3\0')
})
