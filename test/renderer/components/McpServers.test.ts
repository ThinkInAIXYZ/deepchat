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
  emits: ['toggle', 'authenticate'],
  template: `
    <div>
      <button data-testid="server-card" @click="$emit('toggle')">{{ server.name }}:{{ server.enabled }}</button>
      <button data-testid="authenticate-server" @click="$emit('authenticate')">auth</button>
    </div>
  `
})

const mcpServerFormStub = defineComponent({
  name: 'McpServerForm',
  props: {
    submitting: { type: Boolean, default: false },
    nameError: { type: String, default: undefined },
    submissionError: { type: String, default: undefined }
  },
  emits: ['submit', 'input-change'],
  template: `
    <div>
      <p v-if="nameError || submissionError" data-testid="add-server-error">
        {{ nameError || submissionError }}
      </p>
      <button
        data-testid="submit-server"
        :disabled="submitting"
        @click="$emit('submit', 'duplicate-server', { type: 'stdio', command: 'node' })"
      >
        submit
      </button>
      <button data-testid="change-server-name" @click="$emit('input-change')">change</button>
    </div>
  `
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
    addServer: vi.fn().mockResolvedValue({ status: 'added' }),
    updateServer: vi.fn().mockResolvedValue(true),
    removeServer: vi.fn().mockResolvedValue(true),
    toggleServer: vi.fn().mockResolvedValue(true),
    startServerAuth: vi.fn().mockResolvedValue({
      serverName: 'running-server',
      state: 'authenticating',
      authenticated: false
    }),
    completeServerAuthFromCallbackUrl: vi.fn(),
    updateServerAuthStatus: vi.fn().mockResolvedValue(null),
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
        DialogContent: passthrough('DialogContent'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        McpServerCard: serverCardStub,
        McpServerForm: mcpServerFormStub,
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

  it('keeps duplicate add feedback inline until the server name changes', async () => {
    const { wrapper, mcpStore } = await setup()
    mcpStore.addServer.mockResolvedValueOnce({ status: 'duplicate' })

    ;(wrapper.vm as unknown as { openAddServerDialog: () => void }).openAddServerDialog()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="submit-server"]').trigger('click')
    await flushPromises()

    expect(mcpStore.addServer).toHaveBeenCalledWith('duplicate-server', {
      type: 'stdio',
      command: 'node'
    })
    expect(wrapper.find('[data-testid="add-server-error"]').text()).toBe(
      'settings.mcp.serverForm.nameDuplicate'
    )
    expect(mcpStore.clearMcpInstallCache).not.toHaveBeenCalled()

    await wrapper.find('[data-testid="change-server-name"]').trigger('click')

    expect(wrapper.find('[data-testid="add-server-error"]').exists()).toBe(false)
  })

  it('ignores an add result after its dialog generation closes', async () => {
    const { wrapper, mcpStore } = await setup()
    let resolveAdd: (result: { status: 'duplicate' }) => void = () => undefined
    mcpStore.addServer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve
        })
    )

    ;(wrapper.vm as unknown as { openAddServerDialog: () => void }).openAddServerDialog()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="submit-server"]').trigger('click')
    wrapper.findAllComponents({ name: 'Dialog' })[0].vm.$emit('update:open', false)
    await wrapper.vm.$nextTick()
    resolveAdd({ status: 'duplicate' })
    await flushPromises()

    expect(wrapper.find('[data-testid="add-server-error"]').exists()).toBe(false)
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

  it('refreshes auth status when returning to the callback dialog', async () => {
    const { wrapper, mcpStore } = await setup({ withServers: true })
    mcpStore.updateServerAuthStatus.mockResolvedValueOnce({
      serverName: 'running-server',
      state: 'authenticated',
      authenticated: true
    })

    await wrapper.find('[data-testid="authenticate-server"]').trigger('click')
    await flushPromises()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(mcpStore.startServerAuth).toHaveBeenCalledWith('running-server')
    expect(mcpStore.updateServerAuthStatus).toHaveBeenCalledTimes(1)
    expect(mcpStore.updateServerAuthStatus).toHaveBeenCalledWith('running-server', true)
  })

  it('ignores duplicate callback URL submissions while one is pending', async () => {
    const { wrapper, mcpStore } = await setup({ withServers: true })
    mcpStore.completeServerAuthFromCallbackUrl.mockImplementation(() => new Promise(() => {}))

    await wrapper.find('[data-testid="authenticate-server"]').trigger('click')
    await flushPromises()

    const authCallbackInput = wrapper.findAll('input').at(-1)
    expect(authCallbackInput).toBeTruthy()

    await authCallbackInput!.setValue('http://localhost:3333/callback?code=code&state=state')
    await authCallbackInput!.trigger('keydown.enter')
    await authCallbackInput!.trigger('keydown.enter')

    expect(mcpStore.completeServerAuthFromCallbackUrl).toHaveBeenCalledTimes(1)
  })
})
