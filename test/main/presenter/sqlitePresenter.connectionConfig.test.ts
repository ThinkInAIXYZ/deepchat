import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'

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

describe('sqlitePresenter connection configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.pragma.mockReset()
    mocks.key.mockReset()
    mocks.close.mockReset()
    mocks.databaseCtor.mockClear()
  })

  it('applies SQLCipher 4 compatibility and key buffer before enabling WAL', async () => {
    const { openSQLiteDatabase } = await import('../../../src/main/presenter/sqlitePresenter')
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
    const { openSQLiteDatabase } = await import('../../../src/main/presenter/sqlitePresenter')
    const dbPath = path.join(process.cwd(), 'agent.db')

    openSQLiteDatabase(dbPath)

    expect(mocks.pragma.mock.calls.map(([statement]) => statement)).toEqual(['journal_mode = WAL'])
  })
})
