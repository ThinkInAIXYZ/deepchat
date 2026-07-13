import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const TEST_TIMEOUT_MS = 20000

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

const setup = async (
  query: Record<string, string> = {},
  props: Record<string, unknown> = {},
  options: { mcpEnabled?: boolean } = {}
) => {
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
  const configClient = {
    listAgents: vi.fn().mockResolvedValue([
      {
        id: 'deepchat',
        type: 'deepchat',
        name: 'DeepChat',
        enabled: true,
        config: {
          enabledMcpServerIds: ['Artifacts']
        }
      }
    ]),
    resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
      enabledMcpServerIds: ['Artifacts']
    }),
    updateDeepChatAgent: vi.fn().mockResolvedValue({
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      config: {
        enabledMcpServerIds: ['Artifacts', 'Custom']
      }
    })
  }
  const agentStore = {
    selectedAgentId: 'deepchat',
    refreshAgentsByIds: vi.fn().mockResolvedValue(undefined)
  }
  const mcpStore = reactive({
    mcpEnabled: options.mcpEnabled ?? true,
    configLoading: false,
    serverList: [
      {
        name: 'Artifacts',
        enabled: true,
        isRunning: true
      },
      {
        name: 'Custom',
        enabled: false,
        isRunning: false
      }
    ],
    config: {
      ready: true,
      mcpServers: {
        Artifacts: {
          type: 'inmemory',
          source: 'deepchat'
        },
        Custom: {
          type: 'stdio'
        }
      }
    },
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
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => ({
      activeSession: null
    })
  }))
  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@/composables/useGuidedOnboardingStep', () => ({
    useGuidedOnboardingStep: () => ({
      showGuide: ref(false),
      stepIndex: ref(1),
      totalSteps: ref(6),
      dismissGuide: vi.fn(),
      completeStep: vi.fn().mockResolvedValue(null),
      skipStep: vi.fn().mockResolvedValue(null)
    })
  }))
  vi.doMock('@api/WindowClient', () => ({
    createWindowClient: () => ({
      focusMainWindow: vi.fn().mockResolvedValue(true)
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
    props,
    global: {
      stubs: {
        Switch: true,
        Button: buttonStub,
        Input: true,
        Icon: true,
        Separator: true,
        Card: passthrough('Card'),
        CardContent: passthrough('CardContent'),
        CardDescription: passthrough('CardDescription'),
        CardHeader: passthrough('CardHeader'),
        CardTitle: passthrough('CardTitle'),
        Collapsible: passthrough('Collapsible'),
        CollapsibleContent: passthrough('CollapsibleContent'),
        CollapsibleTrigger: passthrough('CollapsibleTrigger'),
        Dialog: passthrough('Dialog'),
        DialogTrigger: passthrough('DialogTrigger'),
        DialogContent: defineComponent({ name: 'DialogContent', template: '<div />' }),
        DialogHeader: defineComponent({ name: 'DialogHeader', template: '<div />' }),
        DialogTitle: defineComponent({ name: 'DialogTitle', template: '<div />' }),
        DialogDescription: defineComponent({ name: 'DialogDescription', template: '<div />' }),
        GuidedOnboardingOverlay: true,
        McpServers: defineComponent({
          name: 'McpServers',
          props: {
            serverEnabledOverrides: { type: Object, default: () => ({}) },
            agentScopedToggle: { type: Boolean, default: false }
          },
          emits: ['toggle-agent-server'],
          template:
            '<button data-testid="servers-view" @click="$emit(\'toggle-agent-server\', \'Custom\', true)">{{ agentScopedToggle }}:{{ serverEnabledOverrides.Custom }}</button>'
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
    router,
    configClient,
    mcpStore
  }
}

describe('McpSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it(
    'renders the default MCP settings content when no subview is selected',
    async () => {
      const { wrapper } = await setup()

      expect(wrapper.find('[data-testid="servers-view"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="market-view"]').exists()).toBe(false)
    },
    TEST_TIMEOUT_MS
  )

  it('keeps the MCP page frame static around the scrolling server list', async () => {
    const { wrapper } = await setup()
    const serverView = wrapper.find('[data-testid="servers-view"]')
    const serverPanel = serverView.element.parentElement
    const scrollFrame = serverPanel?.parentElement

    expect(wrapper.find('[data-testid="settings-mcp-page"]').classes()).toContain('min-h-0')
    expect(serverPanel?.className).toContain('min-h-0')
    expect(scrollFrame?.className).toContain('overflow-hidden')
  })

  it('respects the global MCP master switch in agent scope', async () => {
    const { wrapper } = await setup({}, { scope: 'agent' }, { mcpEnabled: false })

    expect(wrapper.find('[data-testid="servers-view"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('settings.mcp.enableToAccess')
  })

  it('saves MCP server toggles to the current agent in agent scope', async () => {
    const { wrapper, configClient, mcpStore } = await setup({}, { scope: 'agent' })

    expect(wrapper.find('[data-testid="servers-view"]').text()).toContain('true:false')

    await wrapper.find('[data-testid="servers-view"]').trigger('click')
    await flushPromises()

    expect(mcpStore.setMcpEnabled).not.toHaveBeenCalled()
    expect(configClient.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: {
        enabledMcpServerIds: ['Artifacts', 'Custom']
      }
    })
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
