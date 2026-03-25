import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const setup = async (options?: {
  preview?: Record<string, unknown> | null
  providerEnabled?: boolean
}) => {
  vi.resetModules()

  const provider = {
    id: 'anthropic',
    name: 'Anthropic',
    apiType: 'anthropic',
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com',
    enable: options?.providerEnabled ?? true
  }
  const providerStore = reactive({
    providers: [provider],
    sortedProviders: [provider],
    refreshProviders: vi.fn().mockResolvedValue(undefined),
    updateProviderConfig: vi.fn().mockResolvedValue(undefined),
    updateProviderApi: vi.fn().mockResolvedValue(undefined),
    updateProviderStatus: vi.fn().mockResolvedValue(undefined),
    addCustomProvider: vi.fn().mockResolvedValue(undefined),
    updateProvidersOrder: vi.fn(),
    defaultProviders: []
  })

  const modelStore = reactive({
    allProviderModels: [{ providerId: 'anthropic', models: [{ id: 'claude-sonnet' }] }],
    refreshAllModels: vi.fn().mockResolvedValue(undefined),
    refreshProviderModels: vi.fn().mockResolvedValue(undefined)
  })

  const clearPreview = vi.fn()
  const providerDeeplinkImportStore = reactive({
    preview: options?.preview ?? null,
    clearPreview,
    openPreview: vi.fn()
  })
  clearPreview.mockImplementation(() => {
    providerDeeplinkImportStore.preview = null
  })

  const router = {
    push: vi.fn(),
    replace: vi.fn()
  }

  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/providerDeeplinkImport', () => ({
    useProviderDeeplinkImportStore: () => providerDeeplinkImportStore
  }))
  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => ({ isDark: false })
  }))
  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({ dir: 'ltr' })
  }))
  vi.doMock('vue-router', () => ({
    useRoute: () => ({ params: { providerId: 'anthropic' } }),
    useRouter: () => router
  }))
  vi.doMock('@vueuse/core', () => ({
    refDebounced: (value: unknown) => value
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('nanoid', () => ({
    nanoid: () => 'custom-provider-id'
  }))

  const ModelProviderSettings = (
    await import('../../../src/renderer/settings/components/ModelProviderSettings.vue')
  ).default

  const wrapper = mount(ModelProviderSettings, {
    global: {
      stubs: {
        ScrollArea: passthrough('ScrollArea'),
        Input: passthrough('Input'),
        Button: passthrough('Button'),
        Switch: passthrough('Switch'),
        Icon: true,
        ModelIcon: true,
        draggable: passthrough('draggable'),
        AddCustomProviderDialog: true,
        ProviderDeeplinkImportDialog: defineComponent({
          name: 'ProviderDeeplinkImportDialog',
          props: ['open', 'preview'],
          emits: ['confirm', 'update:open'],
          template:
            '<div v-if="open"><span data-testid="import-kind">{{ preview?.kind }}</span><button data-testid="confirm-import" @click="$emit(\'confirm\')" /></div>'
        }),
        OllamaProviderSettingsDetail: defineComponent({
          name: 'OllamaProviderSettingsDetail',
          template: '<div data-testid="ollama-detail" />'
        }),
        BedrockProviderSettingsDetail: defineComponent({
          name: 'BedrockProviderSettingsDetail',
          template: '<div data-testid="bedrock-detail" />'
        }),
        ModelProviderSettingsDetail: defineComponent({
          name: 'ModelProviderSettingsDetail',
          template: '<div data-testid="generic-detail" />'
        }),
        AnthropicProviderSettingsDetail: defineComponent({
          name: 'AnthropicProviderSettingsDetail',
          template: '<div data-testid="anthropic-detail" />'
        })
      }
    }
  })

  await flushPromises()

  return { wrapper, router, providerStore, modelStore, providerDeeplinkImportStore }
}

describe('ModelProviderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the generic provider settings detail for anthropic', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('[data-testid="generic-detail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="anthropic-detail"]').exists()).toBe(false)
  })

  it('confirms built-in provider imports and enables the provider', async () => {
    const preview = {
      kind: 'builtin',
      id: 'anthropic',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-import-1234',
      maskedApiKey: 'sk-i...1234',
      iconModelId: 'anthropic',
      willOverwrite: true
    }
    const { wrapper, providerStore, modelStore, providerDeeplinkImportStore, router } = await setup(
      {
        preview,
        providerEnabled: false
      }
    )

    await wrapper.get('[data-testid="confirm-import"]').trigger('click')
    await flushPromises()

    expect(providerStore.updateProviderApi).toHaveBeenCalledWith(
      'anthropic',
      'sk-import-1234',
      'https://proxy.example.com/v1'
    )
    expect(providerStore.updateProviderStatus).toHaveBeenCalledWith('anthropic', true)
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('anthropic')
    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'anthropic'
      }
    })
    expect(providerDeeplinkImportStore.clearPreview).toHaveBeenCalledTimes(1)
  })

  it('confirms custom provider imports and creates a new provider entry', async () => {
    const preview = {
      kind: 'custom',
      name: 'My Proxy',
      type: 'openai-completions',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-custom-5678',
      maskedApiKey: 'sk-c...5678',
      iconModelId: 'openai-completions'
    }
    const { wrapper, providerStore, modelStore, providerDeeplinkImportStore, router } = await setup(
      {
        preview
      }
    )

    await wrapper.get('[data-testid="confirm-import"]').trigger('click')
    await flushPromises()

    expect(providerStore.addCustomProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'custom-provider-id',
        name: 'My Proxy',
        apiType: 'openai-completions',
        apiKey: 'sk-custom-5678',
        baseUrl: 'https://custom.example.com/v1',
        enable: true,
        custom: true
      })
    )
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('custom-provider-id')
    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'custom-provider-id'
      }
    })
    expect(providerDeeplinkImportStore.clearPreview).toHaveBeenCalledTimes(1)
  })
})
