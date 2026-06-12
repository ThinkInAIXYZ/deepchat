import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn()
}))

describe('sqlitePresenter error classification', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('keeps corruption errors classified as destructive', async () => {
    const { isDestructiveDatabaseError } =
      await import('../../../src/main/presenter/sqlitePresenter')

    expect(isDestructiveDatabaseError(new Error('database disk image is malformed'))).toBe(true)
    expect(isDestructiveDatabaseError(new Error('file is not a database'))).toBe(true)
    expect(isDestructiveDatabaseError(new Error('SQLITE_CORRUPT: corrupted page'))).toBe(true)
    expect(isDestructiveDatabaseError(new Error('SQLITE_NOTADB: invalid header'))).toBe(true)
  })

  it('treats open failures as non-destructive', async () => {
    const { isDestructiveDatabaseError } =
      await import('../../../src/main/presenter/sqlitePresenter')

    expect(
      isDestructiveDatabaseError(new Error('SQLITE_CANTOPEN: unable to open database file'))
    ).toBe(false)
    expect(isDestructiveDatabaseError(new Error('unable to open database file'))).toBe(false)
  })
})
