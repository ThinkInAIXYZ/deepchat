import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

const setup = async (query: Record<string, string> = {}) => {
  vi.resetModules()

  const route = reactive({
    query: { ...query }
  })

  const router = {
    replace: vi
      .fn()
      .mockImplementation(async ({ query: nextQuery }: { query?: Record<string, string> }) => {
        route.query = { ...(nextQuery || {}) }
      }),
    push: vi.fn()
  }

  const toast = vi.fn()
  const mcpStore = reactive({
    mcpEnabled: true,
    setMcpEnabled: vi.fn().mockResolvedValue(undefined),
    getNpmRegistryStatus: vi.fn().mockResolvedValue({
      currentRegistry: null,
      isFromCache: false,
      autoDetectEnabled: true,
      customRegistry: undefined
    }),
    refreshNpmRegistry: vi.fn().mockResolvedValue(undefined),
    setAutoDetectNpmRegistry: vi.fn().mockResolvedValue(undefined),
    setCustomNpmRegistry: vi.fn().mockResolvedValue(undefined),
    clearNpmRegistryCache: vi.fn().mockResolvedValue(undefined)
  })

  vi.doMock('vue-router', () => ({
    useRoute: () => route,
    useRouter: () => router
  }))
  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => mcpStore
  }))
  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({
      dir: 'ltr'
    })
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({
      toast
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const McpSettings = (await import('../../../src/renderer/settings/components/McpSettings.vue'))
    .default

  const wrapper = mount(McpSettings, {
    global: {
      stubs: {
        Switch: true,
        Button: buttonStub,
        Input: true,
        Icon: true,
        Separator: true,
        Collapsible: passthrough('Collapsible'),
        CollapsibleContent: passthrough('CollapsibleContent'),
        CollapsibleTrigger: passthrough('CollapsibleTrigger'),
        Dialog: passthrough('Dialog'),
        DialogTrigger: passthrough('DialogTrigger'),
        DialogContent: defineComponent({ name: 'DialogContent', template: '<div />' }),
        DialogHeader: defineComponent({ name: 'DialogHeader', template: '<div />' }),
        DialogTitle: defineComponent({ name: 'DialogTitle', template: '<div />' }),
        DialogDescription: defineComponent({ name: 'DialogDescription', template: '<div />' }),
        McpServers: defineComponent({
          name: 'McpServers',
          template: '<div data-testid="servers-view" />'
        }),
        McpBuiltinMarket: defineComponent({
          name: 'McpBuiltinMarket',
          emits: ['back'],
          template: '<button data-testid="market-view" @click="$emit(\'back\')">market</button>'
        })
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    router
  }
}

describe('McpSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the default MCP settings content when no subview is selected', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('[data-testid="servers-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="market-view"]').exists()).toBe(false)
  })

  it('renders the market subview and clears only the market query on back', async () => {
    const { wrapper, router } = await setup({ view: 'market', foo: '1' })

    expect(wrapper.find('[data-testid="market-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="servers-view"]').exists()).toBe(false)

    await wrapper.find('[data-testid="market-view"]').trigger('click')
    await flushPromises()

    expect(router.replace).toHaveBeenCalledWith({
      name: 'settings-mcp',
      query: { foo: '1' }
    })
  })
})
