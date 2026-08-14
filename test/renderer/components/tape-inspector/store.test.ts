import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ListTapeInspectorEvidenceOutput,
  ListTapeInspectorPageOutput,
  TapeInspectorEvidenceRecord,
  TapeInspectorFactRecord
} from '@shared/types/tape-inspector'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

const client = vi.hoisted(() => ({
  listTapeInspectorPage: vi.fn(),
  listTapeInspectorEvidence: vi.fn(),
  getTapeInspectorRecordDetail: vi.fn(),
  listMessageTraces: vi.fn()
}))

vi.mock('../../../../src/renderer/api/SessionClient', () => ({
  createSessionClient: () => client
}))

import { useTapeInspectorStore } from '@/components/tape-inspector/store'

function fact(
  entryId: number,
  overrides: Partial<TapeInspectorFactRecord> = {}
): TapeInspectorFactRecord {
  return {
    recordType: 'fact',
    key: `entry:${entryId}`,
    entryId,
    kind: 'event',
    family: 'other',
    name: null,
    createdAt: entryId * 10,
    ...overrides
  }
}

function evidence(traceId: string): TapeInspectorEvidenceRecord {
  return {
    recordType: 'evidence',
    key: `trace:${traceId}`,
    traceId,
    messageId: 'message-1',
    requestSeq: 4,
    physicalAttempt: 0,
    providerId: 'provider-1',
    modelId: 'model-1',
    createdAt: 100,
    truncated: false
  }
}

function page(
  records: TapeInspectorFactRecord[],
  overrides: Partial<Extract<ListTapeInspectorPageOutput, { status: 'ok' }>> = {}
): Extract<ListTapeInspectorPageOutput, { status: 'ok' }> {
  return {
    status: 'ok',
    tapeIncarnationId: 'incarnation-1',
    snapshotMaxEntryId: 20,
    records,
    nextCursor: null,
    ...overrides
  }
}

function evidencePage(
  records: TapeInspectorEvidenceRecord[] = [],
  overrides: Partial<ListTapeInspectorEvidenceOutput> = {}
): ListTapeInspectorEvidenceOutput {
  return { records, nextCursor: null, ...overrides }
}

describe('Tape Inspector store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('loads a scoped tail page, evidence, and request preselection', async () => {
    client.listTapeInspectorPage.mockResolvedValueOnce(
      page(
        [
          fact(20, {
            name: 'provider/attempt_recorded',
            family: 'attempt',
            messageId: 'message-1',
            requestSeq: 4,
            physicalAttempt: 0
          })
        ],
        { nextCursor: { sort: 'entryId', entryId: 19 } }
      )
    )
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage([evidence('trace-1')]))
    const store = useTapeInspectorStore()

    await expect(
      store.initialize('session-1', {
        preselection: { messageId: 'message-1', requestSeq: 4 }
      })
    ).resolves.toBe(true)

    expect(client.listTapeInspectorPage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        mode: 'tail',
        filters: { messageId: 'message-1', requestSeq: 4 }
      })
    )
    expect(client.listTapeInspectorEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'message-1', requestSeq: 4 })
    )
    expect(store.tapeIncarnationId).toBe('incarnation-1')
    expect(store.hasOlder).toBe(true)
    expect(store.selectedRow?.recordType).toBe('group')
    expect(store.selectedRow?.recordType === 'group' && store.selectedRow.group.kind).toBe(
      'request'
    )
  })

  it('prepends and appends pages with stable deduplication', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(
        page([fact(10), fact(11)], { nextCursor: { sort: 'entryId', entryId: 9 } })
      )
      .mockResolvedValueOnce(page([fact(8), fact(9), fact(10, { name: 'updated' })]))
      .mockResolvedValueOnce(page([fact(11), fact(12)], { snapshotMaxEntryId: 12 }))
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')
    store.setPrependScrollAnchor({ key: 'fact:incarnation-1:entry:10', offset: 12 })

    await expect(store.loadOlderPage()).resolves.toBe(true)
    await expect(store.loadNewerPage()).resolves.toBe(true)

    expect(store.records.map((record) => record.entryId)).toEqual([8, 9, 10, 11, 12])
    expect(store.records.find((record) => record.entryId === 10)?.name).toBe('updated')
    expect(store.prependScrollAnchor).toEqual({
      key: 'fact:incarnation-1:entry:10',
      offset: 12
    })
    expect(client.listTapeInspectorPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        mode: 'older',
        expectedTapeIncarnationId: 'incarnation-1',
        cursor: { sort: 'entryId', entryId: 9 }
      })
    )
    expect(client.listTapeInspectorPage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        mode: 'newer',
        expectedTapeIncarnationId: 'incarnation-1',
        cursor: { sort: 'entryId', entryId: 20 }
      })
    )
  })

  it('preserves stable selection while local and server filters hide it', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(10, { name: 'visible' })]))
      .mockResolvedValueOnce(page([]))
    client.listTapeInspectorEvidence
      .mockResolvedValueOnce(evidencePage())
      .mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')
    store.selectRow('fact:incarnation-1:entry:10')

    store.setLoadedSearch('not-present')
    expect(store.selectedKey).toBe('fact:incarnation-1:entry:10')
    expect(store.selectedRow).toBeNull()

    await expect(store.applyServerFilters({ errorsOnly: true })).resolves.toBe(true)
    expect(store.selectedKey).toBe('fact:incarnation-1:entry:10')
    expect(store.selectedRow).toBeNull()
  })

  it('discards a late bootstrap response after switching sessions', async () => {
    const firstPage = deferred<ListTapeInspectorPageOutput>()
    const firstEvidence = deferred<ListTapeInspectorEvidenceOutput>()
    client.listTapeInspectorPage
      .mockReturnValueOnce(firstPage.promise)
      .mockResolvedValueOnce(page([fact(2)], { tapeIncarnationId: 'incarnation-2' }))
    client.listTapeInspectorEvidence
      .mockReturnValueOnce(firstEvidence.promise)
      .mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()

    const firstLoad = store.initialize('session-1')
    const secondLoad = store.initialize('session-2')
    await expect(secondLoad).resolves.toBe(true)
    firstPage.resolve(page([fact(1)]))
    firstEvidence.resolve(evidencePage([evidence('stale')]))
    await expect(firstLoad).resolves.toBe(false)

    expect(store.sessionId).toBe('session-2')
    expect(store.tapeIncarnationId).toBe('incarnation-2')
    expect(store.records.map((record) => record.entryId)).toEqual([2])
    expect(store.evidence).toEqual([])
  })

  it('clears the old incarnation and bootstraps again on reset', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(10)], { nextCursor: { sort: 'entryId', entryId: 9 } }))
      .mockResolvedValueOnce({
        status: 'reset',
        tapeIncarnationId: 'incarnation-2',
        snapshotMaxEntryId: 2
      })
      .mockResolvedValueOnce(
        page([fact(2)], { tapeIncarnationId: 'incarnation-2', snapshotMaxEntryId: 2 })
      )
    client.listTapeInspectorEvidence
      .mockResolvedValueOnce(evidencePage([evidence('old')]))
      .mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')

    await expect(store.loadOlderPage()).resolves.toBe(false)

    expect(store.tapeIncarnationId).toBe('incarnation-2')
    expect(store.records.map((record) => record.entryId)).toEqual([2])
    expect(store.evidence).toEqual([])
  })

  it('fails a contradictory tail reset without retrying indefinitely', async () => {
    client.listTapeInspectorPage.mockResolvedValueOnce({
      status: 'reset',
      tapeIncarnationId: 'incarnation-1',
      snapshotMaxEntryId: 20
    })
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()

    await expect(store.initialize('session-1')).resolves.toBe(false)

    expect(client.listTapeInspectorPage).toHaveBeenCalledOnce()
    expect(store.errorCode).toBe('load_failed')
    expect(store.loadingInitial).toBe(false)
  })

  it('discards a selected evidence detail when selection changes', async () => {
    const traceDetail = deferred<
      Array<{
        id: string
        messageId: string
        sessionId: string
        providerId: string
        modelId: string
        requestSeq: number
        logicalRound: null
        physicalAttempt: number
        endpoint: string
        headersJson: string
        bodyJson: string
        truncated: boolean
        createdAt: number
      }>
    >()
    client.listTapeInspectorPage.mockResolvedValueOnce(
      page([
        fact(20, {
          name: 'provider/attempt_recorded',
          family: 'attempt',
          messageId: 'message-1',
          requestSeq: 4,
          physicalAttempt: 0
        })
      ])
    )
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage([evidence('trace-1')]))
    client.listMessageTraces.mockReturnValueOnce(traceDetail.promise)
    const store = useTapeInspectorStore()
    await store.initialize('session-1')
    store.selectRow('trace:trace-1')

    const load = store.loadSelectedDetail()
    store.selectRow(null)
    traceDetail.resolve([
      {
        id: 'trace-1',
        messageId: 'message-1',
        sessionId: 'session-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        requestSeq: 4,
        logicalRound: null,
        physicalAttempt: 0,
        endpoint: 'https://example.invalid',
        headersJson: '{}',
        bodyJson: '{}',
        truncated: false,
        createdAt: 100
      }
    ])

    await expect(load).resolves.toBe(false)
    expect(store.selectedDetail).toBeNull()
  })

  it('follows a committed head through multiple bounded newer pages', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(20)]))
      .mockResolvedValueOnce(
        page([fact(21), fact(120)], {
          snapshotMaxEntryId: 250,
          nextCursor: { sort: 'entryId', entryId: 120 }
        })
      )
      .mockResolvedValueOnce(page([fact(121), fact(250)], { snapshotMaxEntryId: 250 }))
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')

    await expect(
      store.handleLiveHeadPulse({
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        maxEntryId: 250
      })
    ).resolves.toBe(true)

    expect(store.records.map((record) => record.entryId)).toEqual([20, 21, 120, 121, 250])
    expect(client.listTapeInspectorPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        mode: 'newer',
        cursor: { sort: 'entryId', entryId: 20 }
      })
    )
    expect(client.listTapeInspectorPage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        mode: 'newer',
        cursor: { sort: 'entryId', entryId: 120 }
      })
    )
  })

  it('advances filtered live scans even when no projected records match', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([], { snapshotMaxEntryId: 20 }))
      .mockResolvedValueOnce(
        page([], {
          snapshotMaxEntryId: 300,
          nextCursor: { sort: 'entryId', entryId: 220 }
        })
      )
      .mockResolvedValueOnce(page([], { snapshotMaxEntryId: 300 }))
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1', { filters: { errorsOnly: true } })

    await expect(
      store.handleLiveHeadPulse({
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        maxEntryId: 300
      })
    ).resolves.toBe(false)

    expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(3)
    expect(store.records).toEqual([])
    expect(store.snapshotMaxEntryId).toBe(300)
  })

  it('keeps only the latest head while paused and catches up on resume', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(20)]))
      .mockResolvedValueOnce(page([fact(30)], { snapshotMaxEntryId: 30 }))
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')

    await store.setLivePaused(true)
    await store.handleLiveHeadPulse({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 21
    })
    await store.handleLiveHeadPulse({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 30
    })
    expect(client.listTapeInspectorPage).toHaveBeenCalledOnce()

    await expect(store.setLivePaused(false)).resolves.toBe(true)

    expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(2)
    expect(store.records.map((record) => record.entryId)).toEqual([20, 30])
  })

  it('replaces the projection when a head announces a new incarnation', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(20)]))
      .mockResolvedValueOnce(
        page([fact(2)], { tapeIncarnationId: 'incarnation-2', snapshotMaxEntryId: 2 })
      )
    client.listTapeInspectorEvidence
      .mockResolvedValueOnce(evidencePage([evidence('old')]))
      .mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')
    store.selectRow('fact:incarnation-1:entry:20')

    await expect(
      store.handleLiveHeadPulse({
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-2',
        maxEntryId: 2
      })
    ).resolves.toBe(true)

    expect(store.tapeIncarnationId).toBe('incarnation-2')
    expect(store.records.map((record) => record.entryId)).toEqual([2])
    expect(store.evidence).toEqual([])
    expect(store.selectedKey).toBeNull()
  })

  it('reports a reset discovered during a newer-page pull as a visible change', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(20)]))
      .mockResolvedValueOnce({
        status: 'reset',
        tapeIncarnationId: 'incarnation-2',
        snapshotMaxEntryId: 2
      })
      .mockResolvedValueOnce(
        page([fact(2)], { tapeIncarnationId: 'incarnation-2', snapshotMaxEntryId: 2 })
      )
    client.listTapeInspectorEvidence
      .mockResolvedValueOnce(evidencePage())
      .mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')

    await expect(
      store.handleLiveHeadPulse({
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        maxEntryId: 30
      })
    ).resolves.toBe(true)
    expect(store.tapeIncarnationId).toBe('incarnation-2')
    expect(store.records.map((record) => record.entryId)).toEqual([2])
  })

  it('serializes concurrent pulses and retries a failed catch-up without another pulse', async () => {
    vi.useFakeTimers()
    const firstNewer = deferred<ListTapeInspectorPageOutput>()
    const store = useTapeInspectorStore()
    try {
      client.listTapeInspectorPage
        .mockResolvedValueOnce(page([fact(20)]))
        .mockReturnValueOnce(firstNewer.promise)
        .mockRejectedValueOnce(new Error('temporary read failure'))
        .mockResolvedValueOnce(page([fact(40)], { snapshotMaxEntryId: 40 }))
      client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage())
      await store.initialize('session-1')

      const first = store.handleLiveHeadPulse({
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        maxEntryId: 30
      })
      const concurrent = store.handleLiveHeadPulse({
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        maxEntryId: 40
      })
      expect(store.liveSyncing).toBe(true)
      firstNewer.resolve(
        page([fact(30)], {
          snapshotMaxEntryId: 30
        })
      )

      await expect(concurrent).resolves.toBe(false)
      await expect(first).resolves.toBe(true)
      expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(3)
      expect(store.records.map((record) => record.entryId)).toEqual([20, 30])
      expect(store.liveSyncing).toBe(false)

      await vi.advanceTimersByTimeAsync(1_000)

      expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(4)
      expect(store.records.map((record) => record.entryId)).toEqual([20, 30, 40])
    } finally {
      store.clear()
      vi.useRealTimers()
    }
  })
})
