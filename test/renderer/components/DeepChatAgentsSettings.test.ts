import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ModelType } from '../../../src/shared/model'

const passthrough = (name: string) =>
  defineComponent({
    name,
    props: {
      open: { type: Boolean, default: false }
    },
    template: '<div><slot /></div>'
  })

const DialogStub = defineComponent({
  name: 'Dialog',
  props: {
    open: { type: Boolean, default: false }
  },
  emits: ['update:open'],
  template: '<div v-if="open"><slot /></div>'
})

const ButtonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const InputStub = defineComponent({
  name: 'Input',
  props: {
    modelValue: { type: [String, Number], default: '' }
  },
  emits: ['update:modelValue'],
  template:
    '<input v-bind="$attrs" :value="modelValue ?? \'\'" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const TextareaStub = defineComponent({
  name: 'Textarea',
  props: {
    modelValue: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  template:
    '<textarea v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const SwitchStub = defineComponent({
  name: 'Switch',
  props: {
    modelValue: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  template:
    '<button v-bind="$attrs" type="button" :data-model-value="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />'
})

const DropdownMenuItemStub = defineComponent({
  name: 'DropdownMenuItem',
  emits: ['select'],
  template:
    '<button v-bind="$attrs" type="button" @click="$emit(\'select\', $event)"><slot /></button>'
})

const AgentTransferDialogStub = defineComponent({
  name: 'AgentTransferDialog',
  props: {
    open: { type: Boolean, default: false },
    error: { type: String, default: null }
  },
  emits: ['update:open', 'confirm-move', 'confirm-delete'],
  template:
    '<div v-if="open"><span v-if="error" data-testid="agent-transfer-error">{{ error }}</span><button data-testid="confirm-delete-agent" @click="$emit(\'confirm-delete\')">confirm</button></div>'
})

const clientMocks = vi.hoisted(() => ({
  projectClient: {
    listRecent: vi.fn(),
    selectDirectory: vi.fn()
  },
  toolClient: {
    getConfigurableAgentToolDefinitions: vi.fn()
  },
  sessionClient: {
    getAgentTransferImpact: vi.fn(),
    deleteAgentSessions: vi.fn(),
    moveAgentSessions: vi.fn()
  },
  uiSettingsStore: {
    autoCompactionEnabled: true,
    autoCompactionTriggerThreshold: 80,
    autoCompactionRetainRecentPairs: 2
  },
  notifyRenderer: vi.fn()
}))

type ProjectClientMockSource = {
  getRecentProjects: (limit?: number) => Promise<unknown>
  selectDirectory: () => Promise<unknown>
}
type ToolClientMockSource = {
  getConfigurableAgentToolDefinitions: (context: unknown) => Promise<unknown>
}

const bindClientMocks = (
  projectPresenter: ProjectClientMockSource,
  toolService: ToolClientMockSource
) => {
  clientMocks.projectClient.listRecent.mockImplementation((limit?: number) =>
    projectPresenter.getRecentProjects(limit)
  )
  clientMocks.projectClient.selectDirectory.mockImplementation(() =>
    projectPresenter.selectDirectory()
  )
  clientMocks.toolClient.getConfigurableAgentToolDefinitions.mockImplementation(
    (context: unknown) => toolService.getConfigurableAgentToolDefinitions(context)
  )
}

vi.mock('@api/ProjectClient', () => ({
  createProjectClient: () => clientMocks.projectClient
}))
vi.mock('@api/ToolClient', () => ({
  createToolClient: () => clientMocks.toolClient
}))
vi.mock('@api/SessionClient', () => ({
  createSessionClient: () => clientMocks.sessionClient
}))
vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer: clientMocks.notifyRenderer
}))
vi.mock('@/stores/uiSettingsStore', () => ({
  useUiSettingsStore: () => clientMocks.uiSettingsStore
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {} })
}))

vi.mock('@/components/ModelSelect.vue', () => ({
  default: defineComponent({
    name: 'ModelSelect',
    props: {
      type: { type: Array, default: undefined },
      visionOnly: { type: Boolean, default: false }
    },
    emits: ['update:model'],
    template: '<div data-testid="model-select-stub"></div>'
  })
}))

describe('DeepChatAgentsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.projectClient.listRecent.mockReset()
    clientMocks.projectClient.selectDirectory.mockReset()
    clientMocks.toolClient.getConfigurableAgentToolDefinitions.mockReset()
    clientMocks.sessionClient.getAgentTransferImpact.mockReset()
    clientMocks.sessionClient.deleteAgentSessions.mockReset()
    clientMocks.sessionClient.moveAgentSessions.mockReset()
    clientMocks.sessionClient.getAgentTransferImpact.mockResolvedValue({ totalSessions: 0 })
    clientMocks.sessionClient.deleteAgentSessions.mockResolvedValue({ removed: 0 })
    clientMocks.sessionClient.moveAgentSessions.mockResolvedValue({ moved: 0 })
    clientMocks.uiSettingsStore.autoCompactionEnabled = true
    clientMocks.uiSettingsStore.autoCompactionTriggerThreshold = 80
    clientMocks.uiSettingsStore.autoCompactionRetainRecentPairs = 2
  })

  const mountSettings = async (options: {
    agents: unknown[]
    modelStore?: unknown
    toolDefinitions?: unknown[]
    projectPresenter?: {
      getRecentProjects: ReturnType<typeof vi.fn>
      selectDirectory: ReturnType<typeof vi.fn>
    }
    configService?: Partial<{
      listAgents: ReturnType<typeof vi.fn>
      getSystemPrompts: ReturnType<typeof vi.fn>
      updateDeepChatAgent: ReturnType<typeof vi.fn>
      createDeepChatAgent: ReturnType<typeof vi.fn>
      deleteDeepChatAgent: ReturnType<typeof vi.fn>
    }>
  }) => {
    vi.resetModules()

    const configService = {
      listAgents: vi.fn().mockResolvedValue(options.agents),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(options.agents[0]),
      createDeepChatAgent: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
        id: 'deepchat-new',
        type: 'deepchat',
        protected: false,
        ...input
      })),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false }),
      ...options.configService
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue(options.toolDefinitions ?? [])
    }
    const projectPresenter = options.projectPresenter ?? {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    const modelStore =
      options.modelStore ??
      ({
        allProviderModels: [],
        findModelByIdOrName: vi.fn(() => null)
      } as const)

    bindClientMocks(projectPresenter, toolService)

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          InputGroup: passthrough('InputGroup'),
          InputGroupAddon: passthrough('InputGroupAddon'),
          InputGroupInput: InputStub,
          InputGroupText: passthrough('InputGroupText'),
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Collapsible: passthrough('Collapsible'),
          CollapsibleContent: passthrough('CollapsibleContent'),
          CollapsibleTrigger: passthrough('CollapsibleTrigger'),
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          AgentAvatar: passthrough('AgentAvatar'),
          AgentTransferDialog: AgentTransferDialogStub,
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    return {
      wrapper,
      configService,
      toolService,
      projectPresenter
    }
  }

  it('loads, resets, normalizes, and saves per-Agent output limits', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      avatar: null,
      config: {
        readFileAutoTruncateChars: 7_000,
        toolOutputInlineChars: 8_000,
        commandOutputInlineChars: 9_000
      }
    }
    const { wrapper, configService } = await mountSettings({ agents: [existingAgent] })
    const readInput = wrapper.get('[data-testid="read-file-auto-truncate-chars-input"]')
    const toolInput = wrapper.get('[data-testid="tool-output-inline-chars-input"]')
    const commandInput = wrapper.get('[data-testid="command-output-inline-chars-input"]')

    expect((readInput.element as HTMLInputElement).value).toBe('7000')
    expect((toolInput.element as HTMLInputElement).value).toBe('8000')
    expect((commandInput.element as HTMLInputElement).value).toBe('9000')
    const units = wrapper.findAll('[data-testid="agent-output-limit-unit"]')
    expect(units).toHaveLength(3)
    expect(units.every((unit) => unit.text() === 'settings.common.charactersUnit')).toBe(true)

    await wrapper.get('[data-testid="agent-output-limits-reset"]').trigger('click')
    expect((readInput.element as HTMLInputElement).value).toBe('4500')
    expect((toolInput.element as HTMLInputElement).value).toBe('5000')
    expect((commandInput.element as HTMLInputElement).value).toBe('12000')

    await readInput.setValue('')
    await toolInput.setValue('8500.6')
    await commandInput.setValue('250000')
    await wrapper.get('[data-testid="deepchat-agent-save-button"]').trigger('click')
    await flushPromises()

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.config).toEqual({
      readFileAutoTruncateChars: 4_500,
      toolOutputInlineChars: 8_501,
      commandOutputInlineChars: 200_000
    })
  })

  it('shows pending and success feedback while deriving save availability from canonical data', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {}
    }
    const updatedAgent = { ...existingAgent, name: 'DeepChat Renamed' }
    let resolveSave: ((agent: typeof updatedAgent) => void) | undefined
    const updateDeepChatAgent = vi.fn(
      () =>
        new Promise<typeof updatedAgent>((resolve) => {
          resolveSave = resolve
        })
    )
    const { wrapper, configService } = await mountSettings({
      agents: [existingAgent],
      configService: { updateDeepChatAgent }
    })
    const saveButton = wrapper.get('[data-testid="deepchat-agent-save-button"]')

    expect(saveButton.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue(updatedAgent.name)
    await flushPromises()
    expect(saveButton.attributes('disabled')).toBeUndefined()

    await saveButton.trigger('click')
    expect(saveButton.attributes('disabled')).toBeDefined()
    expect(saveButton.attributes('aria-busy')).toBe('true')
    expect(
      wrapper.get('[data-testid="deepchat-agent-editor-content"]').attributes()
    ).toHaveProperty('inert')

    resolveSave?.(updatedAgent)
    await flushPromises()

    // 成功反馈走按钮 ✅ 态，不再弹 toast
    expect(clientMocks.notifyRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'settings.deepchatAgent.saved' })
    )
    expect(saveButton.attributes('disabled')).toBeDefined()
    expect(configService.listAgents).toHaveBeenCalledOnce()
  })

  it('reports save failures as an inline error, hides raw errors, and retries the same edited data', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {}
    }
    const updatedAgent = { ...existingAgent, description: 'Updated description' }
    const updateDeepChatAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error('sensitive backend detail'))
      .mockResolvedValueOnce(updatedAgent)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper } = await mountSettings({
      agents: [existingAgent],
      configService: { updateDeepChatAgent }
    })

    await wrapper
      .get('[data-testid="deepchat-agent-description-input"]')
      .setValue(updatedAgent.description)
    await wrapper.get('[data-testid="deepchat-agent-save-button"]').trigger('click')
    await flushPromises()

    expect(clientMocks.notifyRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'settings.deepchatAgent.saveFailed' })
    )
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'settings.deepchatAgents.saveFeedback.saveFailed'
    )
    expect(wrapper.text()).not.toContain('sensitive backend detail')
    expect(wrapper.get('[data-testid="deepchat-agent-save-button"]').attributes('disabled')).toBe(
      undefined
    )

    await wrapper.get('[data-testid="deepchat-agent-save-button"]').trigger('click')
    await flushPromises()

    expect(updateDeepChatAgent).toHaveBeenCalledTimes(2)
    // 重试成功走按钮 ✅ 态，内联错误清除
    expect(clientMocks.notifyRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'settings.deepchatAgent.saved' })
    )
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    consoleError.mockRestore()
  })

  it('keeps persistence success when the returned agent cannot be projected', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: '',
      avatar: null,
      config: {}
    }
    const persistedAgent = {
      ...existingAgent,
      name: 'Persisted name',
      config: {
        disabledAgentTools: 42
      }
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, configService } = await mountSettings({
      agents: [existingAgent],
      configService: {
        updateDeepChatAgent: vi.fn().mockResolvedValue(persistedAgent)
      }
    })

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue('Persisted name')
    await wrapper.get('[data-testid="deepchat-agent-save-button"]').trigger('click')
    await flushPromises()

    expect(configService.updateDeepChatAgent).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      '[DeepChatAgents] Failed to project saved agent',
      expect.any(TypeError)
    )
    expect(clientMocks.notifyRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'settings.deepchatAgent.saved' })
    )
    expect(wrapper.get('[data-testid="deepchat-agent-save-button"]').attributes('disabled')).toBe(
      ''
    )

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue('Unsaved follow-up')
    const resetButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.reset'))
    await resetButton!.trigger('click')

    expect(
      (wrapper.get('[data-testid="deepchat-agent-name-input"]').element as HTMLInputElement).value
    ).toBe('Persisted name')
    consoleError.mockRestore()
  })

  it('persists clearing an existing description instead of treating it as an omitted update', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Remove this description',
      avatar: null,
      config: {}
    }
    const updatedAgent = { ...existingAgent, description: undefined }
    const updateDeepChatAgent = vi.fn().mockResolvedValue(updatedAgent)
    const { wrapper } = await mountSettings({
      agents: [existingAgent],
      configService: { updateDeepChatAgent }
    })

    await wrapper.get('[data-testid="deepchat-agent-description-input"]').setValue('')
    await wrapper.get('[data-testid="deepchat-agent-save-button"]').trigger('click')
    await flushPromises()

    expect(updateDeepChatAgent).toHaveBeenCalledWith(
      'deepchat',
      expect.objectContaining({ description: '' })
    )
    expect(
      (wrapper.get('[data-testid="deepchat-agent-description-input"]').element as HTMLInputElement)
        .value
    ).toBe('')
    expect(clientMocks.notifyRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'settings.deepchatAgent.saved' })
    )
  })

  it('clears the failed-save state from the page as soon as the user edits again', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: '',
      avatar: null,
      config: {}
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper } = await mountSettings({
      agents: [existingAgent],
      configService: {
        updateDeepChatAgent: vi.fn().mockRejectedValue(new Error('save failed'))
      }
    })

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue('Changed once')
    await wrapper.get('[data-testid="deepchat-agent-save-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'settings.deepchatAgents.saveFeedback.saveFailed'
    )
    expect(clientMocks.notifyRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'settings.deepchatAgent.saveFailed' })
    )
    expect(
      wrapper.get('[data-testid="deepchat-agent-save-button"]').attributes('disabled')
    ).toBeUndefined()

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue('Changed again')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="deepchat-agent-save-button"]').attributes('disabled')
    ).toBeUndefined()
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.saveFeedback.saveFailed')
    consoleError.mockRestore()
  })

  it('guards an in-page Agent switch until dirty edits are explicitly discarded', async () => {
    const builtin = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: '',
      avatar: null,
      config: {}
    }
    const child = {
      id: 'child',
      type: 'deepchat',
      name: 'Child',
      enabled: true,
      protected: false,
      description: '',
      avatar: null,
      config: {}
    }
    const { wrapper } = await mountSettings({ agents: [builtin, child] })
    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue('Unsaved name')
    await wrapper.get('[data-testid="deepchat-agent-row-child"]').trigger('click')
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot()).toMatchObject({ promptOpen: true, risk: 'dirty' })
    expect(
      (wrapper.get('[data-testid="deepchat-agent-name-input"]').element as HTMLInputElement).value
    ).toBe('Unsaved name')

    settingsLeaveGuard.cancelLeave()
    await flushPromises()
    expect(
      (wrapper.get('[data-testid="deepchat-agent-name-input"]').element as HTMLInputElement).value
    ).toBe('Unsaved name')

    await wrapper.get('[data-testid="deepchat-agent-row-child"]').trigger('click')
    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await flushPromises()

    expect(
      (wrapper.get('[data-testid="deepchat-agent-name-input"]').element as HTMLInputElement).value
    ).toBe('Child')
    expect(
      wrapper.get('[data-testid="deepchat-agent-save-button"]').attributes('disabled')
    ).toBeDefined()
  })

  it('notifies when deleted agent vector cleanup is deferred until restart', async () => {
    const agent = {
      id: 'custom-agent',
      type: 'deepchat',
      name: 'Custom Agent',
      enabled: true,
      protected: false,
      description: '',
      avatar: null,
      config: {}
    }
    const deleteDeepChatAgent = vi
      .fn()
      .mockResolvedValue({ removed: true, cleanupPendingRestart: true })
    const { wrapper } = await mountSettings({
      agents: [agent],
      configService: { deleteDeepChatAgent }
    })

    await wrapper.get('[data-testid="deepchat-agent-delete-button"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="confirm-delete-agent"]').trigger('click')
    await flushPromises()

    expect(clientMocks.sessionClient.deleteAgentSessions).toHaveBeenCalledWith('custom-agent')
    expect(deleteDeepChatAgent).toHaveBeenCalledWith('custom-agent')
    expect(clientMocks.notifyRenderer).toHaveBeenCalledWith({
      kind: 'info',
      code: 'settings.deepchatAgent.cleanupPendingRestart',
      title: 'settings.deepchatAgents.memoryManager.cleanupPendingRestart'
    })
    expect(wrapper.find('[data-testid="deepchat-agent-row-custom-agent"]').exists()).toBe(false)
  })

  it('keeps raw agent deletion failures inside diagnostics', async () => {
    const agent = {
      id: 'custom-agent',
      type: 'deepchat',
      name: 'Custom Agent',
      enabled: true,
      protected: false,
      description: '',
      avatar: null,
      config: {}
    }
    const deleteDeepChatAgent = vi.fn().mockRejectedValue(new Error('secret database path'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper } = await mountSettings({
      agents: [agent],
      configService: { deleteDeepChatAgent }
    })

    await wrapper.get('[data-testid="deepchat-agent-delete-button"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="confirm-delete-agent"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="agent-transfer-error"]').text()).toBe(
      'common.error.operationFailed'
    )
    expect(wrapper.text()).not.toContain('secret database path')
    consoleError.mockRestore()
  })

  it('mounts and saves DeepChat agents with cloneable model selections', async () => {
    vi.resetModules()

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        defaultModelPreset: {
          providerId: 'openai',
          modelId: 'gpt-4.1',
          temperature: 1.2,
          contextLength: 64000,
          maxTokens: 8192,
          thinkingBudget: 2048,
          reasoningEffort: 'high',
          verbosity: 'high',
          forceInterleavedThinkingCompat: true
        },
        assistantModel: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' },
        visionModel: { providerId: 'openai', modelId: 'gpt-4.1-vision' },
        imageGenerationModel: { providerId: 'openai', modelId: 'gpt-image-1' },
        systemPrompt: 'system prompt',
        permissionMode: 'default',
        disabledAgentTools: ['tool_beta'],
        autoCompactionEnabled: false,
        autoCompactionTriggerThreshold: 72,
        autoCompactionRetainRecentPairs: 4
      }
    }

    const configService = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([
        {
          source: 'agent',
          function: { name: 'tool_alpha', description: 'Alpha tool' },
          server: { name: 'alpha-server' }
        },
        {
          source: 'agent',
          function: { name: 'tool_beta', description: 'Beta tool' },
          server: { name: 'beta-server' }
        }
      ])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = {
      allProviderModels: [
        {
          providerId: 'openai',
          models: [
            { id: 'gpt-4.1', name: 'GPT-4.1' },
            { id: 'gpt-4.1-vision', name: 'GPT-4.1 Vision' },
            { id: 'gpt-image-1', name: 'GPT Image 1', type: ModelType.ImageGeneration }
          ]
        },
        {
          providerId: 'anthropic',
          models: [{ id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' }]
        }
      ],
      findModelByIdOrName: vi.fn((modelId: string) =>
        modelId === 'gpt-image-1'
          ? {
              providerId: 'openai',
              model: { id: 'gpt-image-1', name: 'GPT Image 1', type: ModelType.ImageGeneration }
            }
          : {
              providerId: 'openai',
              model: { id: 'gpt-4.1', name: 'GPT-4.1' }
            }
      )
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).not.toContain('settings.deepchatAgents.temperature')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.reasoningEffort')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.verbosity')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.interleaved')
    expect(wrapper.text()).toContain('GPT-4.1')
    expect(wrapper.text()).toContain('GPT Image 1')
    expect(wrapper.text()).not.toContain('openai/gpt-4.1')
    expect(wrapper.text().indexOf('settings.deepchatAgents.visionModel')).toBeLessThan(
      wrapper.text().indexOf('settings.deepchatAgents.imageGenerationModel')
    )

    const modelSelects = wrapper.findAllComponents({ name: 'ModelSelect' })
    expect(modelSelects).toHaveLength(4)
    modelSelects[0].vm.$emit(
      'update:model',
      {
        id: 'gpt-4.1-mini',
        name: 'GPT-4.1 Mini',
        temperature: 0.2,
        contextLength: 128000
      },
      'openai'
    )
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))

    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.updateDeepChatAgent).toHaveBeenCalledTimes(1)

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload).toMatchObject({
      name: 'DeepChat',
      enabled: true,
      description: 'Writer agent'
    })
    expect(payload.config).toEqual({
      defaultModelPreset: {
        providerId: 'openai',
        modelId: 'gpt-4.1-mini'
      }
    })
    expect(payload.config.defaultModelPreset).toStrictEqual({
      providerId: 'openai',
      modelId: 'gpt-4.1-mini'
    })
    expect(payload.config.defaultModelPreset).not.toHaveProperty('temperature')
    expect(payload.config.defaultModelPreset).not.toHaveProperty('contextLength')
    expect(() => structuredClone(payload)).not.toThrow()
  })

  it('saves only systemPrompt when that builtin config field changes', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4.1' },
        assistantModel: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' },
        systemPrompt: 'old system prompt',
        permissionMode: 'default',
        disabledAgentTools: []
      }
    }

    const { wrapper, configService } = await mountSettings({ agents: [existingAgent] })

    const systemPromptTextarea = wrapper
      .findAll('textarea')
      .find((textarea) =>
        textarea
          .attributes('placeholder')
          ?.includes('settings.deepchatAgents.systemPromptPlaceholder')
      )
    expect(systemPromptTextarea).toBeDefined()

    await systemPromptTextarea!.setValue('new system prompt')
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.config).toEqual({ systemPrompt: 'new system prompt' })
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
  })

  it('omits config when only the builtin agent name changes', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4.1' },
        assistantModel: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' },
        systemPrompt: 'system prompt'
      }
    }

    const { wrapper, configService } = await mountSettings({ agents: [existingAgent] })

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue('DeepChat Renamed')
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.name).toBe('DeepChat Renamed')
    expect(payload).not.toHaveProperty('config')
  })

  it('sends null when an existing chat model override is cleared', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4.1' },
        assistantModel: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' },
        systemPrompt: 'system prompt'
      }
    }

    const { wrapper, configService } = await mountSettings({ agents: [existingAgent] })

    const clearButtons = wrapper
      .findAll('button')
      .filter((button) => button.text().includes('common.clear'))
    expect(clearButtons.length).toBeGreaterThan(0)

    await clearButtons[0].trigger('click')
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.config).toEqual({ defaultModelPreset: null })
  })

  it('filters the image generation model selector to image models', async () => {
    vi.resetModules()

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        defaultModelPreset: null,
        assistantModel: null,
        visionModel: null,
        imageGenerationModel: null,
        systemPrompt: '',
        permissionMode: 'default',
        disabledAgentTools: []
      }
    }
    const configService = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => ({
        allProviderModels: [],
        findModelByIdOrName: vi.fn(() => null)
      })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    const modelSelects = wrapper.findAllComponents({ name: 'ModelSelect' })
    expect(modelSelects).toHaveLength(4)
    expect(modelSelects[2].props('visionOnly')).toBe(true)
    expect(modelSelects[3].props('type')).toEqual([ModelType.ImageGeneration])
  })

  it('keeps the editor header sticky so save actions stay visible while scrolling', async () => {
    vi.resetModules()

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {}
    }

    const configService = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          ModelSelect: passthrough('ModelSelect'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    const stickyHeader = wrapper.get('[data-testid="deepchat-agents-sticky-header"]')

    expect(stickyHeader.classes()).toContain('sticky')
    expect(stickyHeader.classes()).toContain('top-0')
    expect(stickyHeader.text()).toContain('common.save')
    expect(stickyHeader.text()).toContain('common.reset')
  })

  it('saves auto compaction settings when number inputs emit numeric values', async () => {
    vi.resetModules()

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        defaultModelPreset: null,
        assistantModel: null,
        visionModel: null,
        systemPrompt: 'system prompt',
        permissionMode: 'default',
        disabledAgentTools: [],
        autoCompactionEnabled: true,
        autoCompactionTriggerThreshold: 72,
        autoCompactionRetainRecentPairs: 4
      }
    }

    const configService = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          ModelSelect: passthrough('ModelSelect'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    wrapper
      .findComponent('[data-testid="auto-compaction-trigger-threshold-input"]')
      .vm.$emit('update:modelValue', 91)
    wrapper
      .findComponent('[data-testid="auto-compaction-retain-recent-pairs-input"]')
      .vm.$emit('update:modelValue', 6)
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))

    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.updateDeepChatAgent).toHaveBeenCalledTimes(1)

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.config.autoCompactionTriggerThreshold).toBe(91)
    expect(payload.config.autoCompactionRetainRecentPairs).toBe(6)
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
  })

  it('snapshots app auto-compaction defaults for a new Agent form', async () => {
    clientMocks.uiSettingsStore.autoCompactionEnabled = false
    clientMocks.uiSettingsStore.autoCompactionTriggerThreshold = 65
    clientMocks.uiSettingsStore.autoCompactionRetainRecentPairs = 4

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      avatar: null,
      config: {}
    }
    const { wrapper, configService } = await mountSettings({ agents: [existingAgent] })

    await wrapper.get('[data-testid="deepchat-agent-add-button"]').trigger('click')
    await flushPromises()

    const compactionSwitch = wrapper
      .findAll('button')
      .find(
        (button) => button.attributes('aria-label') === 'settings.deepchatAgents.compactionEnabled'
      )
    expect(compactionSwitch?.attributes('data-model-value')).toBe('false')
    await compactionSwitch!.trigger('click')
    await flushPromises()

    expect(
      (
        wrapper.get('[data-testid="auto-compaction-trigger-threshold-input"]')
          .element as HTMLInputElement
      ).value
    ).toBe('65')
    expect(
      (
        wrapper.get('[data-testid="auto-compaction-retain-recent-pairs-input"]')
          .element as HTMLInputElement
      ).value
    ).toBe('4')

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue('Snapshot Agent')
    await wrapper.get('[data-testid="auto-compaction-trigger-threshold-input"]').setValue('90')
    await wrapper.get('[data-testid="deepchat-agent-save-button"]').trigger('click')
    await flushPromises()

    expect(configService.createDeepChatAgent).toHaveBeenCalledOnce()
    expect(configService.createDeepChatAgent.mock.calls[0][0].config).toMatchObject({
      autoCompactionEnabled: true,
      autoCompactionTriggerThreshold: 90,
      autoCompactionRetainRecentPairs: 4
    })
  })

  it('saves only changed disabled tools without carrying model keys', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4.1' },
        assistantModel: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' },
        disabledAgentTools: []
      }
    }

    const { wrapper, configService } = await mountSettings({
      agents: [existingAgent],
      toolDefinitions: [
        {
          source: 'agent',
          function: { name: 'tool_alpha', description: 'Alpha tool' },
          server: { name: 'agent-core' }
        }
      ]
    })

    const toolButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('tool_alpha'))
    expect(toolButton).toBeDefined()

    await toolButton!.trigger('click')
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.config).toEqual({ disabledAgentTools: ['tool_alpha'] })
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
  })

  it('defaults missing memoryEnabled independently and keeps an unchanged form clean', async () => {
    vi.resetModules()

    const builtin = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      avatar: null,
      config: { memoryEnabled: true }
    }
    const child = {
      id: 'child',
      type: 'deepchat',
      name: 'Child',
      enabled: true,
      protected: false,
      avatar: null,
      config: {}
    }

    const configService = {
      listAgents: vi.fn().mockResolvedValue([builtin, child]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(child),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = { allProviderModels: [], findModelByIdOrName: vi.fn(() => null) }

    vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configService }))
    vi.doMock('@/stores/modelStore', () => ({ useModelStore: () => modelStore }))
    vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
    vi.doMock('@iconify/vue', () => ({ Icon: { name: 'Icon', template: '<span />' } }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          ModelSelect: passthrough('ModelSelect'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    await wrapper.find('[data-testid="deepchat-agent-row-child"]').trigger('click')
    await flushPromises()

    const memorySwitch = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === 'settings.deepchatAgents.memoryEnabled')
    expect(memorySwitch?.attributes('data-model-value')).toBe('false')

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    expect(saveButton?.attributes('disabled')).toBeDefined()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.updateDeepChatAgent).not.toHaveBeenCalled()
  })

  it('sends memoryEnabled when an independent memory switch is toggled', async () => {
    const builtin = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      avatar: null,
      config: { memoryEnabled: true }
    }
    const child = {
      id: 'child',
      type: 'deepchat',
      name: 'Child',
      enabled: true,
      protected: false,
      avatar: null,
      config: {}
    }

    const { wrapper, configService } = await mountSettings({
      agents: [builtin, child],
      configService: {
        updateDeepChatAgent: vi.fn().mockResolvedValue(child)
      }
    })

    await wrapper.find('[data-testid="deepchat-agent-row-child"]').trigger('click')
    await flushPromises()

    const memorySwitch = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === 'settings.deepchatAgents.memoryEnabled')
    expect(memorySwitch?.attributes('data-model-value')).toBe('false')

    await memorySwitch!.trigger('click')
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    const [agentId, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(agentId).toBe('child')
    expect(payload.config).toEqual({ memoryEnabled: true })
    expect(payload.config).not.toHaveProperty('assistantModel')
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
  })

  it('falls back to default auto compaction values when inputs are blank or invalid', async () => {
    vi.resetModules()

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        defaultModelPreset: null,
        assistantModel: null,
        visionModel: null,
        systemPrompt: 'system prompt',
        permissionMode: 'default',
        disabledAgentTools: [],
        autoCompactionEnabled: true,
        autoCompactionTriggerThreshold: 72,
        autoCompactionRetainRecentPairs: 4
      }
    }

    const configService = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          ModelSelect: passthrough('ModelSelect'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    wrapper
      .findComponent('[data-testid="auto-compaction-trigger-threshold-input"]')
      .vm.$emit('update:modelValue', '')
    wrapper
      .findComponent('[data-testid="auto-compaction-retain-recent-pairs-input"]')
      .vm.$emit('update:modelValue', 'oops')
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))

    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.updateDeepChatAgent).toHaveBeenCalledTimes(1)

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.config.autoCompactionTriggerThreshold).toBe(80)
    expect(payload.config.autoCompactionRetainRecentPairs).toBe(2)
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
  })

  it('fills the system prompt field from a prompt template dialog', async () => {
    vi.resetModules()

    const configService = {
      listAgents: vi.fn().mockResolvedValue([]),
      getSystemPrompts: vi.fn().mockResolvedValue([
        {
          id: 'writer',
          name: 'Writer',
          content: 'You are a writing assistant.'
        },
        {
          id: 'coder',
          name: 'Coder',
          content: 'You write concise code.'
        }
      ]),
      updateDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          ModelSelect: passthrough('ModelSelect'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    const pickerButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('promptSetting.selectSystemPrompt'))

    expect(pickerButton).toBeDefined()

    await pickerButton!.trigger('click')
    await flushPromises()

    expect(configService.getSystemPrompts).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Writer')
    expect(wrapper.text()).toContain('Coder')

    const templateButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('You write concise code.'))

    expect(templateButton).toBeDefined()

    await templateButton!.trigger('click')
    await flushPromises()

    const systemPromptTextarea = wrapper
      .findAll('textarea')
      .find((textarea) =>
        textarea
          .attributes('placeholder')
          ?.includes('settings.deepchatAgents.systemPromptPlaceholder')
      )

    expect(systemPromptTextarea).toBeDefined()
    expect(systemPromptTextarea!.element.value).toBe('You write concise code.')
  })

  it('shows an unsaved draft agent in the sidebar before persisting', async () => {
    vi.resetModules()

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {}
    }
    const createdAgent = {
      id: 'deepchat-new',
      type: 'deepchat',
      name: 'Draft Writer',
      enabled: true,
      protected: false,
      description: '',
      avatar: null,
      config: {}
    }

    const configService = {
      listAgents: vi
        .fn()
        .mockResolvedValueOnce([existingAgent])
        .mockResolvedValueOnce([existingAgent, createdAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue(createdAgent),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          ModelSelect: passthrough('ModelSelect'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.add'))
    expect(addButton).toBeDefined()

    await addButton!.trigger('click')
    await flushPromises()

    expect(configService.createDeepChatAgent).not.toHaveBeenCalled()
    expect(
      wrapper
        .findAll('aside button')
        .some((button) => button.text().includes('settings.deepchatAgents.unnamed'))
    ).toBe(true)

    const nameInput = wrapper
      .findAll('input')
      .find((input) =>
        input.attributes('placeholder')?.includes('settings.deepchatAgents.namePlaceholder')
      )

    expect(nameInput).toBeDefined()

    await nameInput!.setValue('Draft Writer')
    await flushPromises()

    expect(
      wrapper.findAll('aside button').some((button) => button.text().includes('Draft Writer'))
    ).toBe(true)

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))

    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.createDeepChatAgent).toHaveBeenCalledTimes(1)
    expect(configService.createDeepChatAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Draft Writer'
      })
    )
  })

  it('stores an optional default directory on the agent config', async () => {
    vi.resetModules()

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: '',
      avatar: null,
      config: {
        defaultProjectPath: '/workspaces/writer'
      }
    }

    const configService = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue('/workspaces/selected')
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          ModelSelect: passthrough('ModelSelect'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    const directoryTrigger = wrapper
      .findAll('button')
      .find((button) => button.attributes('title') === '/workspaces/writer')

    expect(directoryTrigger).toBeDefined()
    expect(directoryTrigger!.text()).toContain('writer')

    const pickButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.project.openFolder'))

    expect(pickButton).toBeDefined()

    await pickButton!.trigger('click')
    await flushPromises()

    expect(projectPresenter.selectDirectory).toHaveBeenCalledTimes(1)
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.attributes('title') === '/workspaces/selected')
    ).toBe(true)

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))

    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.updateDeepChatAgent).toHaveBeenCalledWith(
      'deepchat',
      expect.objectContaining({
        config: expect.objectContaining({
          defaultProjectPath: '/workspaces/selected'
        })
      })
    )
    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
  })

  it('restores default Subagent slots when enabling an empty legacy policy', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: '',
      avatar: null,
      config: { subagentEnabled: false, subagents: [] }
    }
    const { wrapper, configService } = await mountSettings({ agents: [existingAgent] })
    const subagentSwitch = wrapper.get('[aria-label="settings.deepchatAgents.subagentsEnabled"]')

    expect(subagentSwitch.attributes('data-model-value')).toBe('false')
    expect(wrapper.findAll('select')).toHaveLength(0)

    await subagentSwitch.trigger('click')

    expect(subagentSwitch.attributes('data-model-value')).toBe('true')
    expect(wrapper.findAll('select')).toHaveLength(3)
    expect(wrapper.text()).toContain('explorer')
    expect(wrapper.text()).toContain('implementer')
    expect(wrapper.text()).toContain('reviewer')

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.updateDeepChatAgent).toHaveBeenCalledWith(
      'deepchat',
      expect.objectContaining({
        config: {
          subagentEnabled: true,
          subagents: [
            expect.objectContaining({ id: 'explorer', targetType: 'self' }),
            expect.objectContaining({ id: 'implementer', targetType: 'self' }),
            expect.objectContaining({ id: 'reviewer', targetType: 'self' })
          ]
        }
      })
    )
  })

  it('protects the final enabled Subagent slot and retains slots while disabled', async () => {
    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: '',
      avatar: null,
      config: {
        subagentEnabled: true,
        subagents: [
          {
            id: 'reviewer',
            targetType: 'self',
            displayName: 'Reviewer',
            description: ''
          }
        ]
      }
    }
    const { wrapper, configService } = await mountSettings({ agents: [existingAgent] })
    const deleteSlotButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'common.delete')

    expect(deleteSlotButton).toBeDefined()
    expect(deleteSlotButton!.attributes('disabled')).toBeDefined()
    await deleteSlotButton!.trigger('click')
    expect(wrapper.findAll('select')).toHaveLength(1)

    const subagentSwitch = wrapper.get('[aria-label="settings.deepchatAgents.subagentsEnabled"]')
    await subagentSwitch.trigger('click')

    expect(subagentSwitch.attributes('data-model-value')).toBe('false')
    expect(wrapper.findAll('select')).toHaveLength(1)

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.updateDeepChatAgent).toHaveBeenCalledWith(
      'deepchat',
      expect.objectContaining({ config: { subagentEnabled: false } })
    )
  })

  it('uses a flat target agent select for subagent slots', async () => {
    vi.resetModules()

    const existingAgent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      description: 'Writer agent',
      avatar: null,
      config: {
        subagentEnabled: true,
        subagents: [
          {
            id: 'slot-current',
            targetType: 'self',
            displayName: 'Current',
            description: ''
          },
          {
            id: 'slot-reviewer',
            targetType: 'agent',
            targetAgentId: 'acp-reviewer',
            displayName: 'Reviewer',
            description: ''
          }
        ]
      }
    }
    const acpAgent = {
      id: 'acp-reviewer',
      type: 'acp',
      name: 'ACP Reviewer',
      enabled: true,
      source: 'manual',
      protected: false,
      description: 'ACP reviewer',
      avatar: null,
      config: {}
    }
    const uninstalledRegistryAgent = {
      id: 'acp-uninstalled',
      type: 'acp',
      name: 'ACP Not Installed',
      enabled: true,
      source: 'registry',
      protected: false,
      description: 'ACP not installed',
      avatar: null,
      config: {},
      installState: {
        status: 'not_installed'
      }
    }

    const configService = {
      listAgents: vi.fn().mockResolvedValue([existingAgent, acpAgent, uninstalledRegistryAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi
        .fn()
        .mockResolvedValue({ removed: true, cleanupPendingRestart: false })
    }
    const toolService = {
      getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolService)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configService
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          DcButton: ButtonStub,
          Badge: passthrough('Badge'),
          Input: InputStub,
          Textarea: TextareaStub,
          Switch: SwitchStub,
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuItem: DropdownMenuItemStub,
          DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          ModelSelect: passthrough('ModelSelect'),
          AgentAvatar: passthrough('AgentAvatar'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).not.toContain('settings.deepchatAgents.subagentTargetType')

    const targetSelects = wrapper.findAll('select')
    expect(targetSelects).toHaveLength(2)
    expect(targetSelects[0].text()).toContain('settings.deepchatAgents.subagentTargetSelf')
    expect(targetSelects[0].text()).toContain('ACP Reviewer')
    expect(targetSelects[0].text()).not.toContain('ACP Not Installed')

    await targetSelects[0].setValue('acp-reviewer')
    await targetSelects[1].setValue('__current_agent__')

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))

    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    const [, payload] = configService.updateDeepChatAgent.mock.calls[0]
    expect(payload.config.subagents).toEqual([
      {
        id: 'slot-current',
        targetType: 'agent',
        targetAgentId: 'acp-reviewer',
        displayName: 'Current',
        description: ''
      },
      {
        id: 'slot-reviewer',
        targetType: 'self',
        displayName: 'Reviewer',
        description: ''
      }
    ])
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
  })
})
