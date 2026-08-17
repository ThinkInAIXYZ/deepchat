import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  props: {
    as: { type: String, default: 'button' },
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  render() {
    return h(
      this.as,
      {
        ...this.$attrs,
        disabled: this.as === 'button' ? this.disabled : undefined,
        onClick: () => this.$emit('click')
      },
      this.$slots.default?.()
    )
  }
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
    '<button v-bind="$attrs" role="switch" :aria-label="ariaLabel" :aria-checked="String(modelValue)" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>'
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
  pluginEnabled?: boolean
  regularMcpEnabled?: boolean
  providerId?: string
  modelId?: string
  defaultToolMode?: 'agent' | 'code' | 'minimal'
  toolModeOverride?: 'agent' | 'code' | 'minimal' | null
  sessionStatus?: 'completed' | 'working' | 'error' | 'none'
  subagentsAvailable?: boolean
}) => {
  vi.resetModules()
  let skillSessionChangedHandler:
    | ((payload: {
        conversationId?: string | null
        skills?: string[]
        change: 'activated' | 'deactivated'
      }) => void)
    | undefined
  const skillEvents = {
    emitSessionChanged: (payload: {
      conversationId?: string
      skills?: string[]
      change: 'activated' | 'deactivated'
    }) => {
      skillSessionChangedHandler?.({
        conversationId: payload.conversationId ?? null,
        skills: payload.skills,
        change: payload.change
      })
    }
  }

  const pluginTools = options?.pluginEnabled
    ? [buildTool('check_permissions', 'cua-driver', 'mcp')]
    : []
  const regularMcpEnabled = options?.regularMcpEnabled ?? true
  const mcpStore = reactive({
    enabledServers: regularMcpEnabled ? [{ name: 'demo-server', icons: 'D', enabled: true }] : [],
    enabledPluginServers: options?.pluginEnabled
      ? [{ name: 'cua-driver', icons: 'plugin', descriptions: 'CUA Driver', enabled: true }]
      : [],
    enabledServerCount: regularMcpEnabled ? 1 : 0,
    tools: regularMcpEnabled ? [buildTool('mcp_tool', 'demo-server', 'mcp')] : [],
    visibleTools: regularMcpEnabled ? [buildTool('mcp_tool', 'demo-server', 'mcp')] : [],
    pluginTools
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
            projectDir: '/tmp/workspace',
            providerId: options?.providerId ?? 'deepseek',
            modelId: options?.modelId ?? 'deepseek-chat',
            toolModeOverride: options?.toolModeOverride ?? null,
            status: options?.sessionStatus ?? 'none'
          },
    setSessionToolMode: vi.fn(async (override: 'agent' | 'code' | 'minimal' | null) => {
      if (sessionStore.activeSession) sessionStore.activeSession.toolModeOverride = override
    })
  })

  const draftStore = reactive({
    disabledAgentTools: [...(options?.disabledAgentTools ?? [])],
    providerId: options?.providerId ?? 'deepseek',
    modelId: options?.modelId ?? 'deepseek-chat',
    toolModeOverride: options?.toolModeOverride ?? null
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

  const toolService = {
    getConfigurableAgentToolDefinitions: vi
      .fn()
      .mockResolvedValue([
        buildTool('read', 'agent-filesystem'),
        buildTool('exec', 'agent-filesystem'),
        buildTool('deepchat_question', 'agent-core'),
        buildTool('update_plan', 'agent-core'),
        buildTool('cdp_send', 'yobrowser'),
        buildTool('mcp_tool', 'demo-server', 'mcp')
      ])
  }

  const agentSessionPresenter = {
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
  vi.doMock('@/composables/useModelCapabilities', () => ({
    useModelCapabilities: () => ({
      snapshot: ref(options?.defaultToolMode ? { defaultToolMode: options.defaultToolMode } : null)
    })
  }))
  vi.doMock('@api/ToolClient', () => ({
    createToolClient: vi.fn(() => ({
      getConfigurableAgentToolDefinitions: toolService.getConfigurableAgentToolDefinitions
    }))
  }))
  vi.doMock('@api/SessionClient', () => ({
    createSessionClient: vi.fn(() => ({
      getSessionDisabledAgentTools: agentSessionPresenter.getSessionDisabledAgentTools,
      updateSessionDisabledAgentTools: agentSessionPresenter.updateSessionDisabledAgentTools
    }))
  }))
  vi.doMock('@api/SkillClient', () => ({
    createSkillClient: vi.fn(() => ({
      onSessionChanged: vi.fn(
        (
          listener: (payload: {
            conversationId?: string | null
            skills?: string[]
            change: 'activated' | 'deactivated'
          }) => void
        ) => {
          skillSessionChangedHandler = listener
          return () => {
            if (skillSessionChangedHandler === listener) {
              skillSessionChangedHandler = undefined
            }
          }
        }
      )
    }))
  }))
  vi.doMock('@api/SettingsClient', () => ({
    createSettingsClient: vi.fn(() => ({
      openSettings: windowPresenter.createSettingsWindow
    }))
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'chat.input.mcp.badge') {
          return `MCP ${params?.count ?? 0}`
        }

        const translations: Record<string, string> = {
          'chat.advancedSettings.title': 'Advanced Settings',
          'chat.advancedSettings.systemPrompt': 'System Prompt',
          'chat.advancedSettings.systemPromptPlaceholder': 'Select preset',
          'chat.advancedSettings.currentCustomPrompt': 'Current custom',
          'chat.input.mcp.title': 'Enabled MCP',
          'chat.input.mcp.empty': 'No enabled services',
          'chat.input.mcp.openSettings': 'Open MCP settings',
          'chat.input.tools.badge': 'Tools',
          'chat.input.tools.title': 'Tools',
          'chat.input.tools.mcpSection': 'MCP',
          'chat.input.tools.pluginSection': 'Plugins',
          'chat.input.tools.loading': 'Loading tools...',
          'chat.input.tools.builtinEmpty': 'No built-in tools available',
          'chat.input.tools.groups.agentFilesystem': 'Agent Filesystem',
          'chat.input.tools.groups.agentCore': 'Agent Core',
          'chat.input.tools.groups.agentSkills': 'Agent Skills',
          'chat.input.tools.groups.deepchatSettings': 'DeepChat Settings',
          'chat.input.tools.groups.yobrowser': 'YoBrowser',
          'chat.input.toolMode.title': 'Mode',
          'chat.input.toolMode.modelDefault': 'Model default',
          'chat.input.toolMode.useModelDefault': 'Use model default',
          'chat.input.toolMode.options.agent': 'Agent',
          'chat.input.toolMode.options.code': 'Code',
          'chat.input.toolMode.options.minimal': 'Minimal',
          'chat.input.toolMode.descriptions.agent': 'Direct tool calls',
          'chat.input.toolMode.descriptions.code': 'Compose calls with code',
          'chat.input.toolMode.descriptions.minimal':
            'Simplified file operations with other enabled tools',
          'chat.input.toolMode.codeEntry': 'Code entry',
          'chat.input.toolMode.codeCallable': 'Code callable',
          'chat.input.toolMode.minimalTools': 'Minimal tools',
          'chat.input.toolMode.saving': 'Saving',
          'chat.input.toolMode.locked': 'Available after this response',
          'chat.input.toolMode.updateFailed': 'Update failed'
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
    props: {
      subagentsAvailable: options?.subagentsAvailable ?? false
    },
    slots: {
      'generation-settings': '<div data-testid="generation-settings-slot" />'
    },
    global: {
      stubs: {
        DcButton: ButtonStub,
        Switch: SwitchStub,
        Popover: passthrough('Popover'),
        PopoverTrigger: passthrough('PopoverTrigger'),
        PopoverContent: passthrough('PopoverContent'),
        Select: passthrough('Select'),
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue'),
        Icon: true
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    draftStore,
    sessionStore,
    toolService,
    agentSessionPresenter,
    skillEvents
  }
}

describe('McpIndicator', () => {
  it('renders icon-only trigger for deepchat and keeps built-in tools session scoped', async () => {
    const { wrapper, agentSessionPresenter } = await setup({
      hasActiveSession: true,
      activeAgentId: 'deepchat'
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].text()).toBe('')
    expect(wrapper.text()).toContain('Tools')
    expect(wrapper.text()).not.toContain('MCP 1')
    expect(wrapper.text().indexOf('Tools')).toBeLessThan(wrapper.text().indexOf('demo-server'))
    expect(wrapper.find('[data-testid="generation-settings-slot"]').exists()).toBe(true)

    const execButton = buttons.find((button) => button.text() === 'exec')
    expect(execButton).toBeTruthy()

    await execButton!.trigger('click')
    await flushPromises()

    expect(agentSessionPresenter.updateSessionDisabledAgentTools).toHaveBeenCalledWith('s1', [
      'exec'
    ])
  })

  it('supports enabling and disabling a whole tool group', async () => {
    const { wrapper, agentSessionPresenter } = await setup({
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

    expect(agentSessionPresenter.updateSessionDisabledAgentTools).toHaveBeenCalledWith('s1', [
      'exec',
      'read'
    ])
  })

  it('renders update_plan inside Agent Core and toggles it individually', async () => {
    const { wrapper, agentSessionPresenter } = await setup({
      hasActiveSession: true,
      activeAgentId: 'deepchat'
    })

    expect(wrapper.text()).toContain('Agent Core')
    expect(wrapper.text()).not.toContain('Progress')
    expect(wrapper.text()).toContain('update_plan')

    const updatePlanButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'update_plan')
    expect(updatePlanButton).toBeTruthy()

    await updatePlanButton!.trigger('click')
    await flushPromises()

    expect(agentSessionPresenter.updateSessionDisabledAgentTools).toHaveBeenCalledWith('s1', [
      'update_plan'
    ])
  })

  it('resets a fully disabled tool group back to all enabled when switched on', async () => {
    const { wrapper, agentSessionPresenter } = await setup({
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

    expect(agentSessionPresenter.updateSessionDisabledAgentTools).toHaveBeenCalledWith('s1', [])
  })

  it('renders MCP badge for ACP sessions and keeps built-in tools hidden', async () => {
    const { wrapper, toolService } = await setup({
      hasActiveSession: true,
      activeAgentId: 'acp-coder'
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].text()).toContain('MCP 1')
    expect(wrapper.text()).not.toContain('Tools')
    expect(wrapper.find('[data-testid="generation-settings-slot"]').exists()).toBe(false)
    expect(toolService.getConfigurableAgentToolDefinitions).not.toHaveBeenCalled()
  })

  it('renders plugin-owned MCP tools in a separate plugin section', async () => {
    const { wrapper } = await setup({
      hasActiveSession: true,
      activeAgentId: 'acp-coder',
      pluginEnabled: true
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].text()).toContain('MCP 1')
    expect(wrapper.text()).toContain('MCP')
    expect(wrapper.text()).toContain('demo-server')
    expect(wrapper.text()).toContain('Plugins')
    expect(wrapper.text()).toContain('CUA Driver')
  })

  it('shows plugin MCP when global MCP has no enabled regular servers', async () => {
    const { wrapper } = await setup({
      hasActiveSession: true,
      activeAgentId: 'acp-coder',
      pluginEnabled: true,
      regularMcpEnabled: false
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].text()).toContain('MCP 0')
    expect(wrapper.text()).toContain('Plugins')
    expect(wrapper.text()).toContain('CUA Driver')
    expect(wrapper.text()).not.toContain('demo-server')
  })

  it('updates draft disabled tools for deepchat new thread mode', async () => {
    const { wrapper, draftStore, agentSessionPresenter } = await setup({
      hasActiveSession: false,
      selectedAgentId: 'deepchat'
    })

    const updatePlanButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'update_plan')
    expect(updatePlanButton).toBeTruthy()

    await updatePlanButton!.trigger('click')
    await flushPromises()

    expect(draftStore.disabledAgentTools).toEqual(['update_plan'])
    expect(agentSessionPresenter.updateSessionDisabledAgentTools).not.toHaveBeenCalled()
  })

  it('does not synthesize a Session-level Subagent tool toggle', async () => {
    const { wrapper } = await setup({
      hasActiveSession: true,
      activeAgentId: 'deepchat'
    })

    expect(wrapper.text()).toContain('Agent Core')
    const subagentButton = wrapper.findAll('button').find((node) => node.text() === 'subagent')
    expect(subagentButton).toBeUndefined()
    expect(wrapper.emitted('toggle-subagents')).toBeUndefined()
  })

  it('reloads deepchat tools when the active session emits skill activation changes', async () => {
    const { toolService, skillEvents } = await setup({
      hasActiveSession: true,
      activeAgentId: 'deepchat'
    })

    toolService.getConfigurableAgentToolDefinitions.mockClear()
    skillEvents.emitSessionChanged({
      conversationId: 's1',
      skills: ['deepchat-settings'],
      change: 'activated'
    })
    await flushPromises()

    expect(toolService.getConfigurableAgentToolDefinitions).toHaveBeenCalledTimes(1)
    expect(toolService.getConfigurableAgentToolDefinitions).toHaveBeenCalledWith({
      chatMode: 'agent',
      conversationId: 's1',
      agentWorkspacePath: '/tmp/workspace'
    })
  })

  it('shows fixed Code tools as active read-only items', async () => {
    const { wrapper, agentSessionPresenter } = await setup({
      providerId: 'deepseek',
      defaultToolMode: 'code',
      subagentsAvailable: true
    })

    expect(wrapper.text()).toContain('Model default')
    expect(
      wrapper.findAll('[role="radio"]').map((radio) => radio.element.parentElement?.textContent)
    ).toEqual(['Agent', 'Code', 'Minimal'])
    expect(wrapper.text()).toContain('run_code')
    expect(wrapper.text()).toContain('Code callable · Agent Filesystem')
    expect(wrapper.text()).toContain('deepchat_question')
    expect(wrapper.text()).toContain('deepchat_subagents')
    const fixedToolNames = ['run_code', 'deepchat_question', 'deepchat_subagents']
    const fixedToolItems = wrapper
      .findAll('span')
      .filter((item) => fixedToolNames.includes(item.text()))
    expect(fixedToolItems).toHaveLength(fixedToolNames.length)
    expect(fixedToolItems.every((item) => item.classes().includes('bg-primary'))).toBe(true)
    await fixedToolItems[1].trigger('click')
    await fixedToolItems[2].trigger('click')
    await flushPromises()
    expect(agentSessionPresenter.updateSessionDisabledAgentTools).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('demo-server')
  })

  it('persists Minimal Mode and only replaces the filesystem tool group', async () => {
    const { wrapper, sessionStore, agentSessionPresenter } = await setup({
      defaultToolMode: 'code',
      pluginEnabled: true,
      subagentsAvailable: true
    })
    const minimalRadio = wrapper.findAll('[role="radio"]')[2]

    await minimalRadio.trigger('click')
    await flushPromises()

    expect(sessionStore.setSessionToolMode).toHaveBeenCalledWith('minimal')
    expect(wrapper.text()).toContain('exec')
    expect(wrapper.text()).toContain('process')
    expect(wrapper.text()).toContain('str_replace_editor')
    expect(wrapper.findAll('button').some((button) => button.text() === 'read')).toBe(false)
    expect(wrapper.text()).toContain('update_plan')
    expect(wrapper.text()).toContain('deepchat_question')
    expect(wrapper.text()).toContain('deepchat_subagents')
    expect(wrapper.text()).toContain('demo-server')
    expect(wrapper.text()).toContain('CUA Driver')
    const fixedToolNames = [
      'exec',
      'process',
      'str_replace_editor',
      'deepchat_question',
      'deepchat_subagents'
    ]
    const fixedToolItems = wrapper
      .findAll('span')
      .filter((item) => fixedToolNames.includes(item.text()))
    expect(fixedToolItems).toHaveLength(fixedToolNames.length)
    expect(fixedToolItems.every((item) => item.classes().includes('bg-primary'))).toBe(true)
    await fixedToolItems[3].trigger('click')
    await fixedToolItems[4].trigger('click')
    await flushPromises()
    expect(agentSessionPresenter.updateSessionDisabledAgentTools).not.toHaveBeenCalled()
  })

  it('hides the Minimal editor when a required filesystem tool is disabled', async () => {
    const { wrapper } = await setup({
      toolModeOverride: 'minimal',
      disabledAgentTools: ['read']
    })

    expect(wrapper.text()).toContain('exec')
    expect(wrapper.text()).toContain('process')
    expect(wrapper.text()).not.toContain('str_replace_editor')
  })

  it('disables Tool Mode changes while the session is working', async () => {
    const { wrapper, sessionStore } = await setup({ sessionStatus: 'working' })
    const radios = wrapper.findAll('[role="radio"]')

    expect(radios).toHaveLength(3)
    expect(radios.every((radio) => radio.attributes('disabled') !== undefined)).toBe(true)
    await radios[1].trigger('click')
    await flushPromises()

    expect(sessionStore.setSessionToolMode).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Available after this response')
  })
})
