import { describe, it, expect, vi } from 'vitest'
import { withBackupReadLock, withBackupSnapshot } from '@/data/backupReadLock'

interface FakeConnection {
  exec: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  inTransaction: boolean
  close: ReturnType<typeof vi.fn>
}

function createConnection(overrides: Partial<FakeConnection> = {}): FakeConnection {
  const connection: FakeConnection = {
    exec: vi.fn(),
    prepare: vi.fn(() => ({ get: vi.fn(() => ({ count: 0 })) })),
    inTransaction: false,
    close: vi.fn(),
    ...overrides
  }
  if (!overrides.exec) {
    connection.exec = vi.fn((sql: string) => {
      if (sql === 'BEGIN') connection.inTransaction = true
      if (sql === 'COMMIT' || sql === 'ROLLBACK') connection.inTransaction = false
    })
  }
  return connection
}

describe('withBackupSnapshot', () => {
  it('rolls back without masking the original error', async () => {
    const connection = createConnection({ inTransaction: true })
    connection.exec.mockImplementation((sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed')
    })

    await expect(
      withBackupSnapshot(
        () => connection as never,
        async () => {
          throw new Error('work failed')
        }
      )
    ).rejects.toThrow('work failed')
    expect(connection.exec).toHaveBeenCalledWith('ROLLBACK')
    expect(connection.close).toHaveBeenCalled()
  })

  it('skips the rollback when BEGIN never opened a transaction', async () => {
    const connection = createConnection()
    connection.exec.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') throw new Error('begin failed')
    })

    await expect(
      withBackupSnapshot(
        () => connection as never,
        async () => undefined
      )
    ).rejects.toThrow('begin failed')
    expect(connection.exec).not.toHaveBeenCalledWith('ROLLBACK')
    expect(connection.close).toHaveBeenCalled()
  })
})

describe('withBackupReadLock', () => {
  it('reports not acquired without opening a connection when the WAL cannot drain', async () => {
    const mainDb = {
      open: true,
      pragma: vi.fn(() => [{ busy: 1, log: 2, checkpointed: 1 }])
    }
    const openDb = vi.fn()

    const outcome = await withBackupReadLock(mainDb as never, openDb, async () => 'result')

    expect(outcome).toEqual({ acquired: false })
    expect(openDb).not.toHaveBeenCalled()
  })

  it('re-drains under the snapshot mark and bails when a commit sneaked in', async () => {
    const mainDb = {
      open: true,
      pragma: vi
        .fn()
        .mockReturnValueOnce([{ busy: 0, log: 1, checkpointed: 1 }])
        .mockReturnValue([{ busy: 0, log: 2, checkpointed: 1 }])
    }
    const connection = createConnection()

    const outcome = await withBackupReadLock(
      mainDb as never,
      () => connection as never,
      async () => 'result'
    )

    expect(outcome).toEqual({ acquired: false })
    expect(connection.exec).toHaveBeenCalledWith('ROLLBACK')
    expect(connection.close).toHaveBeenCalled()
  })
})
