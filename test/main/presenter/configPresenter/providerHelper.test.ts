import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderHelper } from '../../../../src/main/presenter/configPresenter/providerHelper'
import type { LLM_PROVIDER } from '../../../../src/shared/presenter'

const { send } = vi.hoisted(() => ({
  send: vi.fn()
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    send
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

class MockElectronStore {
  private readonly data = new Map<string, unknown>()

  get(key: string) {
    return this.data.get(key)
  }

  set(key: string, value: unknown) {
    this.data.set(key, value)
  }
}

const createProvider = (id: string): LLM_PROVIDER => ({
  id,
  name: id,
  apiType: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  enable: true,
  websites: {
    official: '',
    apiKey: '',
    docs: '',
    models: '',
    defaultBaseUrl: ''
  }
})

describe('ProviderHelper.removeProviderAtomic', () => {
  beforeEach(() => {
    send.mockReset()
  })

  it('cleans persisted model state when removing a provider', () => {
    const store = new MockElectronStore()
    const providers = [createProvider('openai'), createProvider('anthropic')]
    store.set('providers', providers)

    const helper = new ProviderHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      defaultProviders: providers
    })
    const deleteProviderModelStatuses = vi.fn()
    const clearProviderModelStore = vi.fn()

    helper.setCleanupHooks({
      deleteProviderModelStatuses,
      clearProviderModelStore
    })
    helper.removeProviderAtomic('openai')

    expect(store.get('providers')).toEqual([createProvider('anthropic')])
    expect(deleteProviderModelStatuses).toHaveBeenCalledWith('openai')
    expect(clearProviderModelStore).toHaveBeenCalledWith('openai')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
