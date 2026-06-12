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
  template: '<button @click="$emit(\'click\')"><slot /></button>'
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
    serverStatuses: {
      builtinKnowledge: true
    },
    toggleServer: vi.fn().mockResolvedValue(undefined),
    updateServer: vi.fn().mockResolvedValue(true)
  })
  const toast = vi.fn()

  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@api/legacy/presenters', () => ({
    useLegacyPresenter: (name: string) => {
      if (name === 'llmproviderPresenter') {
        return {
          getDimensions: vi.fn().mockResolvedValue({
            data: {
              dimensions: 1536,
              normalized: true
            }
          })
        }
      }
      return {
        getSupportedLanguages: vi.fn().mockResolvedValue(['markdown']),
        getSeparatorsForLanguage: vi.fn().mockResolvedValue(['\n\n', '\n', ' ', ''])
      }
    }
  }))
  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => mcpStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => ({
      enabledModels: []
    })
  }))
  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => ({})
  }))
  vi.doMock('@/components/use-toast', () => ({
    toast
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
    mcpStore
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
  })

  it('does not update local configs or close dialog when ConfigClient save fails', async () => {
    const { wrapper, configClient, mcpStore } = await setup({ setRejects: true })
    const vm = wrapper.vm as any
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
  })
})
