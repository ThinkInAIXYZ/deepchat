import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const setup = async () => {
  vi.resetModules()

  const providerStore = reactive({
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        apiType: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
        enable: true
      }
    ],
    sortedProviders: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        apiType: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
        enable: true
      }
    ],
    refreshProviders: vi.fn().mockResolvedValue(undefined),
    updateProviderConfig: vi.fn().mockResolvedValue(undefined),
    updateProviderStatus: vi.fn().mockResolvedValue(undefined),
    updateProvidersOrder: vi.fn(),
    defaultProviders: []
  })

  const modelStore = reactive({
    allProviderModels: [{ providerId: 'anthropic', models: [{ id: 'claude-sonnet' }] }],
    refreshAllModels: vi.fn().mockResolvedValue(undefined)
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
})
