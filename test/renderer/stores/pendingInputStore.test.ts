import { createPinia, setActivePinia } from 'pinia'
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
  setActivePinia(createPinia())

  const newAgentPresenter = {
    listPendingInputs: vi.fn(),
    queuePendingInput: vi.fn(),
    updateQueuedInput: vi.fn(),
    moveQueuedInput: vi.fn(),
    convertPendingInputToSteer: vi.fn(),
    deletePendingInput: vi.fn(),
    resumePendingQueue: vi.fn()
  }

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => newAgentPresenter
  }))
  ;(
    window as typeof window & {
      electron: {
        ipcRenderer: {
          on: ReturnType<typeof vi.fn>
          removeListener: ReturnType<typeof vi.fn>
        }
      }
    }
  ).electron = {
    ipcRenderer: {
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }

  const { usePendingInputStore } = await import('@/stores/ui/pendingInput')

  return {
    store: usePendingInputStore(),
    newAgentPresenter
  }
}

describe('pendingInput store', () => {
  it('ignores stale load results after the active session changes', async () => {
    const { store, newAgentPresenter } = await setupStore()
    const firstLoad = createDeferred<ReturnType<typeof createPendingItem>[]>()
    const secondLoad = createDeferred<ReturnType<typeof createPendingItem>[]>()

    newAgentPresenter.listPendingInputs
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
    const { store, newAgentPresenter } = await setupStore()
    const load = createDeferred<ReturnType<typeof createPendingItem>[]>()

    newAgentPresenter.listPendingInputs.mockReturnValueOnce(load.promise)

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
    const { store } = await setupStore()
    const ipcRenderer = (
      window as typeof window & {
        electron: {
          ipcRenderer: {
            on: ReturnType<typeof vi.fn>
            removeListener: ReturnType<typeof vi.fn>
          }
        }
      }
    ).electron.ipcRenderer

    expect(ipcRenderer.on).toHaveBeenCalledTimes(1)

    const [eventName, pendingInputsHandler] = ipcRenderer.on.mock.calls[0]

    expect(eventName).toBe('session:pending-inputs-updated')
    expect(typeof pendingInputsHandler).toBe('function')

    store.$dispose()

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(eventName, pendingInputsHandler)
  })
})
