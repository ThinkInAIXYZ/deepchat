import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button data-testid="action-button" @click="$emit(\'click\')"><slot /></button>'
})

const serverCardStub = defineComponent({
  name: 'McpServerCard',
  props: {
    server: {
      type: Object,
      required: true
    }
  },
  emits: ['toggle'],
  template:
    '<button data-testid="server-card" @click="$emit(\'toggle\')">{{ server.name }}:{{ server.enabled }}</button>'
})

type SetupOptions = {
  withServers?: boolean
  showFooterAddButton?: boolean
  serverList?: Array<Record<string, unknown> & { name: string }>
  config?: {
    mcpServers?: Record<string, Record<string, unknown>>
  }
}

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()

  const router = {
    currentRoute: {
      value: {
        query: {}
      }
    },
    push: vi.fn().mockResolvedValue(undefined)
  }

  const toast = vi.fn()
  const defaultServerList = options.withServers
    ? [
        {
          name: 'running-server',
          icons: '',
          descriptions: '',
          command: '',
          args: [],
          enabled: true,
          isRunning: true
        },
        {
          name: 'stopped-server',
          icons: '',
          descriptions: '',
          command: '',
          args: [],
          enabled: false,
          isRunning: false
        }
      ]
    : []
  const defaultMcpServers = options.withServers
    ? {
        'running-server': { type: 'stdio' },
        'stopped-server': { type: 'stdio' }
      }
    : {}
  const serverList = options.serverList ?? defaultServerList
  const config = {
    mcpServers: {
      ...defaultMcpServers,
      ...(options.config?.mcpServers ?? {})
    }
  }
  const mcpStore = reactive({
    mcpInstallCache: '',
    clearMcpInstallCache: vi.fn(),
    serverList,
    config,
    configLoading: false,
    tools: [],
    visibleTools: [],
    prompts: [],
    visiblePrompts: [],
    resources: [],
    visibleResources: [],
    serverLoadingStates: {},
    addServer: vi.fn().mockResolvedValue({ success: true }),
    updateServer: vi.fn().mockResolvedValue(true),
    removeServer: vi.fn().mockResolvedValue(true),
    toggleServer: vi.fn().mockResolvedValue(true),
    loadTools: vi.fn().mockResolvedValue(undefined),
    loadPrompts: vi.fn().mockResolvedValue(undefined),
    loadResources: vi.fn().mockResolvedValue(undefined)
  })

  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => mcpStore
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
  vi.doMock('vue-router', () => ({
    useRouter: () => router
  }))

  const McpServers = (await import('@/components/mcp-config/components/McpServers.vue')).default

  const wrapper = mount(McpServers, {
    props: {
      showFooterAddButton: options.showFooterAddButton
    },
    global: {
      stubs: {
        Button: buttonStub,
        ScrollArea: passthrough('ScrollArea'),
        Dialog: passthrough('Dialog'),
        DialogTrigger: passthrough('DialogTrigger'),
        DialogContent: defineComponent({ name: 'DialogContent', template: '<div />' }),
        DialogHeader: defineComponent({ name: 'DialogHeader', template: '<div />' }),
        DialogTitle: defineComponent({ name: 'DialogTitle', template: '<div />' }),
        DialogDescription: defineComponent({ name: 'DialogDescription', template: '<div />' }),
        DialogFooter: defineComponent({ name: 'DialogFooter', template: '<div />' }),
        McpServerCard: serverCardStub,
        McpServerForm: true,
        McpToolPanel: true,
        McpPromptPanel: true,
        McpResourceViewer: true,
        Icon: true
      }
    }
  })

  return {
    wrapper,
    router,
    mcpStore
  }
}

describe('McpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('open', vi.fn())
  })

  it('renders the add button in the footer action area', async () => {
    const { wrapper } = await setup()
    const actionButtons = wrapper.findAll('[data-testid="action-button"]')

    expect(actionButtons[0]?.text()).toContain('common.add')
  })

  it('can hide the footer add button for settings header ownership', async () => {
    const { wrapper } = await setup({ showFooterAddButton: false })

    expect(wrapper.text()).not.toContain('common.add')
  })

  it('only shows all, running, and stopped filters', async () => {
    const { wrapper } = await setup({ withServers: true })

    expect(wrapper.text()).toContain('settings.mcp.center.filters.all')
    expect(wrapper.text()).toContain('settings.mcp.center.filters.running')
    expect(wrapper.text()).toContain('settings.mcp.center.filters.stopped')
    expect(wrapper.text()).not.toContain('settings.mcp.center.filters.builtIn')
    expect(wrapper.text()).not.toContain('settings.mcp.center.filters.custom')
  })

  it('hides plugin-owned MCP servers from the global settings list', async () => {
    const { wrapper } = await setup({
      serverList: [{ name: 'user-server' }],
      config: {
        mcpServers: {
          'feishu-tools': {
            type: 'stdio',
            command: 'node',
            args: [],
            enabled: true,
            source: 'plugin',
            ownerPluginId: 'com.deepchat.plugins.feishu'
          },
          'user-server': {
            type: 'stdio',
            command: 'node',
            args: [],
            enabled: true
          }
        }
      }
    })

    const cards = wrapper.findAll('[data-testid="server-card"]').map((card) => card.text())

    expect(cards).toEqual(['user-server:false'])
    expect(wrapper.text()).not.toContain('feishu-tools')
  })

  it('uses agent-scoped toggle overrides without toggling the global server', async () => {
    const { wrapper, mcpStore } = await setup({ withServers: true })

    await wrapper.setProps({
      agentScopedToggle: true,
      serverEnabledOverrides: {
        'running-server': false
      }
    })
    await wrapper.find('[data-testid="server-card"]').trigger('click')

    expect(wrapper.find('[data-testid="server-card"]').text()).toContain('running-server:false')
    expect(mcpStore.toggleServer).not.toHaveBeenCalled()
    expect(wrapper.emitted('toggle-agent-server')?.[0]).toEqual(['running-server', true])
  })

  it('allows agent-scoped toggles for DeepChat-managed servers without global toggles', async () => {
    const { wrapper, mcpStore } = await setup({
      serverList: [
        {
          name: 'Artifacts',
          icons: '',
          descriptions: '',
          command: '',
          args: [],
          enabled: true,
          isRunning: true
        }
      ],
      config: {
        mcpServers: {
          Artifacts: {
            type: 'inmemory',
            source: 'deepchat'
          }
        }
      }
    })

    await wrapper.setProps({
      agentScopedToggle: true,
      serverEnabledOverrides: {
        Artifacts: false
      }
    })
    await wrapper.find('[data-testid="server-card"]').trigger('click')

    expect(wrapper.find('[data-testid="server-card"]').text()).toContain('Artifacts:false')
    expect(mcpStore.toggleServer).not.toHaveBeenCalled()
    expect(wrapper.emitted('toggle-agent-server')?.[0]).toEqual(['Artifacts', true])
  })

  it('shows the empty state when only plugin-owned MCP servers exist', async () => {
    const { wrapper } = await setup({
      serverList: [],
      config: {
        mcpServers: {
          'feishu-tools': {
            type: 'stdio',
            command: 'node',
            args: [],
            enabled: true,
            source: 'plugin',
            ownerPluginId: 'com.deepchat.plugins.feishu'
          }
        }
      }
    })

    expect(wrapper.text()).toContain('settings.mcp.noServersFound')
    expect(wrapper.findAll('[data-testid="server-card"]')).toHaveLength(0)
  })
})
