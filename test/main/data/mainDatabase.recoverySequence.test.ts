import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn()
}))

describe('sqlitePresenter destructive recovery sequence', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('closes the connection and rethrows destructive failures without deleting files', async () => {
    const { MainDatabase } = await import('../../../src/main/data/mainDatabase')
    const callOrder: string[] = []
    const destructiveError = new Error('SQLITE_CORRUPT: malformed page')
    const close = vi.fn(() => {
      callOrder.push('close')
    })

    vi.spyOn(MainDatabase.prototype as any, 'initializeDatabase').mockImplementation(
      function (this: any) {
        callOrder.push('initializeDatabase')
        this.db = {
          open: true,
          pragma: vi.fn(),
          close
        }
        throw destructiveError
      }
    )

    expect(() => new MainDatabase('C:/tmp/deepchat-agent.db')).toThrow(destructiveError)
    expect(callOrder).toEqual(['initializeDatabase', 'close'])
    expect(close).toHaveBeenCalledTimes(1)
  })
})
