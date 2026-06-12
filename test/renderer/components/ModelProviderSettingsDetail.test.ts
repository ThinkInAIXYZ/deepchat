import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '../../../src/shared/presenter'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const providerApiConfigStub = defineComponent({
  name: 'ProviderApiConfig',
  emits: [
    'api-host-change',
    'api-key-change',
    'validate-key',
    'delete-provider',
    'oauth-success',
    'oauth-error'
  ],
  template: `
    <div>
      <button data-testid="save-api-key" @click="$emit('api-key-change', 'updated-key')">save</button>
    </div>
  `
})

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'anthropic',
  name: 'Anthropic',
  apiType: 'anthropic',
  apiKey: 'existing-key',
  baseUrl: 'https://api.anthropic.com',
  enable: true,
  custom: false,
  ...overrides
})

async function setup(options?: { provider?: LLM_PROVIDER; updatedProvider?: LLM_PROVIDER }) {
  vi.resetModules()

  const provider = options?.provider ?? createProvider()
  const providerStore = {
    defaultProviders: [
      {
        id: provider.id,
        websites: {
          official: 'https://example.com',
          apiKey: 'https://example.com/key',
          docs: 'https://example.com/docs',
          models: 'https://example.com/models',
          defaultBaseUrl: provider.baseUrl
        }
      }
    ],
    providers: [options?.updatedProvider ?? provider],
    ensureDefaultProvidersReady: vi.fn().mockResolvedValue(undefined),
    updateProviderApi: vi.fn().mockResolvedValue({
      updated: options?.updatedProvider ?? createProvider({ ...provider, apiKey: 'updated-key' })
    }),
    checkProvider: vi.fn().mockResolvedValue({ isOk: true }),
    getAzureApiVersion: vi.fn().mockResolvedValue('2024-02-01'),
    getGeminiSafety: vi.fn().mockResolvedValue('BLOCK_MEDIUM_AND_ABOVE'),
    removeProvider: vi.fn().mockResolvedValue(undefined)
  }

  const modelStore = {
    allProviderModels: [],
    customModels: [],
    refreshProviderModels: vi.fn().mockResolvedValue(undefined),
    updateModelStatus: vi.fn().mockResolvedValue(undefined),
    disableAllModels: vi.fn().mockResolvedValue(undefined)
  }

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => ({
      traceDebugEnabled: false
    })
  }))
  vi.doMock('@/stores/modelCheck', () => ({
    useModelCheckStore: () => ({
      openDialog: vi.fn()
    })
  }))
  vi.doMock('../../../src/renderer/settings/components/ProviderApiConfig.vue', () => ({
    default: providerApiConfigStub
  }))
  vi.doMock('../../../src/renderer/settings/components/AzureProviderConfig.vue', () => ({
    default: passthrough('AzureProviderConfig')
  }))
  vi.doMock('../../../src/renderer/settings/components/GeminiSafetyConfig.vue', () => ({
    default: passthrough('GeminiSafetyConfig')
  }))
  vi.doMock('../../../src/renderer/settings/components/VertexProviderSettingsDetail.vue', () => ({
    default: passthrough('VertexProviderSettingsDetail')
  }))
  vi.doMock('../../../src/renderer/settings/components/ProviderRateLimitConfig.vue', () => ({
    default: passthrough('ProviderRateLimitConfig')
  }))
  vi.doMock('../../../src/renderer/settings/components/ModelScopeMcpSync.vue', () => ({
    default: passthrough('ModelScopeMcpSync')
  }))
  vi.doMock('../../../src/renderer/settings/components/ProviderModelManager.vue', () => ({
    default: passthrough('ProviderModelManager')
  }))
  vi.doMock('../../../src/renderer/settings/components/ProviderDialogContainer.vue', () => ({
    default: passthrough('ProviderDialogContainer')
  }))
  vi.doMock('../../../src/renderer/settings/components/VoiceAIProviderConfig.vue', () => ({
    default: passthrough('VoiceAIProviderConfig')
  }))

  const ModelProviderSettingsDetail = (
    await import('../../../src/renderer/settings/components/ModelProviderSettingsDetail.vue')
  ).default

  const wrapper = mount(ModelProviderSettingsDetail, {
    props: {
      provider
    },
    global: {
      stubs: {
        ScrollArea: passthrough('ScrollArea'),
        Badge: passthrough('Badge'),
        Tabs: passthrough('Tabs'),
        TabsContent: passthrough('TabsContent'),
        TabsList: passthrough('TabsList'),
        TabsTrigger: passthrough('TabsTrigger')
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    providerStore
  }
}

describe('ModelProviderSettingsDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits provider-configured after saving credentials for an enabled provider', async () => {
    const { wrapper, providerStore } = await setup()

    await wrapper.get('[data-testid="save-api-key"]').trigger('click')
    await flushPromises()

    expect(providerStore.updateProviderApi).toHaveBeenCalledWith(
      'anthropic',
      'updated-key',
      undefined
    )
    expect(wrapper.emitted('provider-configured')).toHaveLength(1)
  })

  it('does not emit provider-configured while the provider stays disabled', async () => {
    const provider = createProvider({
      apiKey: '',
      enable: false
    })
    const { wrapper } = await setup({
      provider,
      updatedProvider: createProvider({
        apiKey: 'updated-key',
        enable: false
      })
    })

    await wrapper.get('[data-testid="save-api-key"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('provider-configured')).toBeUndefined()
  })
})
