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

const dropdownItemStub = defineComponent({
  name: 'DropdownMenuItem',
  emits: ['click'],
  template: '<button data-testid="dropdown-item" @click="$emit(\'click\')"><slot /></button>'
})

const mcpServerCardStub = defineComponent({
  name: 'McpServerCard',
  props: {
    server: {
      type: Object,
      required: true
    }
  },
  template: '<div data-testid="server-card">{{ server.name }}</div>'
})

const setup = async (
  overrides: Partial<{
    serverList: Array<{ name: string }>
    config: {
      mcpServers: Record<string, Record<string, unknown>>
    }
  }> = {}
) => {
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
  const serverList = overrides.serverList ?? []
  const config = {
    mcpServers: {
      ...(overrides.config?.mcpServers ?? {})
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
        DropdownMenu: passthrough('DropdownMenu'),
        DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
        DropdownMenuContent: passthrough('DropdownMenuContent'),
        DropdownMenuItem: dropdownItemStub,
        McpServerCard: mcpServerCardStub,
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
    router
  }
}

describe('McpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('open', vi.fn())
  })

  it('renders the market button before the add button in the footer action area', async () => {
    const { wrapper } = await setup()
    const actionButtons = wrapper.findAll('[data-testid="action-button"]')

    expect(actionButtons[0]?.text()).toContain('routes.settings-mcp-market')
    expect(actionButtons[1]?.text()).toContain('common.add')
  })

  it('opens the MCP market subview and Higress from the footer menu', async () => {
    const { wrapper, router } = await setup()
    const dropdownItems = wrapper.findAll('[data-testid="dropdown-item"]')

    await dropdownItems[0]?.trigger('click')
    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-mcp',
      query: {
        view: 'market'
      }
    })

    await dropdownItems[1]?.trigger('click')
    expect(window.open).toHaveBeenCalledWith('https://mcp.higress.ai/?from=deepchat', '_blank')
  })

  it('hides plugin-owned MCP servers from the global settings list', async () => {
    const { wrapper } = await setup({
      serverList: [{ name: 'feishu-tools' }, { name: 'user-server' }],
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

    expect(cards).toEqual(['user-server'])
    expect(wrapper.text()).not.toContain('feishu-tools')
  })

  it('shows the empty state when only plugin-owned MCP servers exist', async () => {
    const { wrapper } = await setup({
      serverList: [{ name: 'feishu-tools' }],
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
