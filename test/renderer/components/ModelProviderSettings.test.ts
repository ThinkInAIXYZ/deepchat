import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const draggableStub = defineComponent({
  name: 'draggable',
  props: {
    modelValue: {
      type: Array,
      default: () => []
    },
    itemKey: {
      type: String,
      default: 'id'
    }
  },
  template:
    '<div><slot v-for="element in modelValue" name="item" :element="element" :key="element[itemKey] ?? element.id" /></div>'
})

const setup = async (options?: {
  routeProviderId?: string | undefined
  providers?: Array<{
    id: string
    name: string
    apiType: string
    apiKey: string
    baseUrl: string
    enable: boolean
  }>
}) => {
  vi.resetModules()
  const routeProviderId =
    options && 'routeProviderId' in options ? options.routeProviderId : 'anthropic'

  const provider = {
    id: 'anthropic',
    name: 'Anthropic',
    apiType: 'anthropic',
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com',
    enable: true
  }
  const providers = options?.providers ?? [provider]
  const providerStore = reactive({
    providers,
    sortedProviders: providers,
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
  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => ({ isDark: false })
  }))
  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({ dir: 'ltr' })
  }))
  vi.doMock('vue-router', () => ({
    useRoute: () => ({
      params: routeProviderId ? { providerId: routeProviderId } : {}
    }),
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
        draggable: draggableStub,
        AddCustomProviderDialog: true,
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

  return { wrapper, router }
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

  it('navigates to the selected provider when a provider row is clicked', async () => {
    const { wrapper, router } = await setup()

    await wrapper.get('[data-provider-id="anthropic"]').trigger('click')

    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'anthropic'
      }
    })
  })

  it('skips ACP when auto-selecting the default provider settings view', async () => {
    const { router } = await setup({
      routeProviderId: undefined,
      providers: [
        {
          id: 'acp',
          name: 'ACP',
          apiType: 'openai',
          apiKey: '',
          baseUrl: '',
          enable: true
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          apiType: 'anthropic',
          apiKey: 'test-key',
          baseUrl: 'https://api.anthropic.com',
          enable: true
        }
      ]
    })

    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'anthropic'
      }
    })
    expect(router.replace).not.toHaveBeenCalledWith({ name: 'settings-acp' })
  })
})
