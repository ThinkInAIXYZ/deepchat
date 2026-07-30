import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const createKnowledgeConfig = (id: string) => ({
  id,
  description: 'Local docs',
  embedding: {
    providerId: 'openai',
    modelId: 'text-embedding-3-small'
  },
  dimensions: 1536,
  normalized: true,
  fragmentsNumber: 6,
  enabled: true
})

async function setup(options: { setRejects?: boolean } = {}) {
  vi.resetModules()

  const configClient = {
    getKnowledgeConfigs: vi.fn().mockResolvedValue([createKnowledgeConfig('knowledge-1')]),
    setKnowledgeConfigs: options.setRejects
      ? vi.fn().mockRejectedValue(new Error('save failed'))
      : vi.fn().mockResolvedValue([])
  }
  const mcpStore = reactive({
    mcpEnabled: true,
    config: {
      mcpServers: {
        builtinKnowledge: {
          enabled: true
        }
      }
    },
    serverStatuses: {
      builtinKnowledge: true
    },
    toggleServer: vi.fn().mockResolvedValue(true),
    updateServer: vi.fn().mockResolvedValue(true)
  })
  const feedbackSnapshot = ref<any>({ status: 'idle', version: 0 })
  const feedbackController = {
    begin: vi.fn((operationId: string, label: string) => {
      feedbackSnapshot.value = { status: 'pending', operationId, label, version: 1 }
    }),
    succeed: vi.fn((result) => {
      feedbackSnapshot.value = {
        status: 'success',
        operationId: 'builtin-knowledge-operation',
        ...result,
        version: 2
      }
    }),
    fail: vi.fn((result) => {
      feedbackSnapshot.value = {
        status: 'error',
        operationId: 'builtin-knowledge-operation',
        ...result,
        version: 2
      }
    }),
    clearSettled: vi.fn(() => {
      feedbackSnapshot.value = { status: 'idle', version: 3 }
    })
  }
  const providerClient = {
    getEmbeddingDimensions: vi.fn().mockResolvedValue({
      data: {
        dimensions: 1536,
        normalized: true
      }
    })
  }
  const knowledgeClient = {
    getSupportedLanguages: vi.fn().mockResolvedValue(['markdown']),
    getSeparatorsForLanguage: vi.fn().mockResolvedValue(['\n\n', '\n', ' ', ''])
  }

  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@api/ProviderClient', () => ({
    createProviderClient: () => providerClient
  }))
  vi.doMock('@api/KnowledgeClient', () => ({
    createKnowledgeClient: () => knowledgeClient
  }))
  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => mcpStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => ({
      enabledModels: [
        {
          providerId: 'openai',
          models: [
            {
              id: 'text-embedding-3-small',
              name: 'Embedding Small',
              enabled: true
            }
          ]
        }
      ]
    })
  }))
  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => ({})
  }))
  vi.doMock('@renderer-notifications/rendererNotificationRuntime', () => ({
    createRendererSurfaceFeedbackController: () => feedbackController
  }))
  vi.doMock('@renderer-notifications/useSurfaceFeedback', () => ({
    useSurfaceFeedback: () => ({
      snapshot: feedbackSnapshot,
      setActive: vi.fn()
    })
  }))
  vi.doMock('../../../src/renderer/settings/services/settingsLeaveGuard', () => ({
    settingsLeaveGuard: {
      register: () => ({
        setRisk: vi.fn(),
        release: vi.fn()
      })
    }
  }))
  vi.doMock('vue-router', () => ({
    useRoute: () => reactive({ query: {} })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const BuiltinKnowledgeSettings = (
    await import('../../../src/renderer/settings/components/BuiltinKnowledgeSettings.vue')
  ).default

  const wrapper = mount(BuiltinKnowledgeSettings, {
    global: {
      mocks: {
        $t: (key: string) => key
      },
      stubs: {
        Icon: true,
        Button: buttonStub,
        Switch: true,
        Input: true,
        Label: true,
        Slider: true,
        ModelSelect: true,
        ModelIcon: true,
        InlineOperationFeedback: true,
        ScrollArea: passthrough('ScrollArea'),
        Collapsible: passthrough('Collapsible'),
        CollapsibleContent: passthrough('CollapsibleContent'),
        Dialog: passthrough('Dialog'),
        DialogContent: passthrough('DialogContent'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        DialogFooter: passthrough('DialogFooter'),
        DialogDescription: passthrough('DialogDescription'),
        AlertDialog: passthrough('AlertDialog'),
        AlertDialogAction: buttonStub,
        AlertDialogCancel: buttonStub,
        AlertDialogContent: passthrough('AlertDialogContent'),
        AlertDialogDescription: passthrough('AlertDialogDescription'),
        AlertDialogFooter: passthrough('AlertDialogFooter'),
        AlertDialogHeader: passthrough('AlertDialogHeader'),
        AlertDialogTitle: passthrough('AlertDialogTitle'),
        AlertDialogTrigger: passthrough('AlertDialogTrigger'),
        Popover: passthrough('Popover'),
        PopoverContent: passthrough('PopoverContent'),
        PopoverTrigger: passthrough('PopoverTrigger'),
        Tooltip: passthrough('Tooltip'),
        TooltipContent: passthrough('TooltipContent'),
        TooltipProvider: passthrough('TooltipProvider'),
        TooltipTrigger: passthrough('TooltipTrigger'),
        Accordion: passthrough('Accordion'),
        AccordionContent: passthrough('AccordionContent'),
        AccordionItem: passthrough('AccordionItem'),
        AccordionTrigger: passthrough('AccordionTrigger')
      }
    }
  })
  await flushPromises()

  return {
    wrapper,
    configClient,
    providerClient,
    knowledgeClient,
    mcpStore,
    feedbackController
  }
}

describe('BuiltinKnowledgeSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads built-in knowledge configs from ConfigClient', async () => {
    const { wrapper, configClient, mcpStore } = await setup()

    expect(configClient.getKnowledgeConfigs).toHaveBeenCalledTimes(1)
    expect((wrapper.vm as any).builtinConfigs).toEqual([createKnowledgeConfig('knowledge-1')])
    expect(mcpStore.updateServer).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not update local configs or close dialog when ConfigClient save fails', async () => {
    const { wrapper, configClient, mcpStore, feedbackController } = await setup({
      setRejects: true
    })
    const vm = wrapper.vm as any
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vm.builtinConfigs = []
    vm.isEditing = false
    vm.isBuiltinConfigDialogOpen = true
    vm.autoDetectDimensionsSwitch = false
    vm.fragmentsNumber = [6]
    vm.editingBuiltinConfig = createKnowledgeConfig('knowledge-2')

    await vm.saveBuiltinConfig()
    await flushPromises()

    expect(configClient.setKnowledgeConfigs).toHaveBeenCalledWith([
      createKnowledgeConfig('knowledge-2')
    ])
    expect(vm.builtinConfigs).toEqual([])
    expect(vm.isBuiltinConfigDialogOpen).toBe(true)
    expect(mcpStore.updateServer).not.toHaveBeenCalled()
    expect(feedbackController.fail).toHaveBeenCalledWith({
      code: 'settings.knowledgeBase.builtin.save.failed',
      title: 'common.error.operationFailed'
    })
    consoleError.mockRestore()
    wrapper.unmount()
  })

  it('auto-detects embedding dimensions through ProviderClient before saving', async () => {
    const { wrapper, configClient, providerClient } = await setup()
    const vm = wrapper.vm as any
    vm.builtinConfigs = []
    vm.isEditing = false
    vm.isBuiltinConfigDialogOpen = true
    vm.autoDetectDimensionsSwitch = true
    vm.fragmentsNumber = [6]
    vm.editingBuiltinConfig = {
      ...createKnowledgeConfig('knowledge-2'),
      dimensions: Number.NaN,
      normalized: false
    }

    await vm.saveBuiltinConfig()
    await flushPromises()

    expect(providerClient.getEmbeddingDimensions).toHaveBeenCalledWith(
      'openai',
      'text-embedding-3-small'
    )
    expect(configClient.setKnowledgeConfigs).toHaveBeenCalledWith([
      createKnowledgeConfig('knowledge-2')
    ])
    expect(vm.isBuiltinConfigDialogOpen).toBe(false)
    wrapper.unmount()
  })

  it('keeps the draft open with a specific error when dimension detection fails', async () => {
    const { wrapper, configClient, providerClient, feedbackController } = await setup()
    const vm = wrapper.vm as any
    providerClient.getEmbeddingDimensions.mockResolvedValueOnce({
      data: null,
      errorMsg: 'model request failed'
    })
    vm.builtinConfigs = []
    vm.isEditing = false
    vm.isBuiltinConfigDialogOpen = true
    vm.autoDetectDimensionsSwitch = true
    vm.fragmentsNumber = [6]
    vm.editingBuiltinConfig = {
      ...createKnowledgeConfig('knowledge-2'),
      dimensions: Number.NaN
    }

    await vm.saveBuiltinConfig()

    expect(configClient.setKnowledgeConfigs).not.toHaveBeenCalled()
    expect(vm.isBuiltinConfigDialogOpen).toBe(true)
    expect(feedbackController.fail).toHaveBeenCalledWith({
      code: 'settings.knowledgeBase.builtin.save.failed',
      title: 'settings.knowledgeBase.autoDetectDimensionsError'
    })
    wrapper.unmount()
  })

  it('reuses detected dimensions when retrying only the persistence step', async () => {
    const { wrapper, configClient, providerClient } = await setup()
    const vm = wrapper.vm as any
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    configClient.setKnowledgeConfigs.mockRejectedValueOnce(new Error('first save failed'))
    vm.builtinConfigs = []
    vm.isEditing = false
    vm.isBuiltinConfigDialogOpen = true
    vm.autoDetectDimensionsSwitch = true
    vm.fragmentsNumber = [6]
    vm.editingBuiltinConfig = {
      ...createKnowledgeConfig('knowledge-2'),
      dimensions: Number.NaN
    }

    await vm.saveBuiltinConfig()
    vm.knowledgeOperation.retry()
    await flushPromises()

    expect(providerClient.getEmbeddingDimensions).toHaveBeenCalledTimes(1)
    expect(configClient.setKnowledgeConfigs).toHaveBeenCalledTimes(2)
    expect(vm.isBuiltinConfigDialogOpen).toBe(false)
    consoleError.mockRestore()
    wrapper.unmount()
  })

  it('rejects partially valid separator syntax without persisting the draft', async () => {
    const { wrapper, configClient } = await setup()
    const vm = wrapper.vm as any
    vm.builtinConfigs = []
    vm.isEditing = false
    vm.isBuiltinConfigDialogOpen = true
    vm.autoDetectDimensionsSwitch = false
    vm.fragmentsNumber = [6]
    vm.separators = '"\\n", trailing text'
    vm.editingBuiltinConfig = createKnowledgeConfig('knowledge-2')

    await vm.saveBuiltinConfig()

    expect(configClient.setKnowledgeConfigs).not.toHaveBeenCalled()
    expect(vm.dialogValidationError).toBe('settings.knowledgeBase.invalidSeparators')
    expect(vm.isBuiltinConfigDialogOpen).toBe(true)
    wrapper.unmount()
  })

  it('loads supported separators through KnowledgeClient', async () => {
    const { wrapper, knowledgeClient } = await setup()
    const vm = wrapper.vm as any

    await vm.handleLanguageSelect('markdown')
    await flushPromises()

    expect(knowledgeClient.getSupportedLanguages).toHaveBeenCalledTimes(1)
    expect(knowledgeClient.getSeparatorsForLanguage).toHaveBeenCalledWith('markdown')
    expect(vm.separators).toBe('"\\n\\n", "\\n", " ", ""')
    wrapper.unmount()
  })

  it('keeps nested persisted config state isolated from an edit draft', async () => {
    const { wrapper } = await setup()
    const vm = wrapper.vm as any

    await vm.editBuiltinConfig(0)
    vm.editingBuiltinConfig.embedding.modelId = 'changed-before-save'

    expect(vm.builtinConfigs[0].embedding.modelId).toBe('text-embedding-3-small')
    wrapper.unmount()
  })

  it('preserves the built-in server preference when global MCP is disabled', async () => {
    const { wrapper, mcpStore } = await setup()

    mcpStore.mcpEnabled = false
    await flushPromises()

    expect(mcpStore.toggleServer).not.toHaveBeenCalled()
    expect(mcpStore.config.mcpServers.builtinKnowledge.enabled).toBe(true)
    wrapper.unmount()
  })
})
