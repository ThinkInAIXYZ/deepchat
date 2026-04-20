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

const createPendingItem = (id: string, sessionId: string) => ({
  id,
  sessionId,
  mode: 'queue' as const,
  state: 'pending' as const,
  payload: {
    text: id,
    files: []
  },
  queueOrder: 0,
  claimedAt: null,
  consumedAt: null,
  createdAt: 1,
  updatedAt: 1
})

const setupStore = async () => {
  vi.resetModules()
  vi.doUnmock('pinia')
  const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
  setActivePinia(createPinia())

  const unsubscribePendingInputsChanged = vi.fn()
  const sessionClient = {
    listPendingInputs: vi.fn(),
    queuePendingInput: vi.fn(),
    updateQueuedInput: vi.fn(),
    moveQueuedInput: vi.fn(),
    convertPendingInputToSteer: vi.fn(),
    deletePendingInput: vi.fn(),
    resumePendingQueue: vi.fn(),
    onPendingInputsChanged: vi.fn(() => unsubscribePendingInputsChanged)
  }

  vi.doMock('../../../src/renderer/api/SessionClient', () => ({
    SessionClient: vi.fn(() => sessionClient)
  }))

  const { usePendingInputStore } = await import('@/stores/ui/pendingInput')

  return {
    store: usePendingInputStore(),
    sessionClient,
    unsubscribePendingInputsChanged
  }
}

describe('pendingInput store', () => {
  it('ignores stale load results after the active session changes', async () => {
    const { store, sessionClient } = await setupStore()
    const firstLoad = createDeferred<ReturnType<typeof createPendingItem>[]>()
    const secondLoad = createDeferred<ReturnType<typeof createPendingItem>[]>()

    sessionClient.listPendingInputs
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)

    const firstPromise = store.loadPendingInputs('s1')
    const secondPromise = store.loadPendingInputs('s2')

    secondLoad.resolve([createPendingItem('p2', 's2')])
    await secondPromise

    expect(store.currentSessionId).toBe('s2')
    expect(store.items).toEqual([createPendingItem('p2', 's2')])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()

    firstLoad.resolve([createPendingItem('p1', 's1')])
    await firstPromise

    expect(store.currentSessionId).toBe('s2')
    expect(store.items).toEqual([createPendingItem('p2', 's2')])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('preserves clear state when an in-flight load later fails', async () => {
    const { store, sessionClient } = await setupStore()
    const load = createDeferred<ReturnType<typeof createPendingItem>[]>()

    sessionClient.listPendingInputs.mockReturnValueOnce(load.promise)

    const loadPromise = store.loadPendingInputs('s1')
    expect(store.currentSessionId).toBe('s1')
    expect(store.loading).toBe(true)

    store.clear()

    expect(store.currentSessionId).toBeNull()
    expect(store.items).toEqual([])
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
})
