import { describe, expect, it, vi } from 'vitest'
import { RemoteBindingStore } from '@/presenter/remoteControlPresenter/services/remoteBindingStore'

const createConfigPresenter = () => {
  const store = new Map<string, unknown>()
  return {
    getSetting: vi.fn((key: string) => store.get(key)),
    setSetting: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
    })
  }
}

describe('RemoteBindingStore', () => {
  it('persists endpoint bindings through config storage', () => {
    const configPresenter = createConfigPresenter()
    const firstStore = new RemoteBindingStore(configPresenter as any)

    firstStore.setBinding('telegram:100:0', 'session-1')

    const secondStore = new RemoteBindingStore(configPresenter as any)
    expect(secondStore.getBinding('telegram:100:0')).toEqual({
      sessionId: 'session-1',
      updatedAt: expect.any(Number)
    })
  })

  it('clears bindings and returns the cleared count', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.setBinding('telegram:100:0', 'session-1')
    store.setBinding('telegram:200:0', 'session-2')

    expect(store.clearBindings()).toBe(2)
    expect(store.countBindings()).toBe(0)
  })

  it('stores and restores poll offset', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.setPollOffset(42)

    const reloaded = new RemoteBindingStore(configPresenter as any)
    expect(reloaded.getPollOffset()).toBe(42)
  })
})
