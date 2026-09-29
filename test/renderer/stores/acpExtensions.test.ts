import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAcpExtensionsStore } from '@/stores/acpExtensions'
import type { AcpExtensionState } from '@shared/types/acp-extensions'

const api = vi.hoisted(() => ({
  inspect: vi.fn(),
  listElicitations: vi.fn(async () => ({ requests: [], version: 0 })),
  onExtensionsChanged: vi.fn(() => () => {}),
  onElicitationChanged: vi.fn(() => () => {}),
  onUpdated: vi.fn(() => vi.fn())
}))
vi.unmock('pinia')
vi.mock('@api/AcpExtensionsClient', () => ({ createAcpExtensionsClient: () => api }))
vi.mock('@api/SessionClient', () => ({ createSessionClient: () => api }))

describe('ACP extension snapshots', () => {
  it('removes deleted sessions and rejects their in-flight snapshots', async () => {
    setActivePinia(createPinia())
    const store = useAcpExtensionsStore()
    const state = { version: 1, connectionId: 'connection', revision: 1 } as AcpExtensionState
    api.inspect.mockResolvedValueOnce({ state })
    await store.inspect('session', 'agent')
    expect(store.states.session).toEqual(state)
    let resolve!: (value: { state: AcpExtensionState }) => void
    api.inspect.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const pending = store.inspect('session', 'agent')
    api.onUpdated.mock.calls[0][0]({ reason: 'deleted', sessionIds: ['session'] })
    expect(store.states.session).toBeUndefined()
    resolve({ state: { ...state, revision: 2 } })
    await pending
    expect(store.states.session).toBeUndefined()
    store.$dispose()
    expect(api.onUpdated.mock.results[0].value).toHaveBeenCalledOnce()
  })
})
