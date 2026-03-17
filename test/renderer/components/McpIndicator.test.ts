import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const SwitchStub = defineComponent({
  name: 'Switch',
  props: {
    modelValue: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    ariaLabel: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  template:
    '<button role="switch" :aria-label="ariaLabel" :aria-checked="String(modelValue)" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>'
})

const buildTool = (name: string, serverName: string, source: 'mcp' | 'agent' = 'agent') => ({
  type: 'function',
  source,
  function: {
    name,
    description: `${name} description`,
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  server: {
    name: serverName,
    icons: '',
    description: `${serverName} description`
  }
})

const setup = async (options?: {
  hasActiveSession?: boolean
  activeAgentId?: string
  selectedAgentId?: string
  disabledAgentTools?: string[]
}) => {
  vi.resetModules()

  const mcpStore = reactive({
    enabledServers: [{ name: 'demo-server', icons: 'D', enabled: true }],
    enabledServerCount: 1,
    tools: [buildTool('mcp_tool', 'demo-server', 'mcp')]
  })

  const sessionStore = reactive({
    hasActiveSession: options?.hasActiveSession ?? true,
    activeSessionId: options?.hasActiveSession === false ? null : 's1',
    activeSession:
      options?.hasActiveSession === false
        ? null
        : {
            id: 's1',
            agentId: options?.activeAgentId ?? 'deepchat',
            projectDir: '/tmp/workspace'
          }
  })

  const draftStore = reactive({
    disabledAgentTools: [...(options?.disabledAgentTools ?? [])]
  })

  const agentStore = reactive({
    selectedAgentId: options?.selectedAgentId ?? 'deepchat'
  })

  const projectStore = reactive({
    selectedProject: {
      path: '/tmp/workspace',
      name: 'workspace'
    }
  })

  const toolPresenter = {
    getAllToolDefinitions: vi
      .fn()
      .mockResolvedValue([
        buildTool('read', 'agent-filesystem'),
        buildTool('exec', 'agent-filesystem'),
        buildTool('deepchat_question', 'agent-core'),
        buildTool('cdp_send', 'yobrowser'),
        buildTool('mcp_tool', 'demo-server', 'mcp')
      ])
  }

  const newAgentPresenter = {
    getSessionDisabledAgentTools: vi
      .fn()
      .mockResolvedValue([...(options?.disabledAgentTools ?? [])]),
    updateSessionDisabledAgentTools: vi
      .fn()
      .mockImplementation(async (_id: string, tools: string[]) => tools)
  }

  const windowPresenter = {
    createSettingsWindow: vi.fn().mockResolvedValue(undefined),
    getSettingsWindowId: vi.fn().mockReturnValue(1),
    sendToWindow: vi.fn()
  }

  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => mcpStore
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/draft', () => ({
    useDraftStore: () => draftStore
  }))
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/ui/project', () => ({
    useProjectStore: () => projectStore
  }))
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'toolPresenter') return toolPresenter
      if (name === 'newAgentPresenter') return newAgentPresenter
      return windowPresenter
    }
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'chat.input.mcp.badge') {
          return `MCP ${params?.count ?? 0}`
        }

        const translations: Record<string, string> = {
          'chat.input.mcp.title': 'Enabled MCP',
          'chat.input.mcp.empty': 'No enabled services',
          'chat.input.mcp.openSettings': 'Open MCP settings',
          'chat.input.tools.badge': 'Tools',
          'chat.input.tools.title': 'Tools',
          'chat.input.tools.mcpSection': 'MCP',
          'chat.input.tools.builtinSection': 'Built-in Tools',
          'chat.input.tools.loading': 'Loading tools...',
          'chat.input.tools.builtinEmpty': 'No built-in tools available',
          'chat.input.tools.groups.agentFilesystem': 'Agent Filesystem',
          'chat.input.tools.groups.agentCore': 'Agent Core',
          'chat.input.tools.groups.agentSkills': 'Agent Skills',
          'chat.input.tools.groups.deepchatSettings': 'DeepChat Settings',
          'chat.input.tools.groups.yobrowser': 'YoBrowser'
        }

        return translations[key] ?? key
      }
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({
      name: 'Icon',
      template: '<span class="icon-stub" />'
    })
  }))

  const McpIndicator = (await import('@/components/chat-input/McpIndicator.vue')).default
  const wrapper = mount(McpIndicator, {
    global: {
      stubs: {
        Button: ButtonStub,
        Switch: SwitchStub,
        Popover: passthrough('Popover'),
        PopoverTrigger: passthrough('PopoverTrigger'),
        PopoverContent: passthrough('PopoverContent'),
        Icon: true
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    draftStore,
    toolPresenter,
    newAgentPresenter
  }
}

describe('McpIndicator', () => {
  it('renders Tools badge for deepchat and toggles session-scoped built-in tools', async () => {
    const { wrapper, newAgentPresenter } = await setup({
      hasActiveSession: true,
      activeAgentId: 'deepchat'
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].text()).toContain('Tools')
    expect(wrapper.text()).toContain('Built-in Tools')
    expect(wrapper.text()).not.toContain('MCP 1')
    expect(wrapper.text().indexOf('Built-in Tools')).toBeLessThan(
      wrapper.text().indexOf('demo-server')
    )

    const execButton = buttons.find((button) => button.text() === 'exec')
    expect(execButton).toBeTruthy()

    await execButton!.trigger('click')
    await flushPromises()

    expect(newAgentPresenter.updateSessionDisabledAgentTools).toHaveBeenCalledWith('s1', ['exec'])
  })

  it('supports enabling and disabling a whole tool group', async () => {
    const { wrapper, newAgentPresenter } = await setup({
      hasActiveSession: true,
      activeAgentId: 'deepchat',
      disabledAgentTools: ['exec']
    })

    const groupSwitches = wrapper.findAll('[role="switch"]')
    const filesystemSwitch = groupSwitches[0]
    expect(filesystemSwitch).toBeTruthy()
    expect(filesystemSwitch.attributes('aria-checked')).toBe('true')

    await filesystemSwitch.trigger('click')
    await flushPromises()

    expect(newAgentPresenter.updateSessionDisabledAgentTools).toHaveBeenCalledWith('s1', [
      'exec',
      'read'
    ])
  })

  it('resets a fully disabled tool group back to all enabled when switched on', async () => {
    const { wrapper, newAgentPresenter } = await setup({
      hasActiveSession: true,
      activeAgentId: 'deepchat',
      disabledAgentTools: ['exec', 'read']
    })

    const groupSwitches = wrapper.findAll('[role="switch"]')
    const filesystemSwitch = groupSwitches[0]
    expect(filesystemSwitch).toBeTruthy()
    expect(filesystemSwitch.attributes('aria-checked')).toBe('false')

    await filesystemSwitch.trigger('click')
    await flushPromises()

    expect(newAgentPresenter.updateSessionDisabledAgentTools).toHaveBeenCalledWith('s1', [])
  })

  it('renders MCP badge for ACP sessions and keeps built-in tools hidden', async () => {
    const { wrapper, toolPresenter } = await setup({
      hasActiveSession: true,
      activeAgentId: 'acp-coder'
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].text()).toContain('MCP 1')
    expect(wrapper.text()).not.toContain('Built-in Tools')
    expect(toolPresenter.getAllToolDefinitions).not.toHaveBeenCalled()
  })

  it('updates draft disabled tools for deepchat new thread mode', async () => {
    const { wrapper, draftStore, newAgentPresenter } = await setup({
      hasActiveSession: false,
      selectedAgentId: 'deepchat'
    })

    const execButton = wrapper.findAll('button').find((button) => button.text() === 'exec')
    expect(execButton).toBeTruthy()

    await execButton!.trigger('click')
    await flushPromises()

    expect(draftStore.disabledAgentTools).toEqual(['exec'])
    expect(newAgentPresenter.updateSessionDisabledAgentTools).not.toHaveBeenCalled()
  })
})
