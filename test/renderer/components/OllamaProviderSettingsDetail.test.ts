import { describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '@shared/types/provider'
import OllamaProviderSettingsDetail from '../../../src/renderer/settings/components/OllamaProviderSettingsDetail.vue'

const { useProviderStore, refreshOllamaModels, notifyRenderer } = vi.hoisted(() => ({
  useProviderStore: vi.fn(),
  refreshOllamaModels: vi.fn(),
  notifyRenderer: vi.fn()
}))
vi.mock('@renderer-notifications/rendererNotificationPort', () => ({ notifyRenderer }))
vi.mock('@/stores/providerStore', () => ({ useProviderStore }))
vi.mock('@/stores/modelStore', () => ({
  useModelStore: () => ({
    allProviderModels: [],
    getProviderModelsQuery: () => ({ data: ref([]) })
  })
}))
vi.mock('@/stores/ollamaStore', () => ({
  useOllamaStore: () => ({
    getOllamaRunningModels: () => [],
    getOllamaLocalModels: () => [],
    getOllamaPullingModels: () => ({}),
    refreshOllamaModels,
    ensureProviderReady: vi.fn()
  })
}))
vi.mock('@/stores/modelCheck', () => ({ useModelCheckStore: () => ({}) }))
vi.mock('../../../src/renderer/api/ModelClient', () => ({ createModelClient: () => ({}) }))
vi.mock('@/components/settings/ModelConfigItem.vue', () => ({ default: {} }))
vi.mock('../../../src/renderer/settings/components/ProviderCustomHeadersEditor.vue', () => ({
  default: {}
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('Ollama provider settings actions', () => {
  it.each(['ollama', 'custom-ollama'])(
    'keeps URL reset explicit and reports refresh failures for %s',
    async (id) => {
      const provider: LLM_PROVIDER = {
        id,
        name: 'Ollama',
        apiType: 'ollama',
        apiKey: '',
        baseUrl: 'http://my-server:21434',
        enable: false
      }
      const store = reactive({
        defaultProviders: [] as LLM_PROVIDER[],
        updateProviderApi: vi.fn().mockResolvedValue({ updated: provider })
      })
      useProviderStore.mockReturnValue(store)
      const wrapper = shallowMount(OllamaProviderSettingsDetail, {
        props: { provider },
        global: { renderStubDefaultSlot: true }
      })
      await flushPromises()
      expect(wrapper.text()).not.toContain('settings.provider.urlFormatFill')
      store.defaultProviders = [{ ...provider, id: 'ollama', baseUrl: 'http://localhost:11434' }]
      await flushPromises()
      expect(store.updateProviderApi).not.toHaveBeenCalled()
      await wrapper.get('button[aria-label="settings.provider.urlFormatFill"]').trigger('click')
      await flushPromises()
      expect(store.updateProviderApi).toHaveBeenCalledWith(id, undefined, 'http://localhost:11434')
      expect(provider.baseUrl).toBe('http://my-server:21434')

      refreshOllamaModels.mockResolvedValueOnce(false)
      notifyRenderer.mockClear()
      await (wrapper.vm as unknown as { refreshModels: () => Promise<void> }).refreshModels()
      expect(notifyRenderer).toHaveBeenCalledExactlyOnceWith({
        kind: 'error',
        code: 'settings.provider.modelRefreshFailed',
        title: 'settings.provider.toast.refreshModelsFailedTitle',
        description: 'settings.provider.toast.refreshModelsFailedDescription'
      })
      wrapper.unmount()
    }
  )
})
