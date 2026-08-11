import { afterEach } from 'vitest'
import {
  describe,
  expect,
  it,
  vi,
  SessionTape,
  DeepChatExecutionJournalStore,
  DeepChatTapeEntriesTable,
  SqliteTapeLifecycleAdapter,
  DatabaseCtor,
  itIfSqlite,
  createTapeTableMock,
  createRecord
} from './tapeTestHarness'
import { DeepChatContractStore } from '@/tape/infrastructure/sqlite/tapeEntryStore'

afterEach(() => vi.restoreAllMocks())

describe('SessionTape forks', () => {
  it('keeps fork writes isolated until merge and discards fork entries on discard', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      tapeLifecycle: table,
      deepchatTapeSearchProjectionTable: { deleteBySession: vi.fn() },
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const fork = service.createFork('s1', 'fork-1')
    service.appendForkMessageRecord(fork, createRecord({ id: 'fu1', sessionId: 'ignored' }))

    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'message/user')
    ).toBe(false)

    const mergedCount = service.mergeFork('s1', 'fork-1')

    expect(mergedCount).toBe(1)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'message/user')
    ).toBe(true)
    expect(entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/merge')).toBe(
      true
    )
    expect(entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/start')).toBe(
      false
    )

    const discardFork = service.createFork('s1', 'fork-2')
    service.appendForkMessageRecord(discardFork, createRecord({ id: 'fu2', sessionId: 'ignored' }))
    service.discardFork('s1', 'fork-2')

    expect(entries.some((entry) => entry.session_id === discardFork.forkSessionId)).toBe(false)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/discard')
    ).toBe(true)
  })

  it('records exact fork heads and keeps retries bounded to the first merge', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('parent')
    table.appendEvent({ sessionId: 'parent', name: 'parent/tail', data: { value: 1 } })
    const fork = service.createFork('parent', 'bounded')
    table.appendEvent({ sessionId: 'parent', name: 'parent/later', data: { value: 2 } })
    const retriedFork = service.createFork('parent', 'bounded')
    service.appendForkMessageRecord(fork, createRecord({ id: 'first', sessionId: 'ignored' }))

    const forkStart = entries.find(
      (entry) => entry.session_id === fork.forkSessionId && entry.name === 'fork/start'
    )
    expect(fork.parentHeadEntryId).toBe(2)
    expect(retriedFork.parentHeadEntryId).toBe(2)
    expect(JSON.parse(forkStart.payload_json).state.parentHeadEntryId).toBe(2)

    const getBoundedEntries = table.getBySessionUpToEntryId.getMockImplementation()!
    table.getBySessionUpToEntryId.mockImplementationOnce(
      (sessionId: string, maxEntryId: number) => {
        table.appendEvent({
          sessionId: fork.forkSessionId,
          name: 'fork/late-tail',
          data: { value: 2 }
        })
        return getBoundedEntries(sessionId, maxEntryId)
      }
    )

    expect(service.mergeFork('parent', 'bounded')).toBe(1)
    expect(service.mergeFork('parent', 'bounded')).toBe(1)
    expect(() => service.createFork('parent', 'bounded')).toThrow(
      'Fork bounded has already been merged and cannot be reused.'
    )

    const parentEntries = entries.filter((entry) => entry.session_id === 'parent')
    expect(parentEntries.filter((entry) => entry.source_type === 'fork')).toHaveLength(2)
    expect(parentEntries.some((entry) => entry.name === 'fork/late-tail')).toBe(false)
    const receipt = parentEntries.find((entry) => entry.name === 'fork/merge')!
    expect(JSON.parse(receipt.payload_json).data).toMatchObject({
      forkHeadEntryId: 3,
      mergedCount: 1
    })
  })

  it('rolls back mocked fork merge writes when a copied entry fails', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('parent', 'mock-atomic')
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'first', orderSeq: 1, sessionId: 'ignored' })
    )
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'second', orderSeq: 2, sessionId: 'ignored' })
    )

    const append = table.append.getMockImplementation()!
    let copiedEntryCount = 0
    table.append.mockImplementation((input: any) => {
      if (input.sessionId === 'parent' && input.source?.type === 'fork') {
        copiedEntryCount += 1
        if (copiedEntryCount === 2) {
          throw new Error('injected merge failure')
        }
      }
      return append(input)
    })

    expect(() => service.mergeFork('parent', 'mock-atomic')).toThrow('injected merge failure')
    expect(
      entries.filter(
        (entry) =>
          entry.session_id === 'parent' &&
          (entry.source_type === 'fork' || entry.name === 'fork/merge')
      )
    ).toEqual([])
  })

  it('rolls back copied fork entries when the merge receipt fails', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('parent', 'receipt-failure')
    service.appendForkMessageRecord(fork, createRecord({ id: 'first', sessionId: 'ignored' }))

    const appendEvent = table.appendEvent.getMockImplementation()!
    table.appendEvent.mockImplementation((input: any) => {
      if (input.sessionId === 'parent' && input.name === 'fork/merge') {
        throw new Error('injected receipt failure')
      }
      return appendEvent(input)
    })

    expect(() => service.mergeFork('parent', 'receipt-failure')).toThrow('injected receipt failure')
    expect(
      entries.filter(
        (entry) =>
          entry.session_id === 'parent' &&
          (entry.source_type === 'fork' || entry.name === 'fork/merge')
      )
    ).toEqual([])
  })

  it('commits one idempotent receipt for an empty fork', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    service.createFork('parent', 'empty')

    expect(service.mergeFork('parent', 'empty')).toBe(0)
    expect(service.mergeFork('parent', 'empty')).toBe(0)
    const parentEntries = entries.filter((entry) => entry.session_id === 'parent')
    expect(parentEntries).toHaveLength(1)
    expect(parentEntries[0].name).toBe('fork/merge')
    expect(JSON.parse(parentEntries[0].payload_json).data).toMatchObject({
      forkHeadEntryId: 2,
      mergedCount: 0
    })
  })

  it('rejects missing and discarded forks without committing an empty merge receipt', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      tapeLifecycle: table,
      deepchatTapeSearchProjectionTable: { deleteBySession: vi.fn() },
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    expect(() => service.mergeFork('parent', 'missing')).toThrow(
      'Fork missing does not exist or has been discarded.'
    )

    service.createFork('parent', 'discarded')
    service.discardFork('parent', 'discarded')
    expect(() => service.mergeFork('parent', 'discarded')).toThrow(
      'Fork discarded does not exist or has been discarded.'
    )
    expect(
      entries.filter((entry) => entry.session_id === 'parent' && entry.name === 'fork/merge')
    ).toEqual([])
  })

  it('returns an existing merge receipt after the merged fork Tape is cleaned up', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('parent', 'cleanup-after-merge')
    service.appendForkMessageRecord(fork, createRecord({ id: 'merged', sessionId: 'ignored' }))

    expect(service.mergeFork('parent', 'cleanup-after-merge')).toBe(1)
    table.deleteBySession(fork.forkSessionId)
    expect(service.mergeFork('parent', 'cleanup-after-merge')).toBe(1)
  })

  it('merges a legacy fork start that predates the parent head field', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('parent', 'legacy-start')
    const start = entries.find(
      (entry) => entry.session_id === fork.forkSessionId && entry.name === 'fork/start'
    )!
    const payload = JSON.parse(start.payload_json)
    delete payload.state.parentHeadEntryId
    start.payload_json = JSON.stringify(payload)
    service.appendForkMessageRecord(fork, createRecord({ id: 'legacy', sessionId: 'ignored' }))

    expect(service.mergeFork('parent', 'legacy-start')).toBe(1)
  })

  it('accepts a valid legacy fork merge receipt without a frozen head', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/merge',
      source: { type: 'fork', id: 'legacy-receipt', seq: 0 },
      provenanceKey: 'fork:parent:legacy-receipt:merge:event',
      data: {
        forkId: 'legacy-receipt',
        forkSessionId: 'parent::fork::legacy-receipt',
        mergedCount: 2
      }
    })

    expect(service.mergeFork('parent', 'legacy-receipt')).toBe(2)
  })

  it('rejects a malformed stored fork merge receipt instead of reporting an empty merge', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/merge',
      source: { type: 'fork', id: 'malformed-receipt', seq: 0 },
      provenanceKey: 'fork:parent:malformed-receipt:merge:event',
      data: {
        forkId: 'malformed-receipt',
        forkSessionId: 'parent::fork::malformed-receipt',
        mergedCount: 'two'
      }
    })

    expect(() => service.mergeFork('parent', 'malformed-receipt')).toThrow(
      'Stored fork merge receipt is malformed'
    )
  })

  it('keeps external fork receipt identity fields authoritative over metadata', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.ensureBootstrapAnchor('external-child')

    const merge = service.recordExternalForkMerge('parent', 'external-child', 'external-child', {
      forkId: 'spoofed',
      forkSessionId: 'spoofed-session',
      referencedEntryCount: 999,
      taskId: 'task-1'
    })
    const discard = service.recordExternalForkDiscard(
      'parent',
      'external-child',
      'external-child',
      {
        forkId: 'spoofed',
        forkSessionId: 'spoofed-session',
        taskId: 'task-1'
      }
    )

    expect(JSON.parse(merge.payload_json).data).toEqual({
      forkId: 'external-child',
      forkSessionId: 'external-child',
      referencedEntryCount: 1,
      taskId: 'task-1'
    })
    expect(JSON.parse(discard.payload_json).data).toEqual({
      forkId: 'external-child',
      forkSessionId: 'external-child',
      taskId: 'task-1'
    })
  })

  itIfSqlite('rolls back copied fork entries and the receipt when merge fails', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatTapeEntriesTable(db)
    table.createTable()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('parent')
    const fork = service.createFork('parent', 'atomic')
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'first', orderSeq: 1, sessionId: 'ignored' })
    )
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'second', orderSeq: 2, sessionId: 'ignored' })
    )

    const append = table.append.bind(table)
    let copiedEntryCount = 0
    const appendSpy = vi.spyOn(table, 'append').mockImplementation((input) => {
      if (input.sessionId === 'parent' && input.source?.type === 'fork') {
        copiedEntryCount += 1
        if (copiedEntryCount === 2) {
          throw new Error('injected merge failure')
        }
      }
      return append(input)
    })

    expect(() => service.mergeFork('parent', 'atomic')).toThrow('injected merge failure')
    expect(
      table
        .getBySession('parent')
        .filter((entry) => entry.source_type === 'fork' || entry.name === 'fork/merge')
    ).toEqual([])

    appendSpy.mockRestore()
    expect(service.mergeFork('parent', 'atomic')).toBe(2)
    expect(service.mergeFork('parent', 'atomic')).toBe(2)
    expect(
      table.getBySession('parent').filter((entry) => entry.source_type === 'fork')
    ).toHaveLength(3)

    db.close()
  })

  itIfSqlite('rejects missing and discarded forks in SQLite', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      table.createTable()
      const service = new SessionTape({
        deepchatTapeEntriesTable: table,
        tapeLifecycle: new SqliteTapeLifecycleAdapter(db),
        deepchatTapeSearchProjectionTable: { deleteBySession: vi.fn() },
        deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
      } as any)

      expect(() => service.mergeFork('parent', 'missing-native')).toThrow(
        'Fork missing-native does not exist or has been discarded.'
      )
      service.createFork('parent', 'discarded-native')
      service.discardFork('parent', 'discarded-native')
      expect(() => service.mergeFork('parent', 'discarded-native')).toThrow(
        'Fork discarded-native does not exist or has been discarded.'
      )
      expect(table.getBySession('parent').some((entry) => entry.name === 'fork/merge')).toBe(false)
    } finally {
      db.close()
    }
  })

  itIfSqlite('does not copy strict audit facts from a fork', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      const journalStore = new DeepChatExecutionJournalStore(db)
      const contractStore = new DeepChatContractStore(db)
      table.createTable()
      const service = new SessionTape({
        deepchatTapeEntriesTable: table,
        deepchatExecutionJournalStore: journalStore,
        deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
      } as any)

      const fork = service.createFork('parent', 'journal-isolation')
      journalStore.appendExecutionJournalEvent({
        sessionId: fork.forkSessionId,
        name: 'execution/run_started',
        data: { marker: 'must-not-merge' }
      })
      contractStore.appendContractEvent({
        sessionId: fork.forkSessionId,
        name: 'contract/task_frozen',
        data: { marker: 'must-not-merge' }
      })
      expect(
        table
          .getBySession(fork.forkSessionId)
          .some((entry) => entry.name === 'execution/run_started')
      ).toBe(true)
      expect(
        table
          .getBySession(fork.forkSessionId)
          .some((entry) => entry.name === 'contract/task_frozen')
      ).toBe(true)

      expect(service.mergeFork('parent', 'journal-isolation')).toBe(0)
      expect(
        table
          .getBySession('parent')
          .filter(
            (entry) => entry.name?.startsWith('execution/') || entry.name?.startsWith('contract/')
          )
      ).toEqual([])
    } finally {
      db.close()
    }
  })

  it('keeps a failed fork cleanup isolated and makes its discard receipt fail closed', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cleanupError = new Error('projection cleanup failed')
    const { table, entries } = createTapeTableMock()
    const projectionTable = {
      deleteBySession: vi.fn(() => {
        throw cleanupError
      })
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      tapeLifecycle: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const fork = service.createFork('s1', 'fork-cleanup')
    service.appendForkMessageRecord(fork, createRecord({ id: 'fu-cleanup', sessionId: 'ignored' }))
    service.discardFork('s1', 'fork-cleanup')

    expect(table.deleteBySession).toHaveBeenCalledWith(fork.forkSessionId)
    expect(projectionTable.deleteBySession).toHaveBeenCalledWith(fork.forkSessionId)
    expect(entries.some((entry) => entry.session_id === fork.forkSessionId)).toBe(true)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/discard')
    ).toBe(true)
    expect(() => service.mergeFork('s1', 'fork-cleanup')).toThrow(
      'Fork fork-cleanup does not exist or has been discarded.'
    )
    expect(() => service.createFork('s1', 'fork-cleanup')).toThrow(
      'Fork fork-cleanup has been discarded and cannot be reused.'
    )
    expect(warning).toHaveBeenCalledWith('[Tape] Failed to delete fork generation:', cleanupError)
  })

  it('restores fork entries when the discard receipt cannot be appended', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      tapeLifecycle: table,
      deepchatTapeSearchProjectionTable: { deleteBySession: vi.fn() },
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('s1', 'receipt-cleanup')
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'receipt-message', sessionId: 'ignored' })
    )
    const appendEvent = table.appendEvent.getMockImplementation()!
    table.appendEvent.mockImplementation((input: any) => {
      if (input.sessionId === 's1' && input.name === 'fork/discard') {
        throw new Error('discard receipt failed')
      }
      return appendEvent(input)
    })

    expect(() => service.discardFork('s1', 'receipt-cleanup')).toThrow('discard receipt failed')
    expect(entries.some((entry) => entry.session_id === fork.forkSessionId)).toBe(true)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/discard')
    ).toBe(false)
  })
})
