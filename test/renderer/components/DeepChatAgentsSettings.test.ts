import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

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

describe('DeepChatAgentsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mounts and saves DeepChat agents without advanced model overrides', async () => {
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
        assistantModel: null,
        visionModel: null,
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
    const modelStore = {
      allProviderModels: [
        {
          providerId: 'openai',
          models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }]
        }
      ],
      findModelByIdOrName: vi.fn(() => ({
        providerId: 'openai',
        model: { id: 'gpt-4.1', name: 'GPT-4.1' }
      }))
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'configPresenter') return configPresenter
        if (name === 'projectPresenter') return projectPresenter
        if (name === 'toolPresenter') return toolPresenter
        return {}
      }
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

    expect(wrapper.text()).not.toContain('settings.deepchatAgents.temperature')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.reasoningEffort')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.verbosity')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.interleaved')
    expect(wrapper.text()).toContain('GPT-4.1')
    expect(wrapper.text()).not.toContain('openai/gpt-4.1')

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
      description: 'Writer agent',
      config: {
        defaultModelPreset: {
          providerId: 'openai',
          modelId: 'gpt-4.1'
        },
        assistantModel: null,
        visionModel: null,
        defaultProjectPath: null,
        systemPrompt: 'system prompt',
        permissionMode: 'default',
        disabledAgentTools: ['tool_beta'],
        autoCompactionEnabled: false,
        autoCompactionTriggerThreshold: 72,
        autoCompactionRetainRecentPairs: 4
      }
    })
    expect(payload.config.defaultModelPreset).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4.1'
    })
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
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'configPresenter') return configPresenter
        if (name === 'projectPresenter') return projectPresenter
        if (name === 'toolPresenter') return toolPresenter
        return {}
      }
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
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'configPresenter') return configPresenter
        if (name === 'projectPresenter') return projectPresenter
        if (name === 'toolPresenter') return toolPresenter
        return {}
      }
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
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'configPresenter') return configPresenter
        if (name === 'projectPresenter') return projectPresenter
        if (name === 'toolPresenter') return toolPresenter
        return {}
      }
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
    const modelStore = {
      allProviderModels: [],
      findModelByIdOrName: vi.fn(() => null)
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'configPresenter') return configPresenter
        if (name === 'projectPresenter') return projectPresenter
        if (name === 'toolPresenter') return toolPresenter
        return {}
      }
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
  })
})
