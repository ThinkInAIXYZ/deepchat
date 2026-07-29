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
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template:
    '<button data-testid="action-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
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
  emits: ['submit', 'input-change', 'name-change'],
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
      <button
        data-testid="change-server-name"
        @click="$emit('name-change'); $emit('input-change')"
      >
        change name
      </button>
      <button data-testid="change-server-command" @click="$emit('input-change')">
        change command
      </button>
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

  const notifyRenderer = vi.fn()
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
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
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
    mcpStore,
    notifyRenderer
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

    await wrapper.find('[data-testid="change-server-command"]').trigger('click')
    expect(wrapper.find('[data-testid="add-server-error"]').exists()).toBe(true)

    await wrapper.find('[data-testid="change-server-name"]').trigger('click')

    expect(wrapper.find('[data-testid="add-server-error"]').exists()).toBe(false)
  })

  it('keeps the add dialog open until the pending operation settles', async () => {
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

    expect(
      (wrapper.vm as unknown as { isAddServerDialogOpen: boolean }).isAddServerDialogOpen
    ).toBe(true)

    resolveAdd({ status: 'duplicate' })
    await flushPromises()

    expect(wrapper.find('[data-testid="add-server-error"]').text()).toBe(
      'settings.mcp.serverForm.nameDuplicate'
    )
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

  it('keeps edit failures in the dialog and closes only after a successful retry', async () => {
    const { wrapper, mcpStore } = await setup({ withServers: true })
    mcpStore.updateServer.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const viewModel = wrapper.vm as unknown as {
      isEditServerDialogOpen: boolean
      openEditServerDialog(serverName: string): void
      handleEditServer(serverName: string, config: Record<string, unknown>): Promise<void>
    }

    viewModel.openEditServerDialog('running-server')
    await viewModel.handleEditServer('running-server', { command: 'node' })
    await wrapper.vm.$nextTick()

    expect(viewModel.isEditServerDialogOpen).toBe(true)
    expect(wrapper.get('[data-testid="add-server-error"]').text()).toBe(
      'common.error.requestFailed'
    )

    await wrapper.findAll('[data-testid="change-server-command"]').at(-1)!.trigger('click')
    expect(wrapper.find('[data-testid="add-server-error"]').exists()).toBe(false)

    await viewModel.handleEditServer('running-server', { command: 'node' })

    expect(viewModel.isEditServerDialogOpen).toBe(false)
  })

  it('keeps remove failures in the confirmation dialog', async () => {
    const { wrapper, mcpStore } = await setup({ withServers: true })
    mcpStore.removeServer.mockResolvedValueOnce(false)
    const viewModel = wrapper.vm as unknown as {
      isRemoveConfirmDialogOpen: boolean
      handleRemoveServer(serverName: string): Promise<void>
      confirmRemoveServer(): Promise<void>
    }

    await viewModel.handleRemoveServer('running-server')
    await viewModel.confirmRemoveServer()
    await wrapper.vm.$nextTick()

    expect(viewModel.isRemoveConfirmDialogOpen).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toBe('common.error.requestFailed')
  })

  it('keeps callback authentication failures beside the callback input', async () => {
    const { wrapper, mcpStore, notifyRenderer } = await setup({ withServers: true })
    mcpStore.completeServerAuthFromCallbackUrl.mockResolvedValueOnce(null)

    await wrapper.find('[data-testid="authenticate-server"]').trigger('click')
    await flushPromises()
    const authCallbackInput = wrapper.findAll('input').at(-1)!
    await authCallbackInput.setValue('http://localhost:3333/callback?code=bad')
    await authCallbackInput.trigger('keydown.enter')
    await flushPromises()

    expect(wrapper.get('#mcp-auth-callback-error').text()).toBe('common.error.requestFailed')
    expect(notifyRenderer).not.toHaveBeenCalled()
  })

  it('reports toggle failures through the semantic notification port', async () => {
    const { wrapper, mcpStore, notifyRenderer } = await setup({ withServers: true })
    mcpStore.toggleServer.mockResolvedValueOnce(false)

    await wrapper.find('[data-testid="server-card"]').trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.mcp.toggleFailed',
      title: 'common.error.operationFailed',
      description: 'common.error.requestFailed'
    })
  })
})
