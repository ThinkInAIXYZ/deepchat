import { describe, expect, it, vi } from 'vitest'
import { ProviderHelper } from '../../../src/main/provider/providerHelper'
import { DEFAULT_PROVIDERS } from '../../../src/main/provider/defaults'
import type { LLM_PROVIDER } from '@shared/types/provider'

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
  it('cleans persisted model state when removing a provider', () => {
    const store = new MockElectronStore()
    const providers = [createProvider('openai'), createProvider('anthropic')]
    store.set('providers', providers)

    const helper = new ProviderHelper({
      store: store as any,
      setSetting: (key, value) => store.set(key, value),
      defaultProviders: providers,
      publishEvent: vi.fn()
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
  })
})

describe('ProviderHelper provider persistence', () => {
  it('keeps AMD GPU Cloud settings after recreating the helper', () => {
    const store = new MockElectronStore()
    const createHelper = () =>
      new ProviderHelper({
        store: store as any,
        setSetting: (key, value) => store.set(key, value),
        defaultProviders: structuredClone(DEFAULT_PROVIDERS),
        publishEvent: vi.fn()
      })
    const helper = createHelper()

    expect(helper.getProviderById('amd-developer')).toBeDefined()
    helper.updateProviderAtomic('amd-developer', {
      apiKey: 'amd-test-key',
      baseUrl: 'https://amd.example/v1',
      enable: true
    })

    const reloadedHelper = createHelper()
    expect(reloadedHelper.getProviderById('amd-developer')).toMatchObject({
      id: 'amd-developer',
      apiKey: 'amd-test-key',
      baseUrl: 'https://amd.example/v1',
      enable: true
    })
  })
})
