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

  const notifyRenderer = vi.fn()
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
    setMcpEnabled: vi.fn().mockResolvedValue(true),
    getNpmRegistryStatus: vi.fn().mockResolvedValue({
      currentRegistry: null,
      isFromCache: false,
      autoDetectEnabled: true,
      customRegistry: undefined
    }),
    refreshNpmRegistry: vi.fn().mockResolvedValue('https://registry.npmjs.org/'),
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
      focusMainWindow: vi.fn().mockResolvedValue(true),
      resumeGuidedOnboarding: vi.fn().mockResolvedValue({ requested: true, focused: true })
    })
  }))
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
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
        DcButton: buttonStub,
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
            serverLoadingOverrides: { type: Object, default: () => ({}) },
            agentScopedToggle: { type: Boolean, default: false },
            agentScopedBusy: { type: Boolean, default: false }
          },
          emits: ['toggle-agent-server'],
          template:
            '<button data-testid="servers-view" :disabled="agentScopedBusy" @click="$emit(\'toggle-agent-server\', \'Custom\', true)">{{ agentScopedToggle }}:{{ serverEnabledOverrides.Custom }}:{{ serverLoadingOverrides.Custom }}</button>'
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
    mcpStore,
    notifyRenderer
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
    const { wrapper, configClient, mcpStore, notifyRenderer } = await setup({}, { scope: 'agent' })

    expect(wrapper.find('[data-testid="servers-view"]').text()).toContain('true:false:')

    await wrapper.find('[data-testid="servers-view"]').trigger('click')
    await flushPromises()

    expect(mcpStore.setMcpEnabled).not.toHaveBeenCalled()
    expect(configClient.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: {
        enabledMcpServerIds: ['Artifacts', 'Custom']
      }
    })
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        code: 'settings.agentMcpPolicy.saved',
        title: 'settings.mcp.saveSuccess'
      })
    )
  })

  it('optimistically reflects one agent policy write and blocks overlapping toggles', async () => {
    const { wrapper, configClient } = await setup({}, { scope: 'agent' })
    let resolveUpdate: (agent: Record<string, unknown>) => void = () => undefined
    configClient.updateDeepChatAgent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        })
    )
    const serverView = wrapper.get('[data-testid="servers-view"]')

    await serverView.trigger('click')
    await wrapper.vm.$nextTick()

    expect(serverView.text()).toContain('true:true:true')
    expect(serverView.attributes('disabled')).toBeDefined()
    await serverView.trigger('click')
    expect(configClient.updateDeepChatAgent).toHaveBeenCalledTimes(1)

    resolveUpdate({
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      config: {
        enabledMcpServerIds: ['Artifacts', 'Custom']
      }
    })
    await flushPromises()

    expect(serverView.attributes('disabled')).toBeUndefined()
  })

  it('rolls back failed agent-scoped toggles and reports the failure toast', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, configClient, notifyRenderer } = await setup({}, { scope: 'agent' })
    configClient.updateDeepChatAgent.mockRejectedValueOnce(new Error('write failed'))

    await wrapper.find('[data-testid="servers-view"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="servers-view"]').text()).toContain('true:false:')
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.agentMcpPolicy.saveFailed',
        title: 'settings.mcp.saveFailed',
        description: 'common.error.requestFailed'
      })
    )
    consoleError.mockRestore()
  })

  it('reports a failed global master toggle through the semantic port', async () => {
    const { wrapper, mcpStore, notifyRenderer } = await setup()
    mcpStore.setMcpEnabled.mockResolvedValueOnce(false)
    const viewModel = wrapper.vm as unknown as {
      handleMcpEnabledChange(enabled: boolean): Promise<void>
    }

    await viewModel.handleMcpEnabledChange(false)

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.mcp.masterToggleFailed',
      title: 'common.error.operationFailed',
      description: 'common.error.requestFailed'
    })
  })

  it('keeps npm registry refresh failures inside the advanced settings surface', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, mcpStore, notifyRenderer } = await setup()
    mcpStore.refreshNpmRegistry.mockRejectedValueOnce(new Error('offline'))
    const viewModel = wrapper.vm as unknown as {
      npmRegistryFeedback: { kind: string; message: string } | null
      refreshNpmRegistry(): Promise<void>
    }

    await viewModel.refreshNpmRegistry()

    expect(viewModel.npmRegistryFeedback).toEqual({
      kind: 'error',
      message: 'settings.mcp.npmRegistry.refreshFailed'
    })
    expect(notifyRenderer).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('keeps a successful registry write authoritative when status refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true
    } as Response)
    const { wrapper, mcpStore, notifyRenderer } = await setup()
    mcpStore.getNpmRegistryStatus.mockRejectedValueOnce(new Error('status unavailable'))
    const viewModel = wrapper.vm as unknown as {
      customRegistryInput: string
      npmRegistryStatus: {
        currentRegistry: string | null
        customRegistry?: string
      }
      npmRegistryFeedback: { kind: string; message: string } | null
      saveCustomNpmRegistry(): Promise<void>
    }
    viewModel.customRegistryInput = 'https://registry.example.test'

    await viewModel.saveCustomNpmRegistry()

    expect(mcpStore.setCustomNpmRegistry).toHaveBeenCalledWith('https://registry.example.test')
    expect(viewModel.npmRegistryStatus.currentRegistry).toBe('https://registry.example.test/')
    expect(viewModel.npmRegistryStatus.customRegistry).toBe('https://registry.example.test/')
    expect(viewModel.npmRegistryFeedback).toBeNull()
    expect(notifyRenderer).not.toHaveBeenCalled()
    fetchMock.mockRestore()
    consoleError.mockRestore()
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
