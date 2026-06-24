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

const clientMocks = vi.hoisted(() => ({
  projectClient: {
    listRecent: vi.fn(),
    selectDirectory: vi.fn()
  },
  toolClient: {
    getAllToolDefinitions: vi.fn()
  }
}))

type ProjectClientMockSource = {
  getRecentProjects: (limit?: number) => Promise<unknown>
  selectDirectory: () => Promise<unknown>
}
type ToolClientMockSource = {
  getAllToolDefinitions: (context: unknown) => Promise<unknown>
}

const bindClientMocks = (
  projectPresenter: ProjectClientMockSource,
  toolPresenter: ToolClientMockSource
) => {
  clientMocks.projectClient.listRecent.mockImplementation((limit?: number) =>
    projectPresenter.getRecentProjects(limit)
  )
  clientMocks.projectClient.selectDirectory.mockImplementation(() =>
    projectPresenter.selectDirectory()
  )
  clientMocks.toolClient.getAllToolDefinitions.mockImplementation((context: unknown) =>
    toolPresenter.getAllToolDefinitions(context)
  )
}

vi.mock('@api/ProjectClient', () => ({
  createProjectClient: () => clientMocks.projectClient
}))
vi.mock('@api/ToolClient', () => ({
  createToolClient: () => clientMocks.toolClient
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
    clientMocks.toolClient.getAllToolDefinitions.mockReset()
  })

  const mountSettings = async (options: {
    agents: unknown[]
    modelStore?: unknown
    toolDefinitions?: unknown[]
    projectPresenter?: {
      getRecentProjects: ReturnType<typeof vi.fn>
      selectDirectory: ReturnType<typeof vi.fn>
    }
    configPresenter?: Partial<{
      listAgents: ReturnType<typeof vi.fn>
      getSystemPrompts: ReturnType<typeof vi.fn>
      updateDeepChatAgent: ReturnType<typeof vi.fn>
      createDeepChatAgent: ReturnType<typeof vi.fn>
      deleteDeepChatAgent: ReturnType<typeof vi.fn>
    }>
  }) => {
    vi.resetModules()

    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue(options.agents),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(options.agents[0]),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined),
      ...options.configPresenter
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue(options.toolDefinitions ?? [])
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

    bindClientMocks(projectPresenter, toolPresenter)

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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
          AgentTransferDialog: passthrough('AgentTransferDialog'),
          ModelIcon: passthrough('ModelIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    return {
      wrapper,
      configPresenter,
      toolPresenter,
      projectPresenter
    }
  }

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

    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([
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
    bindClientMocks(projectPresenter, toolPresenter)
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
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    expect(configPresenter.updateDeepChatAgent).toHaveBeenCalledTimes(1)

    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
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

    const { wrapper, configPresenter } = await mountSettings({ agents: [existingAgent] })

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

    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
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

    const { wrapper, configPresenter } = await mountSettings({ agents: [existingAgent] })

    await wrapper.get('[data-testid="deepchat-agent-name-input"]').setValue('DeepChat Renamed')
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
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

    const { wrapper, configPresenter } = await mountSettings({ agents: [existingAgent] })

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

    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
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
    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolPresenter)

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolPresenter)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolPresenter)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))

    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    expect(configPresenter.updateDeepChatAgent).toHaveBeenCalledTimes(1)

    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
    expect(payload.config.autoCompactionTriggerThreshold).toBe(91)
    expect(payload.config.autoCompactionRetainRecentPairs).toBe(6)
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
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

    const { wrapper, configPresenter } = await mountSettings({
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

    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
    expect(payload.config).toEqual({ disabledAgentTools: ['tool_alpha'] })
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
  })

  it('keeps an inherited memoryEnabled out of the payload when the switch is not toggled', async () => {
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

    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue([builtin, child]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(child),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = { getAllToolDefinitions: vi.fn().mockResolvedValue([]) }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolPresenter)
    const modelStore = { allProviderModels: [], findModelByIdOrName: vi.fn(() => null) }

    vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configPresenter }))
    vi.doMock('@/stores/modelStore', () => ({ useModelStore: () => modelStore }))
    vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
    vi.doMock('@iconify/vue', () => ({ Icon: { name: 'Icon', template: '<span />' } }))

    const DeepChatAgentsSettings = (
      await import('../../../src/renderer/settings/components/DeepChatAgentsSettings.vue')
    ).default

    const wrapper = mount(DeepChatAgentsSettings, {
      global: {
        stubs: {
          Button: ButtonStub,
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

    // Select the child agent, which inherits memoryEnabled=true from the builtin deepchat.
    await wrapper.find('[data-testid="deepchat-agent-row-child"]').trigger('click')
    await flushPromises()

    const memorySwitch = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === 'settings.deepchatAgents.memoryEnabled')
    expect(memorySwitch?.attributes('data-model-value')).toBe('true')

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    const [agentId, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
    expect(agentId).toBe('child')
    // The inherited value must not be ossified into an explicit override.
    expect(payload.config?.memoryEnabled).toBeUndefined()
  })

  it('sends memoryEnabled when an inherited memory switch is explicitly toggled', async () => {
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

    const { wrapper, configPresenter } = await mountSettings({
      agents: [builtin, child],
      configPresenter: {
        updateDeepChatAgent: vi.fn().mockResolvedValue(child)
      }
    })

    await wrapper.find('[data-testid="deepchat-agent-row-child"]').trigger('click')
    await flushPromises()

    const memorySwitch = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === 'settings.deepchatAgents.memoryEnabled')
    expect(memorySwitch?.attributes('data-model-value')).toBe('true')

    await memorySwitch!.trigger('click')
    await flushPromises()

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    await saveButton!.trigger('click')
    await flushPromises()

    const [agentId, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
    expect(agentId).toBe('child')
    expect(payload.config).toEqual({ memoryEnabled: false })
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

    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolPresenter)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))

    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    expect(configPresenter.updateDeepChatAgent).toHaveBeenCalledTimes(1)

    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
    expect(payload.config.autoCompactionTriggerThreshold).toBe(80)
    expect(payload.config.autoCompactionRetainRecentPairs).toBe(2)
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
  })

  it('fills the system prompt field from a prompt template dialog', async () => {
    vi.resetModules()

    const configPresenter = {
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
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolPresenter)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    expect(configPresenter.getSystemPrompts).toHaveBeenCalledTimes(1)
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

    const configPresenter = {
      listAgents: vi
        .fn()
        .mockResolvedValueOnce([existingAgent])
        .mockResolvedValueOnce([existingAgent, createdAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue(createdAgent),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolPresenter)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    expect(configPresenter.createDeepChatAgent).not.toHaveBeenCalled()
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

    expect(configPresenter.createDeepChatAgent).toHaveBeenCalledTimes(1)
    expect(configPresenter.createDeepChatAgent).toHaveBeenCalledWith(
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

    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue([existingAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue('/workspaces/selected')
    }
    bindClientMocks(projectPresenter, toolPresenter)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    expect(configPresenter.updateDeepChatAgent).toHaveBeenCalledWith(
      'deepchat',
      expect.objectContaining({
        config: expect.objectContaining({
          defaultProjectPath: '/workspaces/selected'
        })
      })
    )
    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
    expect(payload.config).not.toHaveProperty('defaultModelPreset')
    expect(payload.config).not.toHaveProperty('assistantModel')
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

    const configPresenter = {
      listAgents: vi.fn().mockResolvedValue([existingAgent, acpAgent, uninstalledRegistryAgent]),
      getSystemPrompts: vi.fn().mockResolvedValue([]),
      updateDeepChatAgent: vi.fn().mockResolvedValue(existingAgent),
      createDeepChatAgent: vi.fn().mockResolvedValue({ id: 'deepchat-new' }),
      deleteDeepChatAgent: vi.fn().mockResolvedValue(undefined)
    }
    const toolPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([])
    }
    const projectPresenter = {
      getRecentProjects: vi.fn().mockResolvedValue([]),
      selectDirectory: vi.fn().mockResolvedValue(null)
    }
    bindClientMocks(projectPresenter, toolPresenter)
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => configPresenter
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
          Button: ButtonStub,
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

    const [, payload] = configPresenter.updateDeepChatAgent.mock.calls[0]
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
