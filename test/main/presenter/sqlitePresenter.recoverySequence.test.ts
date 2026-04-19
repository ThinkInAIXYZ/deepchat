import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn()
}))

describe('sqlitePresenter destructive recovery sequence', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('backs up the live database before closing and cleaning up destructive failures', async () => {
    const { SQLitePresenter } = await import('../../../src/main/presenter/sqlitePresenter')
    const callOrder: string[] = []
    const destructiveError = new Error('SQLITE_CORRUPT: malformed page')

    vi.spyOn(SQLitePresenter.prototype as any, 'initializeDatabase')
      .mockImplementationOnce(function (this: any) {
        callOrder.push('initializeDatabase:first')
        this.db = {
          open: true,
          pragma: vi.fn(),
          close: vi.fn()
        }
        throw destructiveError
      })
      .mockImplementationOnce(() => {
        callOrder.push('initializeDatabase:retry')
      })

    vi.spyOn(SQLitePresenter.prototype as any, 'backupDatabase').mockImplementation(() => {
      callOrder.push('backupDatabase')
    })
    vi.spyOn(SQLitePresenter.prototype as any, 'closeDatabaseSilently').mockImplementation(() => {
      callOrder.push('closeDatabaseSilently')
    })
    vi.spyOn(SQLitePresenter.prototype as any, 'cleanupDatabaseFiles').mockImplementation(() => {
      callOrder.push('cleanupDatabaseFiles')
    })

    new SQLitePresenter('C:/tmp/deepchat-agent.db')

    expect(callOrder).toEqual([
      'initializeDatabase:first',
      'backupDatabase',
      'closeDatabaseSilently',
      'cleanupDatabaseFiles',
      'initializeDatabase:retry'
    ])
  })

  it('attempts destructive recovery at most once when the retry also fails destructively', async () => {
    const { SQLitePresenter } = await import('../../../src/main/presenter/sqlitePresenter')
    const callOrder: string[] = []
    const destructiveError = new Error('SQLITE_CORRUPT: malformed page')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.spyOn(SQLitePresenter.prototype as any, 'initializeDatabase')
      .mockImplementationOnce(function (this: any) {
        callOrder.push('initializeDatabase:first')
        this.db = {
          open: true,
          pragma: vi.fn(),
          close: vi.fn()
        }
        throw destructiveError
      })
      .mockImplementationOnce(function (this: any) {
        callOrder.push('initializeDatabase:retry')
        this.db = {
          open: true,
          pragma: vi.fn(),
          close: vi.fn()
        }
        throw destructiveError
      })

    const backupSpy = vi
      .spyOn(SQLitePresenter.prototype as any, 'backupDatabase')
      .mockImplementation(() => {
        callOrder.push('backupDatabase')
      })
    const closeSpy = vi
      .spyOn(SQLitePresenter.prototype as any, 'closeDatabaseSilently')
      .mockImplementation(() => {
        callOrder.push('closeDatabaseSilently')
      })
    const cleanupSpy = vi
      .spyOn(SQLitePresenter.prototype as any, 'cleanupDatabaseFiles')
      .mockImplementation(() => {
        callOrder.push('cleanupDatabaseFiles')
      })

    expect(() => new SQLitePresenter('C:/tmp/deepchat-agent.db')).toThrow(destructiveError)

    expect(backupSpy).toHaveBeenCalledTimes(1)
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledTimes(2)
    expect(callOrder).toEqual([
      'initializeDatabase:first',
      'backupDatabase',
      'closeDatabaseSilently',
      'cleanupDatabaseFiles',
      'initializeDatabase:retry',
      'closeDatabaseSilently'
    ])
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Destructive database recovery was already attempted once; aborting retry.'
    )
  })
})
