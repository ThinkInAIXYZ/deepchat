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

  it('removes a single binding without touching others', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.setBinding('telegram:100:0', 'session-1')
    store.setBinding('telegram:200:0', 'session-2')

    store.clearBinding('telegram:100:0')

    expect(store.getBinding('telegram:100:0')).toBeNull()
    expect(store.getBinding('telegram:200:0')).toEqual({
      sessionId: 'session-2',
      updatedAt: expect.any(Number)
    })
  })

  it('stores and restores poll offset', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.setPollOffset(42)

    const reloaded = new RemoteBindingStore(configPresenter as any)
    expect(reloaded.getPollOffset()).toBe(42)
  })

  it('normalizes empty defaultAgentId to deepchat', () => {
    const configPresenter = createConfigPresenter()
    configPresenter.setSetting('remoteControl', {
      telegram: {
        enabled: false,
        allowlist: [],
        streamMode: 'final',
        defaultAgentId: '  ',
        pollOffset: 0,
        pairing: {
          code: null,
          expiresAt: null
        },
        bindings: {}
      }
    })

    const store = new RemoteBindingStore(configPresenter as any)

    expect(store.getDefaultAgentId()).toBe('deepchat')
    expect(store.getTelegramConfig().streamMode).toBe('draft')
  })

  it('keeps model menus in memory and clears them after rebinding the endpoint', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    const token = store.createModelMenuState('telegram:100:0', 'session-1', [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: [{ modelId: 'gpt-5', modelName: 'GPT-5' }]
      }
    ])

    expect(store.getModelMenuState(token, 10 * 60 * 1000)).toEqual(
      expect.objectContaining({
        endpointKey: 'telegram:100:0',
        sessionId: 'session-1'
      })
    )

    store.setBinding('telegram:100:0', 'session-2')

    expect(store.getModelMenuState(token, 10 * 60 * 1000)).toBeNull()
  })
})
