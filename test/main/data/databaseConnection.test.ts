import { beforeEach, describe, expect, it, vi } from 'vitest'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os')
const path = await vi.importActual<typeof import('node:path')>('node:path')

const mocks = vi.hoisted(() => {
  const pragma = vi.fn()
  const key = vi.fn()
  const close = vi.fn()

  return {
    pragma,
    key,
    close,
    databaseCtor: vi.fn(() => ({
      pragma,
      key,
      close
    }))
  }
})

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: mocks.databaseCtor
}))

describe('main database connection configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.pragma.mockReset()
    mocks.key.mockReset()
    mocks.close.mockReset()
    mocks.databaseCtor.mockClear()
  })

  it('applies SQLCipher 4 compatibility and key buffer before enabling WAL', async () => {
    const { openSQLiteDatabase } = await import('../../../src/main/data/databaseConnection')
    const dbPath = path.join(process.cwd(), 'agent.db')
    const password = `pa'ss";--`

    openSQLiteDatabase(dbPath, password)

    expect(mocks.databaseCtor).toHaveBeenCalledWith(dbPath)
    expect(mocks.pragma.mock.calls.map(([statement]) => statement)).toEqual([
      `cipher='sqlcipher'`,
      'legacy=4',
      'journal_mode = WAL'
    ])
    expect(mocks.key).toHaveBeenCalledWith(Buffer.from(password, 'utf8'))
    expect(mocks.key.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.pragma.mock.invocationCallOrder[0]
    )
    expect(mocks.key.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.pragma.mock.invocationCallOrder[1]
    )
    expect(mocks.key.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pragma.mock.invocationCallOrder[2]
    )
    expect(mocks.pragma).not.toHaveBeenCalledWith(expect.stringContaining(password))
  })

  it('enables WAL directly for unencrypted databases', async () => {
    const { openSQLiteDatabase } = await import('../../../src/main/data/databaseConnection')
    const dbPath = path.join(process.cwd(), 'agent.db')

    openSQLiteDatabase(dbPath)

    expect(mocks.pragma.mock.calls.map(([statement]) => statement)).toEqual(['journal_mode = WAL'])
  })

  it('closes the database when connection configuration fails', async () => {
    const failure = new Error('invalid database key')
    mocks.pragma
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw failure
      })
    const { openSQLiteDatabase } = await import('../../../src/main/data/databaseConnection')

    expect(() => openSQLiteDatabase(path.join(process.cwd(), 'agent.db'), 'wrong-key')).toThrow(
      failure
    )
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })

  it('does not create a replacement database when a leftover WAL sidecar exists', async () => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), 'deepchat-orphan-wal-'))
    const dbPath = path.join(directory, 'agent.db')
    fs.writeFileSync(`${dbPath}-wal`, 'wal')
    const { openSQLiteDatabase } = await import('../../../src/main/data/databaseConnection')
    const { OrphanWalDatabaseError } =
      await import('../../../src/main/data/databaseStartupRecovery')

    try {
      expect(() => openSQLiteDatabase(dbPath)).toThrow(OrphanWalDatabaseError)
      expect(mocks.databaseCtor).not.toHaveBeenCalled()
      expect(fs.existsSync(dbPath)).toBe(false)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
