import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'

const mocks = vi.hoisted(() => {
  const pragma = vi.fn()
  const close = vi.fn()

  return {
    pragma,
    close,
    databaseCtor: vi.fn(() => ({
      pragma,
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
    mocks.close.mockReset()
    mocks.databaseCtor.mockClear()
  })

  it('applies sqlcipher hex key before enabling WAL for encrypted databases', async () => {
    const { openSQLiteDatabase } = await import('../../../src/main/presenter/sqlitePresenter')
    const dbPath = path.join(process.cwd(), 'agent.db')
    const password = `pa'ss";--`
    const hexPassword = Buffer.from(password, 'utf8').toString('hex')

    openSQLiteDatabase(dbPath, password)

    expect(mocks.databaseCtor).toHaveBeenCalledWith(dbPath)
    expect(mocks.pragma.mock.calls.map(([statement]) => statement)).toEqual([
      `cipher='sqlcipher'`,
      `key = "x'${hexPassword}'"`,
      'journal_mode = WAL'
    ])
    expect(mocks.pragma).not.toHaveBeenCalledWith(expect.stringContaining(password))
  })

  it('enables WAL directly for unencrypted databases', async () => {
    const { openSQLiteDatabase } = await import('../../../src/main/presenter/sqlitePresenter')
    const dbPath = path.join(process.cwd(), 'agent.db')

    openSQLiteDatabase(dbPath)

    expect(mocks.pragma.mock.calls.map(([statement]) => statement)).toEqual(['journal_mode = WAL'])
  })
})
