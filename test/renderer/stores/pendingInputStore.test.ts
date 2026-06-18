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
    steerPendingInput: vi.fn(),
    deletePendingInput: vi.fn(),
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

  it('exposes steer inputs while counting only queue inputs toward queue capacity', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listPendingInputs.mockResolvedValueOnce([
      createPendingItem('q1', 's1'),
      createPendingItem('steer1', 's1', 'steer')
    ])

    await store.loadPendingInputs('s1')

    expect(store.queueItems).toHaveLength(1)
    expect(store.steerItems).toHaveLength(1)
    expect(store.activeCount).toBe(1)
    expect(store.isAtCapacity).toBe(false)
  })

  it('steers a queued input through the session client and reloads', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listPendingInputs.mockResolvedValueOnce([createPendingItem('q1', 's1')])
    await store.loadPendingInputs('s1')

    const steered = createPendingItem('q1', 's1', 'steer')
    sessionClient.steerPendingInput.mockResolvedValue(steered)
    sessionClient.listPendingInputs.mockResolvedValueOnce([steered])

    await store.steerPendingInput('s1', 'q1')

    expect(sessionClient.steerPendingInput).toHaveBeenCalledWith('s1', 'q1')
    expect(store.steerItems).toHaveLength(1)
    expect(store.queueItems).toHaveLength(0)
    expect(store.error).toBeNull()
  })

  it('rethrows and records an error when steering a queued input fails', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.listPendingInputs.mockResolvedValueOnce([createPendingItem('q1', 's1')])
    await store.loadPendingInputs('s1')

    sessionClient.steerPendingInput.mockRejectedValue(new Error('boom'))

    await expect(store.steerPendingInput('s1', 'q1')).rejects.toThrow('boom')
    expect(store.error).toContain('Failed to steer queued message')
  })
})
