import { createPinia, setActivePinia } from 'pinia'
import { isProxy, isReactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ListTapeInspectorEvidenceOutput,
  ListTapeInspectorPageOutput,
  ResolveTapeInspectorEvidenceEntriesInput,
  ResolveTapeInspectorEvidenceEntriesOutput,
  TapeInspectorEvidenceRecord,
  TapeInspectorFactRecord
} from '@shared/types/tape-inspector'

// The renderer setup uses a lightweight Pinia mock; this store test needs the real implementation.
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
  resolveTapeInspectorEvidenceEntries: vi.fn(),
  getTapeInspectorRecordDetail: vi.fn(),
  listMessageTraces: vi.fn()
}))

vi.mock('../../../../src/renderer/api/SessionClient', () => ({
  createSessionClient: () => client
}))

import { useTapeInspectorStore } from '@/components/tape-inspector/store'
import {
  DIAGNOSTIC_EVIDENCE_LANE_KEY,
  EARLIER_EVIDENCE_LANE_KEY
} from '@/components/tape-inspector/model'

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

function evidence(
  traceId: string,
  overrides: Partial<TapeInspectorEvidenceRecord> = {}
): TapeInspectorEvidenceRecord {
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
    truncated: false,
    ...overrides
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
  return { records, nextCursor: null, newerCursor: null, ...overrides }
}

function expectIpcCloneable(input: unknown, cursor: unknown): void {
  expect(isProxy(cursor)).toBe(false)
  expect(isReactive(cursor)).toBe(false)
  expect(() => structuredClone(input)).not.toThrow()
}

describe('Tape Inspector store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.resolveTapeInspectorEvidenceEntries.mockImplementation(
      async (
        input: ResolveTapeInspectorEvidenceEntriesInput
      ): Promise<ResolveTapeInspectorEvidenceEntriesOutput> => ({
        status: 'ok',
        tapeIncarnationId: input.expectedTapeIncarnationId,
        resolutions: input.identities.map((identity) => ({ ...identity, entryId: null }))
      })
    )
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
    expect(store.selectedRow?.recordType).toBe('fact')
    expect(store.selectedRow?.recordType === 'fact' && store.selectedRow.record.requestSeq).toBe(4)
  })

  it('defaults diagnostics to collapsed while keeping model requests discoverable', async () => {
    client.listTapeInspectorPage.mockResolvedValueOnce(page([fact(20)]))
    client.listTapeInspectorEvidence.mockResolvedValueOnce(
      evidencePage([
        evidence('diagnostic', { requestSeq: 0, physicalAttempt: undefined }),
        evidence('standalone', { requestSeq: 9, physicalAttempt: 2 })
      ])
    )
    const store = useTapeInspectorStore()

    await store.initialize('session-1')

    expect(store.collapsedKeys.has(DIAGNOSTIC_EVIDENCE_LANE_KEY)).toBe(true)
    expect(store.rows.some((row) => row.key === DIAGNOSTIC_EVIDENCE_LANE_KEY)).toBe(true)
    expect(store.rows.some((row) => row.key === 'trace:diagnostic')).toBe(false)
    expect(store.rows.some((row) => row.key === 'trace:standalone')).toBe(true)

    store.toggleCollapsed(DIAGNOSTIC_EVIDENCE_LANE_KEY)
    expect(store.rows.some((row) => row.key === 'trace:diagnostic')).toBe(true)
  })

  it('loads exact parent Entries in bounded contiguous batches that can be continued', async () => {
    const parent = fact(1, {
      name: 'provider/attempt_completed',
      family: 'attempt',
      messageId: 'message-1',
      requestSeq: 4,
      physicalAttempt: 0
    })
    client.listTapeInspectorPage
      .mockResolvedValueOnce(
        page([fact(100)], {
          snapshotMaxEntryId: 100,
          nextCursor: { sort: 'entryId', entryId: 100 }
        })
      )
      .mockResolvedValueOnce(
        page([fact(90)], {
          snapshotMaxEntryId: 100,
          nextCursor: { sort: 'entryId', entryId: 90 }
        })
      )
      .mockResolvedValueOnce(
        page([fact(80)], {
          snapshotMaxEntryId: 100,
          nextCursor: { sort: 'entryId', entryId: 80 }
        })
      )
      .mockResolvedValueOnce(
        page([fact(70)], {
          snapshotMaxEntryId: 100,
          nextCursor: { sort: 'entryId', entryId: 70 }
        })
      )
      .mockResolvedValueOnce(
        page([fact(60)], {
          snapshotMaxEntryId: 100,
          nextCursor: { sort: 'entryId', entryId: 60 }
        })
      )
      .mockResolvedValueOnce(
        page([fact(50)], {
          snapshotMaxEntryId: 100,
          nextCursor: { sort: 'entryId', entryId: 50 }
        })
      )
      .mockResolvedValueOnce(
        page([fact(40)], {
          snapshotMaxEntryId: 100,
          nextCursor: { sort: 'entryId', entryId: 40 }
        })
      )
      .mockResolvedValueOnce(page([parent], { snapshotMaxEntryId: 100 }))
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage([evidence('trace-1')]))
    client.resolveTapeInspectorEvidenceEntries.mockResolvedValueOnce({
      status: 'ok',
      tapeIncarnationId: 'incarnation-1',
      resolutions: [
        {
          messageId: 'message-1',
          requestSeq: 4,
          physicalAttempt: 0,
          entryId: 1
        }
      ]
    })
    const store = useTapeInspectorStore()
    await store.initialize('session-1')

    expect(store.hasEarlierEvidenceEntries).toBe(true)
    expect(store.canLoadEvidenceParents).toBe(true)
    await store.setTimelineMode('sequence')
    expect(store.rows.some((row) => row.key === EARLIER_EVIDENCE_LANE_KEY)).toBe(true)

    await expect(store.loadEarlierEvidenceEntries()).resolves.toBe(true)

    expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(7)
    expect(store.hasEarlierEvidenceEntries).toBe(true)
    expect(store.canLoadEvidenceParents).toBe(true)

    await expect(store.loadEarlierEvidenceEntries()).resolves.toBe(true)

    expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(8)
    expect(store.hasEarlierEvidenceEntries).toBe(false)
    expect(store.rows.some((row) => row.key === EARLIER_EVIDENCE_LANE_KEY)).toBe(false)
    const trace = store.rows.find((row) => row.key === 'trace:trace-1')
    expect(trace?.recordType === 'evidence' && trace.association).toBe('attempt')
  })

  it('upgrades a pending request when its exact completed attempt arrives live', async () => {
    client.listTapeInspectorPage.mockResolvedValueOnce(page([fact(20)])).mockResolvedValueOnce(
      page(
        [
          fact(21, {
            name: 'provider/attempt_completed',
            family: 'attempt',
            messageId: 'message-1',
            requestSeq: 4,
            physicalAttempt: 0
          })
        ],
        { snapshotMaxEntryId: 21 }
      )
    )
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage([evidence('trace-1')]))
    const store = useTapeInspectorStore()
    await store.initialize('session-1')

    const pending = store.rows.find((row) => row.key === 'trace:trace-1')
    expect(pending?.recordType === 'evidence' && pending.association).toBe('not_recorded')

    await store.handleLiveHeadPulse({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 21
    })

    const completed = store.rows.find((row) => row.key === 'trace:trace-1')
    expect(completed?.recordType === 'evidence' && completed.association).toBe('attempt')
  })

  it('reveals only the collapsed ancestors of a timeline selection', async () => {
    client.listTapeInspectorPage.mockResolvedValueOnce(
      page([
        fact(20, {
          runId: 'run-1',
          messageId: 'message-1',
          requestSeq: 4,
          physicalAttempt: 0
        })
      ])
    )
    client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')
    await store.setTimelineMode('sequence')
    const run = store.overviewRows.find(
      (row) => row.recordType === 'group' && row.group.kind === 'run'
    )
    const request = store.overviewRows.find(
      (row) => row.recordType === 'group' && row.group.kind === 'request'
    )
    const factKey = 'fact:incarnation-1:entry:20'
    if (!run || !request) throw new Error('Expected run and request groups')
    store.toggleCollapsed(run.key)
    store.toggleCollapsed(request.key)

    expect(store.rows.some((row) => row.key === factKey)).toBe(false)
    expect(store.revealOverviewRow(factKey)).toBe(true)
    expect(store.selectedRow?.key).toBe(factKey)
    expect(store.collapsedKeys.has(run.key)).toBe(false)
    expect(store.collapsedKeys.has(request.key)).toBe(false)
  })

  it('polls bounded newer evidence while active and stops when paused or cleared', async () => {
    vi.useFakeTimers()
    const store = useTapeInspectorStore()
    try {
      client.listTapeInspectorPage.mockResolvedValueOnce(page([fact(20)]))
      client.listTapeInspectorEvidence
        .mockResolvedValueOnce(evidencePage())
        .mockResolvedValueOnce(
          evidencePage(
            [evidence('trace-a', { createdAt: 100 }), evidence('trace-b', { createdAt: 100 })],
            {
              nextCursor: null,
              newerCursor: { rowId: 2 }
            }
          )
        )
        .mockResolvedValueOnce(
          evidencePage(
            [evidence('trace-b', { createdAt: 100 }), evidence('trace-c', { createdAt: 200 })],
            { newerCursor: { rowId: 3 } }
          )
        )
      await store.initialize('session-1')
      store.startEvidenceRefresh()

      await vi.advanceTimersByTimeAsync(1_000)

      expect(client.listTapeInspectorEvidence).toHaveBeenNthCalledWith(2, {
        sessionId: 'session-1',
        mode: 'newer',
        limit: 100
      })
      expect(store.evidence.map((record) => record.traceId)).toEqual(['trace-a', 'trace-b'])
      expect(store.liveEvidenceRevision).toBe(1)

      await vi.advanceTimersByTimeAsync(1_000)

      expect(client.listTapeInspectorEvidence).toHaveBeenNthCalledWith(3, {
        sessionId: 'session-1',
        mode: 'newer',
        cursor: { rowId: 2 },
        limit: 100
      })
      expect(store.evidence.map((record) => record.traceId)).toEqual([
        'trace-a',
        'trace-b',
        'trace-c'
      ])
      expect(store.liveEvidenceRevision).toBe(2)

      await store.setLivePaused(true)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(client.listTapeInspectorEvidence).toHaveBeenCalledTimes(3)

      client.listTapeInspectorEvidence.mockResolvedValueOnce(
        evidencePage([evidence('trace-d', { createdAt: 300 })], {
          newerCursor: { rowId: 4 }
        })
      )
      await expect(store.setLivePaused(false)).resolves.toBe(true)
      expect(client.listTapeInspectorEvidence).toHaveBeenLastCalledWith({
        sessionId: 'session-1',
        mode: 'newer',
        cursor: { rowId: 3 },
        limit: 100
      })
      expect(store.evidence.map((record) => record.traceId)).toContain('trace-d')
      expect(store.liveEvidenceRevision).toBe(3)

      store.clear()
      expect(store.liveEvidenceRevision).toBe(0)
      client.listTapeInspectorEvidence.mockResolvedValueOnce(
        evidencePage([evidence('trace-after-clear')])
      )
      await vi.advanceTimersByTimeAsync(2_000)
      expect(client.listTapeInspectorEvidence).toHaveBeenCalledTimes(4)
    } finally {
      store.clear()
      vi.useRealTimers()
    }
  })

  it('discards an evidence refresh that finishes while Live is paused', async () => {
    vi.useFakeTimers()
    const store = useTapeInspectorStore()
    try {
      const pendingRefresh = deferred<ListTapeInspectorEvidenceOutput>()
      client.listTapeInspectorPage.mockResolvedValueOnce(page([fact(20)]))
      client.listTapeInspectorEvidence
        .mockResolvedValueOnce(evidencePage())
        .mockReturnValueOnce(pendingRefresh.promise)
      await store.initialize('session-1')
      store.startEvidenceRefresh()

      await vi.advanceTimersByTimeAsync(1_000)
      await store.setLivePaused(true)
      pendingRefresh.resolve(
        evidencePage([evidence('trace-after-pause')], { newerCursor: { rowId: 1 } })
      )
      await pendingRefresh.promise
      await Promise.resolve()

      expect(store.evidence).toEqual([])
    } finally {
      store.clear()
      vi.useRealTimers()
    }
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

  it('keeps pagination cursors cloneable across the renderer IPC boundary', async () => {
    vi.useFakeTimers()
    const store = useTapeInspectorStore()
    try {
      client.listTapeInspectorPage
        .mockResolvedValueOnce(page([fact(10)], { nextCursor: { sort: 'entryId', entryId: 9 } }))
        .mockResolvedValueOnce(page([fact(9)]))
        .mockResolvedValueOnce(page([fact(11)], { snapshotMaxEntryId: 11 }))
      client.listTapeInspectorEvidence
        .mockResolvedValueOnce(
          evidencePage([evidence('trace-2', { createdAt: 200 })], {
            nextCursor: { createdAt: 200, traceId: 'trace-2' },
            newerCursor: { rowId: 2 }
          })
        )
        .mockResolvedValueOnce(evidencePage([evidence('trace-1', { createdAt: 100 })]))
        .mockResolvedValueOnce(
          evidencePage([evidence('trace-3', { createdAt: 300 })], {
            newerCursor: { rowId: 3 }
          })
        )

      await store.initialize('session-1')
      await store.loadOlderPage()
      await store.loadNewerPage()
      await store.loadMoreEvidence()
      store.startEvidenceRefresh()
      await vi.advanceTimersByTimeAsync(1_000)

      const olderPageInput = client.listTapeInspectorPage.mock.calls[1][0]
      const newerPageInput = client.listTapeInspectorPage.mock.calls[2][0]
      const olderEvidenceInput = client.listTapeInspectorEvidence.mock.calls[1][0]
      const newerEvidenceInput = client.listTapeInspectorEvidence.mock.calls[2][0]

      expectIpcCloneable(olderPageInput, olderPageInput.cursor)
      expectIpcCloneable(newerPageInput, newerPageInput.cursor)
      expectIpcCloneable(olderEvidenceInput, olderEvidenceInput.cursor)
      expectIpcCloneable(newerEvidenceInput, newerEvidenceInput.cursor)
    } finally {
      store.clear()
      vi.useRealTimers()
    }
  })

  it('keeps local-search selection but clears it when server filters remove the row', async () => {
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
    expect(store.selectedKey).toBeNull()
    expect(store.selectedRow).toBeNull()
  })

  it('clears a selected group that does not exist in flat global sort results', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(20, { runId: 'run-1' })]))
      .mockResolvedValueOnce(page([fact(20, { name: 'alpha', runId: 'run-1' })]))
    client.listTapeInspectorEvidence
      .mockResolvedValueOnce(evidencePage())
      .mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')
    await store.setTimelineMode('sequence')
    const group = store.rows.find((row) => row.recordType === 'group')
    expect(group).toBeDefined()
    store.selectRow(group!.key)

    await expect(store.applyServerSort({ column: 'name', direction: 'asc' })).resolves.toBe(true)

    expect(store.selectedKey).toBeNull()
    expect(store.selectedRow).toBeNull()
  })

  it('uses flat server order for global sorts and suspends live insertion', async () => {
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(20)]))
      .mockResolvedValueOnce(
        page([
          fact(20, { name: 'alpha', runId: 'run-1' }),
          fact(10, { name: 'beta', runId: 'run-1' })
        ])
      )
      .mockResolvedValueOnce(page([fact(20), fact(10)]))
    client.listTapeInspectorEvidence
      .mockResolvedValueOnce(evidencePage())
      .mockResolvedValueOnce(evidencePage())
      .mockResolvedValueOnce(evidencePage())
    const store = useTapeInspectorStore()
    await store.initialize('session-1')

    await expect(store.applyServerSort({ column: 'name', direction: 'asc' })).resolves.toBe(true)

    expect(client.listTapeInspectorPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { column: 'name', direction: 'asc' } })
    )
    expect(store.records.map((record) => record.entryId)).toEqual([20, 10])
    expect(store.rows.map((row) => row.recordType)).toEqual(['fact', 'fact'])
    expect(store.canonicalSort).toBe(false)
    expect(store.timelineMode).toBe('sequence')

    await store.handleLiveHeadPulse({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 21
    })
    expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(2)

    await expect(store.setTimelineMode('actual')).resolves.toBe(true)
    expect(client.listTapeInspectorPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { column: 'entryId', direction: 'asc' } })
    )
    expect(store.canonicalSort).toBe(true)
    expect(store.timelineMode).toBe('actual')
  })

  it('fills bounded fact and evidence pages until the loaded search finds a match', async () => {
    vi.useFakeTimers()
    const store = useTapeInspectorStore()
    try {
      client.listTapeInspectorPage
        .mockResolvedValueOnce(
          page([fact(20, { name: 'recent' })], {
            nextCursor: { sort: 'entryId', entryId: 19 }
          })
        )
        .mockResolvedValueOnce(
          page([fact(19, { name: 'older' })], {
            nextCursor: { sort: 'entryId', entryId: 18 }
          })
        )
      client.listTapeInspectorEvidence
        .mockResolvedValueOnce(
          evidencePage([evidence('recent-trace')], {
            nextCursor: { createdAt: 100, traceId: 'recent-trace' }
          })
        )
        .mockResolvedValueOnce(
          evidencePage([
            evidence('matching-trace', {
              providerId: 'target-provider',
              createdAt: 90
            })
          ])
        )
      await store.initialize('session-1')

      store.setLoadedSearch('target-provider')
      expect(store.loadingSearchFill).toBe(true)
      await vi.advanceTimersByTimeAsync(250)

      expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(2)
      expect(client.listTapeInspectorEvidence).toHaveBeenCalledTimes(2)
      expect(store.evidence.map((record) => record.traceId)).toContain('matching-trace')
      expect(store.rows.some((row) => row.key === 'trace:matching-trace')).toBe(true)
      expect(store.loadingSearchFill).toBe(false)
    } finally {
      store.clear()
      vi.useRealTimers()
    }
  })

  it('cancels superseded search debounce and stops after six supplemental pages', async () => {
    vi.useFakeTimers()
    const store = useTapeInspectorStore()
    try {
      client.listTapeInspectorPage.mockResolvedValueOnce(
        page([fact(20, { name: 'recent' })], {
          nextCursor: { sort: 'entryId', entryId: 19 }
        })
      )
      for (let entryId = 19; entryId >= 14; entryId -= 1) {
        client.listTapeInspectorPage.mockResolvedValueOnce(
          page([fact(entryId, { name: 'not-a-match' })], {
            nextCursor: { sort: 'entryId', entryId: entryId - 1 }
          })
        )
      }
      client.listTapeInspectorEvidence.mockResolvedValueOnce(evidencePage())
      await store.initialize('session-1')

      store.setLoadedSearch('superseded-query')
      store.setLoadedSearch('missing-target')
      await vi.advanceTimersByTimeAsync(250)

      expect(store.loadedSearch).toBe('missing-target')
      expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(7)
      expect(store.hasOlder).toBe(true)
      expect(store.rows).toEqual([])
      expect(store.loadingSearchFill).toBe(false)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(client.listTapeInspectorPage).toHaveBeenCalledTimes(7)
    } finally {
      store.clear()
      vi.useRealTimers()
    }
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

  it('discards late evidence resolutions after switching sessions', async () => {
    const firstResolution = deferred<ResolveTapeInspectorEvidenceEntriesOutput>()
    client.listTapeInspectorPage
      .mockResolvedValueOnce(page([fact(1)]))
      .mockResolvedValueOnce(page([fact(2)], { tapeIncarnationId: 'incarnation-2' }))
    client.listTapeInspectorEvidence
      .mockResolvedValueOnce(evidencePage([evidence('stale')]))
      .mockResolvedValueOnce(evidencePage())
    client.resolveTapeInspectorEvidenceEntries.mockReturnValueOnce(firstResolution.promise)
    const store = useTapeInspectorStore()

    const firstLoad = store.initialize('session-1')
    await vi.waitFor(() =>
      expect(client.resolveTapeInspectorEvidenceEntries).toHaveBeenCalledOnce()
    )
    await expect(store.initialize('session-2')).resolves.toBe(true)
    firstResolution.resolve({
      status: 'ok',
      tapeIncarnationId: 'incarnation-1',
      resolutions: [
        {
          messageId: 'message-1',
          requestSeq: 4,
          physicalAttempt: 0,
          entryId: 1
        }
      ]
    })
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
