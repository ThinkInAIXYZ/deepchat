import { describe, expect, it, vi } from 'vitest'
import { SessionTape } from '@/session/data/tape'

function createHarness() {
  const calls: string[] = []
  const entryStore = {
    ensureBootstrapAnchor: vi.fn((sessionId: string) => {
      calls.push(`bootstrap:${sessionId}`)
    })
  }
  const lifecycle = {
    deleteBySession: vi.fn((sessionId: string) => {
      calls.push(`entries:${sessionId}`)
    })
  }
  const searchProjection = {
    deleteBySession: vi.fn((sessionId: string) => {
      calls.push(`search:${sessionId}`)
    })
  }
  const tape = new SessionTape({
    deepchatTapeEntriesTable: entryStore,
    tapeLifecycle: lifecycle,
    deepchatTapeSearchProjectionTable: searchProjection
  } as any)

  return { calls, entryStore, lifecycle, searchProjection, tape }
}

describe('SessionTape lifecycle administration', () => {
  it('deletes entries before the search projection', () => {
    const { calls, tape } = createHarness()

    tape.deleteSessionTape('s1')

    expect(calls).toEqual(['entries:s1', 'search:s1'])
  })

  it('rebuilds the bootstrap only after both destructive stores are cleared', () => {
    const { calls, tape } = createHarness()

    tape.resetSessionTape('s1')

    expect(calls).toEqual(['entries:s1', 'search:s1', 'bootstrap:s1'])
  })

  it('does not create a mixed-generation Tape when projection cleanup fails', () => {
    const { entryStore, searchProjection, tape } = createHarness()
    searchProjection.deleteBySession.mockImplementationOnce(() => {
      throw new Error('search cleanup failed')
    })

    expect(() => tape.resetSessionTape('s1')).toThrow('search cleanup failed')
    expect(entryStore.ensureBootstrapAnchor).not.toHaveBeenCalled()
  })
})
