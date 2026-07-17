import {
  DatabaseCtor,
  DeepChatTapeEntriesTable,
  DeepChatTapeSearchProjectionTable,
  describe,
  expect,
  it,
  itIfSqlite,
  SessionTape,
  SqliteTapeLifecycleAdapter,
  vi
} from './tapeTestHarness'

function createHarness() {
  const calls: string[] = []
  const state = { entriesPresent: true, searchPresent: true, bootstrapCount: 0 }
  const entryStore = {
    runInTransaction: vi.fn((operation: () => unknown) => {
      const snapshot = { ...state }
      try {
        return operation()
      } catch (error) {
        Object.assign(state, snapshot)
        throw error
      }
    }),
    ensureBootstrapAnchor: vi.fn((sessionId: string) => {
      calls.push(`bootstrap:${sessionId}`)
      state.entriesPresent = true
      state.bootstrapCount += 1
    })
  }
  const lifecycle = {
    deleteBySession: vi.fn((sessionId: string) => {
      calls.push(`entries:${sessionId}`)
      state.entriesPresent = false
    })
  }
  const searchProjection = {
    deleteBySession: vi.fn((sessionId: string) => {
      calls.push(`search:${sessionId}`)
      state.searchPresent = false
    })
  }
  const tape = new SessionTape({
    deepchatTapeEntriesTable: entryStore,
    tapeLifecycle: lifecycle,
    deepchatTapeSearchProjectionTable: searchProjection
  } as any)

  return { calls, entryStore, lifecycle, searchProjection, state, tape }
}

describe('SessionTape lifecycle administration', () => {
  it('deletes entries before the search projection', () => {
    const { calls, tape } = createHarness()

    tape.deleteSessionTape('s1')

    expect(calls).toEqual(['entries:s1', 'search:s1'])
  })

  it('rebuilds the bootstrap only after both destructive stores are cleared', () => {
    const { calls, entryStore, tape } = createHarness()

    tape.resetSessionTape('s1')

    expect(calls).toEqual(['entries:s1', 'search:s1', 'bootstrap:s1'])
    expect(entryStore.runInTransaction).toHaveBeenCalledOnce()
  })

  it('does not create a mixed-generation Tape when projection cleanup fails', () => {
    const { entryStore, searchProjection, state, tape } = createHarness()
    searchProjection.deleteBySession.mockImplementationOnce(() => {
      throw new Error('search cleanup failed')
    })

    expect(() => tape.resetSessionTape('s1')).toThrow('search cleanup failed')
    expect(entryStore.ensureBootstrapAnchor).not.toHaveBeenCalled()
    expect(state).toEqual({ entriesPresent: true, searchPresent: true, bootstrapCount: 0 })
  })

  itIfSqlite('rolls back a failed reset and creates a fresh incarnation only on retry', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const entryStore = new DeepChatTapeEntriesTable(db)
      const searchProjection = new DeepChatTapeSearchProjectionTable(db)
      entryStore.createTable()
      searchProjection.createTable()
      entryStore.ensureBootstrapAnchor('s1')
      const oldBootstrap = entryStore.getBySession('s1')[0]
      entryStore.appendEvent({
        sessionId: 's1',
        name: 'old/generation',
        data: { marker: 'old generation' }
      })
      searchProjection.replaceSession(
        's1',
        [
          {
            sessionId: 's1',
            entryId: 2,
            kind: 'event',
            name: 'old/generation',
            sourceType: null,
            sourceId: null,
            sourceSeq: null,
            searchText: 'old generation',
            summaryText: 'old generation',
            refs: { generation: 'old' },
            createdAt: 100
          }
        ],
        2
      )
      const deleteProjection = searchProjection.deleteBySession.bind(searchProjection)
      const deleteProjectionSpy = vi
        .spyOn(searchProjection, 'deleteBySession')
        .mockImplementationOnce(() => {
          throw new Error('search cleanup failed')
        })
      const tape = new SessionTape({
        deepchatTapeEntriesTable: entryStore,
        tapeLifecycle: new SqliteTapeLifecycleAdapter(db),
        deepchatTapeSearchProjectionTable: searchProjection
      } as any)

      expect(() => tape.resetSessionTape('s1')).toThrow('search cleanup failed')
      expect(entryStore.getBySession('s1').map((entry) => entry.name)).toEqual([
        'session/start',
        'old/generation'
      ])
      expect(entryStore.getBySession('s1')[0].meta_json).toBe(oldBootstrap.meta_json)
      expect(searchProjection.isCurrent('s1', 2)).toBe(true)
      expect(searchProjection.getProjectedEntryIds('s1')).toEqual([2])

      deleteProjectionSpy.mockImplementation(deleteProjection)
      tape.resetSessionTape('s1')

      const newEntries = entryStore.getBySession('s1')
      expect(newEntries).toHaveLength(1)
      expect(newEntries[0]).toMatchObject({ entry_id: 1, name: 'session/start' })
      expect(newEntries[0].meta_json).not.toBe(oldBootstrap.meta_json)
      expect(searchProjection.getProjectedEntryIds('s1')).toEqual([])
      expect(searchProjection.getSessionMeta('s1')).toBeNull()
    } finally {
      db.close()
    }
  })

  itIfSqlite('rolls back partial search projection deletion', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const searchProjection = new DeepChatTapeSearchProjectionTable(db)
      searchProjection.createTable()
      searchProjection.replaceSession(
        's1',
        [
          {
            sessionId: 's1',
            entryId: 1,
            kind: 'event',
            name: 'old/generation',
            sourceType: null,
            sourceId: null,
            sourceSeq: null,
            searchText: 'old generation',
            summaryText: 'old generation',
            refs: { generation: 'old' },
            createdAt: 100
          }
        ],
        1
      )
      db.exec(`
        CREATE TRIGGER fail_projection_meta_delete
        BEFORE DELETE ON deepchat_tape_search_projection_meta
        WHEN old.session_id = 's1'
        BEGIN
          SELECT RAISE(ABORT, 'injected projection cleanup failure');
        END;
      `)

      expect(() => searchProjection.deleteBySession('s1')).toThrow(
        'injected projection cleanup failure'
      )
      expect(searchProjection.getProjectedEntryIds('s1')).toEqual([1])
      expect(searchProjection.isCurrent('s1', 1)).toBe(true)
    } finally {
      db.close()
    }
  })
})
