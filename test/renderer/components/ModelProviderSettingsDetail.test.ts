import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '@shared/types/provider'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const providerApiConfigStub = defineComponent({
  name: 'ProviderApiConfig',
  props: ['provider', 'save'],
  emits: ['auth-mode-change', 'delete-provider', 'oauth-success', 'oauth-error'],
  template: `
    <div>
      <button data-testid="save-api-key" @click="save(provider.id, { apiKey: 'updated-key', baseUrl: provider.baseUrl })">save</button>
      <button data-testid="use-chatgpt" @click="$emit('auth-mode-change', 'chatgpt')">chatgpt</button>
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
  const notifyRendererMock = vi.fn()

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
    updateProviderStatus: vi.fn().mockResolvedValue(undefined),
    updateProviderApi: vi.fn().mockResolvedValue({
      updated: options?.updatedProvider ?? createProvider({ ...provider, apiKey: 'updated-key' })
    }),
    updateProviderConfig: vi.fn().mockResolvedValue({
      requiresRebuild: true,
      updated: { ...provider, openaiAuthMode: 'chatgpt' }
    }),
    checkProvider: vi.fn().mockResolvedValue({ isOk: true }),
    getAzureApiVersion: vi.fn().mockResolvedValue('2024-02-01'),
    getGeminiSafety: vi.fn().mockResolvedValue('BLOCK_MEDIUM_AND_ABOVE'),
    removeProvider: vi.fn().mockResolvedValue(undefined),
    getProviderHealth: vi.fn(() => ({ status: 'not_checked' })),
    saveProviderCustomHeaders: vi.fn().mockResolvedValue({ isOk: true, errorMsg: null }),
    validateDraftProvider: vi.fn().mockResolvedValue({
      isOk: false,
      errorMsg: 'AccessDenied.Unpurchased',
      models: []
    })
  }

  const modelStore = {
    allProviderModels: [],
    customModels: [],
    refreshProviderModels: vi.fn().mockResolvedValue(true),
    updateModelStatus: vi.fn().mockResolvedValue(true),
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
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer: notifyRendererMock
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
  vi.doMock('../../../src/renderer/settings/components/ProviderCustomHeadersEditor.vue', () => ({
    default: passthrough('ProviderCustomHeadersEditor')
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
    providerStore,
    modelStore,
    notifyRendererMock
  }
}

describe('ModelProviderSettingsDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits provider-configured after saving first-time credentials for an enabled provider', async () => {
    const { wrapper, providerStore } = await setup({
      provider: createProvider({ apiKey: '' })
    })

    await wrapper.get('[data-testid="save-api-key"]').trigger('click')
    await flushPromises()

    expect(providerStore.updateProviderApi).toHaveBeenCalledWith(
      'anthropic',
      'updated-key',
      'https://api.anthropic.com'
    )
    expect(providerStore.validateDraftProvider).not.toHaveBeenCalled()
    expect(wrapper.emitted('provider-configured')).toHaveLength(1)
  })

  it('persists the OpenAI auth mode and refreshes models from the new backend', async () => {
    const { wrapper, providerStore, modelStore } = await setup({
      provider: createProvider({
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        baseUrl: 'https://api.openai.com/v1'
      })
    })

    await wrapper.get('[data-testid="use-chatgpt"]').trigger('click')
    await flushPromises()

    expect(providerStore.updateProviderConfig).toHaveBeenCalledWith('openai', {
      openaiAuthMode: 'chatgpt'
    })
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('openai')
  })

  it('saves a replacement even when the fixed probe model would reject it', async () => {
    const { wrapper, providerStore } = await setup()

    await wrapper.get('[data-testid="save-api-key"]').trigger('click')
    await flushPromises()

    expect(providerStore.updateProviderApi).toHaveBeenCalledWith(
      'anthropic',
      'updated-key',
      'https://api.anthropic.com'
    )
    expect(providerStore.validateDraftProvider).not.toHaveBeenCalled()
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

  it('updates the provider status from the banner toggle', async () => {
    const { wrapper, providerStore } = await setup()

    await wrapper.get('[data-testid="provider-enabled-toggle"]').trigger('click')
    await flushPromises()

    expect(providerStore.updateProviderStatus).toHaveBeenCalledWith('anthropic', false)
  })

  it('does not emit model-enabled and shows a localized error when persistence fails', async () => {
    const { wrapper, modelStore, notifyRendererMock } = await setup()
    modelStore.updateModelStatus.mockResolvedValue(false)

    const vm = wrapper.vm as unknown as {
      handleModelEnabledChange: (model: { id: string }, enabled: boolean) => Promise<void>
    }
    await vm.handleModelEnabledChange({ id: 'claude-test' }, true)

    expect(wrapper.emitted('provider-model-enabled')).toBeUndefined()
    expect(notifyRendererMock).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.provider.modelStatusUpdateFailed',
      title: 'common.error.operationFailed',
      description: 'settings.deepchatAgents.saveFeedback.saveFailed'
    })
  })

  it('keeps the disable confirmation open when persistence fails', async () => {
    const { wrapper, modelStore } = await setup()
    modelStore.updateModelStatus.mockResolvedValue(false)
    const model = { id: 'claude-test' }
    const vm = wrapper.vm as unknown as {
      handleModelEnabledChange: (
        model: { id: string },
        enabled: boolean,
        confirm: boolean
      ) => Promise<void>
      confirmDisable: () => Promise<void>
      showConfirmDialog: boolean
      modelToDisable: { id: string } | null
    }

    await vm.handleModelEnabledChange(model, false, true)
    await vm.confirmDisable()

    expect(vm.showConfirmDialog).toBe(true)
    expect(vm.modelToDisable).toEqual(model)
  })

  it('renders Vertex credentials in the connection section', async () => {
    const { wrapper } = await setup({
      provider: createProvider({ id: 'vertex', apiType: 'vertex' })
    })

    const vertex = wrapper.findComponent({ name: 'VertexProviderSettingsDetail' })
    expect(vertex.exists()).toBe(true)
    expect(vertex.element.closest('[data-testid="provider-connection-section"]')).not.toBeNull()
    expect(vertex.element.closest('[data-testid="provider-advanced-section"]')).toBeNull()
  })
})
