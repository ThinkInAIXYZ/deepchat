import { describe, expect, it, vi } from 'vitest'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

const createPendingItem = (id: string, sessionId: string, mode: 'queue' | 'steer' = 'queue') => ({
  id,
  sessionId,
  mode,
  state: 'pending' as const,
  payload: {
    text: id,
    files: []
  },
  messageIds: [],
  assistantMessageId: null,
  blocking: null,
  queueOrder: mode === 'queue' ? 0 : null,
  claimedAt: null,
  consumedAt: null,
  createdAt: 1,
  updatedAt: 1
})

const createPendingResult = (
  items: ReturnType<typeof createPendingItem>[],
  resumeAvailable = false
) => ({ items, resumeAvailable })

const setupStore = async () => {
  vi.resetModules()
  vi.doUnmock('pinia')
  const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
  setActivePinia(createPinia())

  const unsubscribePendingInputsChanged = vi.fn()
  const sessionClient = {
    listPendingInputs: vi.fn(),
    resumePendingQueue: vi.fn(),
    retryPendingQueueInput: vi.fn(),
    queuePendingInput: vi.fn(),
    updateQueuedInput: vi.fn(),
    moveQueuedInput: vi.fn(),
    steerPendingInput: vi.fn(),
    deletePendingInput: vi.fn(),
    resolveBlockedPendingInput: vi.fn(),
    onPendingInputsChanged: vi.fn(() => unsubscribePendingInputsChanged)
  }

  vi.doMock('../../../src/renderer/api/SessionClient', () => ({
    createSessionClient: vi.fn(() => sessionClient)
  }))

  const { usePendingInputStore } = await import('@/stores/ui/pendingInput')

  return {
    store: usePendingInputStore(),
    sessionClient,
    unsubscribePendingInputsChanged
  }
}

describe('pendingInput store', () => {
  it('tracks Queue resume busy state and returns whether a turn started', async () => {
    const { store, sessionClient } = await setupStore()
    const resume = createDeferred<{ started: boolean }>()
    sessionClient.listPendingInputs
      .mockResolvedValueOnce(createPendingResult([createPendingItem('q1', 's1')], true))
      .mockResolvedValueOnce(createPendingResult([]))
    sessionClient.resumePendingQueue.mockReturnValueOnce(resume.promise)
    await store.loadPendingInputs('s1')

    const operation = store.resumeQueue('s1')
    expect(store.resumingQueue).toBe(true)
    resume.resolve({ started: true })

    await expect(operation).resolves.toBe(true)
    expect(sessionClient.resumePendingQueue).toHaveBeenCalledWith('s1')
    expect(store.resumingQueue).toBe(false)
    expect(store.items).toEqual([])
    expect(store.resumeAvailable).toBe(false)
  })

  it('deduplicates item retry and treats accepted-but-deferred work as success', async () => {
    const { store, sessionClient } = await setupStore()
    const released = {
      ...createPendingItem('q1', 's1'),
      state: 'retry_required' as const
    }
    const retry = createDeferred<{ accepted: boolean; started: boolean }>()
    sessionClient.listPendingInputs
      .mockResolvedValueOnce(createPendingResult([released]))
      .mockResolvedValueOnce(createPendingResult([createPendingItem('q1', 's1')]))
    sessionClient.retryPendingQueueInput.mockReturnValueOnce(retry.promise)
    await store.loadPendingInputs('s1')

    const operation = store.retryQueueInput('s1', 'q1')
    expect(store.retryingItemId).toBe('q1')
    await expect(store.retryQueueInput('s1', 'q1')).resolves.toEqual({
      accepted: false,
      started: false
    })
    expect(sessionClient.retryPendingQueueInput).toHaveBeenCalledOnce()

    retry.resolve({ accepted: true, started: false })
    await expect(operation).resolves.toEqual({ accepted: true, started: false })
    expect(store.retryingItemId).toBeNull()
    expect(store.items[0]?.state).toBe('pending')
    expect(store.error).toBeNull()
  })

  it('ignores stale load results after the active session changes', async () => {
    const { store, sessionClient } = await setupStore()
    const firstLoad = createDeferred<ReturnType<typeof createPendingResult>>()
    const secondLoad = createDeferred<ReturnType<typeof createPendingResult>>()

    sessionClient.listPendingInputs
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)

    const firstPromise = store.loadPendingInputs('s1')
    const secondPromise = store.loadPendingInputs('s2')

    secondLoad.resolve(createPendingResult([createPendingItem('p2', 's2')], true))
    await secondPromise

    expect(store.currentSessionId).toBe('s2')
    expect(store.items).toEqual([createPendingItem('p2', 's2')])
    expect(store.resumeAvailable).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()

    firstLoad.resolve(createPendingResult([createPendingItem('p1', 's1')]))
    await firstPromise

    expect(store.currentSessionId).toBe('s2')
    expect(store.items).toEqual([createPendingItem('p2', 's2')])
    expect(store.resumeAvailable).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('clears resume availability while switching to another session', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listPendingInputs.mockResolvedValueOnce(
      createPendingResult([createPendingItem('p1', 's1')], true)
    )
    await store.loadPendingInputs('s1')
    const nextLoad = createDeferred<ReturnType<typeof createPendingResult>>()
    sessionClient.listPendingInputs.mockReturnValueOnce(nextLoad.promise)

    const operation = store.loadPendingInputs('s2')

    expect(store.currentSessionId).toBe('s2')
    expect(store.items).toEqual([])
    expect(store.resumeAvailable).toBe(false)
    nextLoad.resolve(createPendingResult([]))
    await operation
  })

  it('rejects an old load after a rapid A-B-A session cycle', async () => {
    const { store, sessionClient } = await setupStore()
    const firstA = createDeferred<ReturnType<typeof createPendingResult>>()
    const sessionB = createDeferred<ReturnType<typeof createPendingResult>>()
    const secondA = createDeferred<ReturnType<typeof createPendingResult>>()
    sessionClient.listPendingInputs
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(sessionB.promise)
      .mockReturnValueOnce(secondA.promise)

    const firstAPromise = store.loadPendingInputs('s1')
    const sessionBPromise = store.loadPendingInputs('s2')
    const secondAPromise = store.loadPendingInputs('s1')

    secondA.resolve(createPendingResult([createPendingItem('a-latest', 's1')], true))
    await secondAPromise
    firstA.resolve(createPendingResult([createPendingItem('a-stale', 's1')]))
    sessionB.resolve(createPendingResult([createPendingItem('b-stale', 's2')]))
    await Promise.all([firstAPromise, sessionBPromise])

    expect(store.currentSessionId).toBe('s1')
    expect(store.items).toEqual([createPendingItem('a-latest', 's1')])
    expect(store.resumeAvailable).toBe(true)
    expect(store.loading).toBe(false)
  })

  it('does not apply a completed reorder to another session view', async () => {
    const { store, sessionClient } = await setupStore()
    const reorderedSessionOne = createDeferred<ReturnType<typeof createPendingItem>[]>()
    sessionClient.listPendingInputs
      .mockResolvedValueOnce(createPendingResult([createPendingItem('a-1', 's1')]))
      .mockResolvedValueOnce(createPendingResult([createPendingItem('b-1', 's2')]))
    sessionClient.moveQueuedInput.mockReturnValueOnce(reorderedSessionOne.promise)

    await store.loadPendingInputs('s1')
    const pendingReorder = store.moveQueueInput('s1', 'a-1', 0)
    await store.loadPendingInputs('s2')
    reorderedSessionOne.resolve([createPendingItem('a-reordered', 's1')])
    await pendingReorder

    expect(store.currentSessionId).toBe('s2')
    expect(store.items).toEqual([createPendingItem('b-1', 's2')])
  })

  it('preserves clear state when an in-flight load later fails', async () => {
    const { store, sessionClient } = await setupStore()
    const load = createDeferred<ReturnType<typeof createPendingResult>>()

    sessionClient.listPendingInputs.mockReturnValueOnce(load.promise)

    const loadPromise = store.loadPendingInputs('s1')
    expect(store.currentSessionId).toBe('s1')
    expect(store.loading).toBe(true)

    store.clear()

    expect(store.currentSessionId).toBeNull()
    expect(store.items).toEqual([])
    expect(store.resumeAvailable).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()

    load.reject(new Error('stale failure'))
    await loadPromise

    expect(store.currentSessionId).toBeNull()
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('removes the pending inputs listener when the store is disposed', async () => {
    const { store, sessionClient, unsubscribePendingInputsChanged } = await setupStore()

    expect(sessionClient.onPendingInputsChanged).toHaveBeenCalledTimes(1)

    store.$dispose()

    expect(unsubscribePendingInputsChanged).toHaveBeenCalledTimes(1)
  })

  it('keeps steer inputs out of the queue lane and capacity count', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listPendingInputs.mockResolvedValueOnce(
      createPendingResult([
        createPendingItem('q1', 's1'),
        createPendingItem('steer1', 's1', 'steer')
      ])
    )

    await store.loadPendingInputs('s1')

    expect(store.items).toHaveLength(2)
    expect(store.queueItems).toHaveLength(1)
    expect(store.activeCount).toBe(1)
    expect(store.isAtCapacity).toBe(false)
  })

  it('steers a queued input through the session client and reloads', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listPendingInputs.mockResolvedValueOnce(
      createPendingResult([createPendingItem('q1', 's1')])
    )
    await store.loadPendingInputs('s1')

    const steered = createPendingItem('q1', 's1', 'steer')
    sessionClient.steerPendingInput.mockResolvedValue(steered)
    sessionClient.listPendingInputs.mockResolvedValueOnce(createPendingResult([steered]))

    await store.steerPendingInput('s1', 'q1')

    expect(sessionClient.steerPendingInput).toHaveBeenCalledWith('s1', 'q1')
    expect(store.items).toEqual([steered])
    expect(store.queueItems).toHaveLength(0)
    expect(store.error).toBeNull()
  })

  it('rethrows and records an error when steering a queued input fails', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listPendingInputs.mockResolvedValueOnce(
      createPendingResult([createPendingItem('q1', 's1')])
    )
    await store.loadPendingInputs('s1')

    sessionClient.steerPendingInput.mockRejectedValue(new Error('boom'))

    await expect(store.steerPendingInput('s1', 'q1')).rejects.toThrow('boom')
    expect(store.error).toContain('Failed to steer queued message')
  })
})
