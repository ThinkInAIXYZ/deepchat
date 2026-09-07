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
import { SessionTranscriptMutations } from '@/session/transcriptMutations'

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
    const { calls, entryStore, tape } = createHarness()

    tape.deleteSessionTape('s1')

    expect(calls).toEqual(['entries:s1', 'search:s1'])
    expect(entryStore.runInTransaction).toHaveBeenCalledOnce()
  })

  it('rolls back final Tape deletion when search cleanup fails', () => {
    const { searchProjection, state, tape } = createHarness()
    searchProjection.deleteBySession.mockImplementationOnce(() => {
      throw new Error('search cleanup failed')
    })

    expect(() => tape.deleteSessionTape('s1')).toThrow('search cleanup failed')
    expect(state).toEqual({ entriesPresent: true, searchPresent: true, bootstrapCount: 0 })
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

  it('rolls a reset back when the replacement bootstrap fails', () => {
    const { entryStore, state, tape } = createHarness()
    entryStore.ensureBootstrapAnchor.mockImplementationOnce(() => {
      throw new Error('bootstrap failed')
    })

    expect(() => tape.resetSessionTape('s1')).toThrow('bootstrap failed')
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

  itIfSqlite('rolls back SQLite reset deletion when the replacement bootstrap fails', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const entryStore = new DeepChatTapeEntriesTable(db)
      const searchProjection = new DeepChatTapeSearchProjectionTable(db)
      entryStore.createTable()
      searchProjection.createTable()
      entryStore.ensureBootstrapAnchor('s1')
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
            refs: {},
            createdAt: 100
          }
        ],
        2
      )
      const bootstrapSpy = vi
        .spyOn(entryStore, 'ensureBootstrapAnchor')
        .mockImplementationOnce(() => {
          throw new Error('bootstrap failed')
        })
      const tape = new SessionTape({
        deepchatTapeEntriesTable: entryStore,
        tapeLifecycle: new SqliteTapeLifecycleAdapter(db),
        deepchatTapeSearchProjectionTable: searchProjection
      } as any)

      expect(() => tape.resetSessionTape('s1')).toThrow('bootstrap failed')
      expect(entryStore.getBySession('s1').map((entry) => entry.name)).toEqual([
        'session/start',
        'old/generation'
      ])
      expect(searchProjection.isCurrent('s1', 2)).toBe(true)
      expect(searchProjection.getProjectedEntryIds('s1')).toEqual([2])
      bootstrapSpy.mockRestore()
    } finally {
      db.close()
    }
  })

  itIfSqlite(
    'rolls transcript cleanup back with a failed Tape reset on one connection',
    async () => {
      const db = new DatabaseCtor(':memory:')
      try {
        db.exec(`
        CREATE TABLE clear_pending (session_id TEXT NOT NULL);
        CREATE TABLE clear_transcript (session_id TEXT NOT NULL);
        INSERT INTO clear_pending (session_id) VALUES ('s1');
        INSERT INTO clear_transcript (session_id) VALUES ('s1');
      `)
        const entryStore = new DeepChatTapeEntriesTable(db)
        const searchProjection = new DeepChatTapeSearchProjectionTable(db)
        entryStore.createTable()
        searchProjection.createTable()
        entryStore.ensureBootstrapAnchor('s1')
        entryStore.appendEvent({
          sessionId: 's1',
          name: 'old/generation',
          data: { marker: 'old generation' }
        })
        const tape = new SessionTape({
          deepchatTapeEntriesTable: entryStore,
          tapeLifecycle: new SqliteTapeLifecycleAdapter(db),
          deepchatTapeSearchProjectionTable: searchProjection
        } as any)
        vi.spyOn(searchProjection, 'deleteBySession').mockImplementationOnce(() => {
          throw new Error('search cleanup failed')
        })
        const runtime = {
          prepareClearMessages: vi.fn().mockResolvedValue(undefined),
          finishClearMessages: vi.fn()
        }
        const mutations = new SessionTranscriptMutations({
          pendingInputs: {
            deleteBySession: () =>
              db.prepare('DELETE FROM clear_pending WHERE session_id = ?').run('s1')
          },
          transcript: {
            deleteBySession: () =>
              db.prepare('DELETE FROM clear_transcript WHERE session_id = ?').run('s1')
          },
          settings: { resetTape: () => tape.resetSessionTape('s1') },
          runtime,
          runInTransaction: (operation) => db.transaction(operation)()
        } as any)

        await expect(mutations.clearMessages('s1')).rejects.toThrow('search cleanup failed')

        expect(db.prepare('SELECT COUNT(*) AS count FROM clear_pending').get()).toEqual({
          count: 1
        })
        expect(db.prepare('SELECT COUNT(*) AS count FROM clear_transcript').get()).toEqual({
          count: 1
        })
        expect(entryStore.getBySession('s1').map((entry) => entry.name)).toEqual([
          'session/start',
          'old/generation'
        ])
        expect(runtime.finishClearMessages).not.toHaveBeenCalled()
      } finally {
        vi.restoreAllMocks()
        db.close()
      }
    }
  )

  itIfSqlite('drops corrupt FTS state instead of blocking a Tape generation reset', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const entryStore = new DeepChatTapeEntriesTable(db)
      const searchProjection = new DeepChatTapeSearchProjectionTable(db)
      entryStore.createTable()
      searchProjection.createTable()
      if (!searchProjection.hasFtsReadyForTesting()) return
      entryStore.ensureBootstrapAnchor('s1')
      entryStore.appendEvent({
        sessionId: 's1',
        name: 'old/generation',
        data: { marker: 'private old generation' }
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
            searchText: 'private old generation',
            summaryText: 'private old generation',
            refs: {},
            createdAt: 100
          }
        ],
        2
      )
      const tape = new SessionTape({
        deepchatTapeEntriesTable: entryStore,
        tapeLifecycle: new SqliteTapeLifecycleAdapter(db),
        deepchatTapeSearchProjectionTable: searchProjection
      } as any)
      const prepare = db.prepare.bind(db)
      const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        if (
          sql.trim().replace(/\s+/g, ' ') ===
          'DELETE FROM deepchat_tape_search_fts WHERE session_id = ?'
        ) {
          throw new Error('injected corrupt FTS delete')
        }
        return prepare(sql)
      }) as typeof db.prepare)
      const exec = db.exec.bind(db)
      const execSpy = vi.spyOn(db, 'exec').mockImplementation(((sql: string) => {
        if (sql.trim() === 'DROP TABLE IF EXISTS deepchat_tape_search_fts') {
          throw new Error('injected corrupt FTS drop')
        }
        return exec(sql)
      }) as typeof db.exec)

      expect(() => tape.resetSessionTape('s1')).toThrow('injected corrupt FTS drop')
      expect(entryStore.getBySession('s1').map((entry) => entry.name)).toEqual([
        'session/start',
        'old/generation'
      ])
      expect(searchProjection.isCurrent('s1', 2)).toBe(true)
      execSpy.mockRestore()

      expect(() => tape.resetSessionTape('s1')).not.toThrow()
      prepareSpy.mockRestore()

      expect(entryStore.getBySession('s1')).toMatchObject([{ entry_id: 1, name: 'session/start' }])
      expect(searchProjection.getSessionMeta('s1')).toBeNull()
      expect(searchProjection.getProjectedEntryIds('s1')).toEqual([])
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deepchat_tape_search_fts'"
          )
          .get()
      ).toBeUndefined()
      expect(tape.search('s1', 'private old generation')).toEqual([])
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deepchat_tape_search_fts'"
          )
          .get()
      ).toEqual({ name: 'deepchat_tape_search_fts' })
    } finally {
      vi.restoreAllMocks()
      db.close()
    }
  })
})
