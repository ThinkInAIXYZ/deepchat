import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { ReasoningPortrait } from '../../../src/shared/types/model-db'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

type SetupOptions = {
  providerId: string
  modelId: string
  modelName: string
  modelConfig?: Record<string, unknown>
  reasoningPortrait?: ReasoningPortrait | null
}

const setup = async (options: SetupOptions) => {
  vi.resetModules()

  const modelConfigStore = {
    getModelConfig: vi.fn().mockResolvedValue({
      maxTokens: 4096,
      contextLength: 16000,
      temperature: 0.7,
      vision: false,
      functionCall: true,
      reasoning: true,
      type: 'chat',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      ...options.modelConfig
    }),
    setModelConfig: vi.fn().mockResolvedValue(undefined),
    resetModelConfig: vi.fn().mockResolvedValue(undefined)
  }

  const modelStore = reactive({
    customModels: [],
    allProviderModels: [
      {
        providerId: options.providerId,
        models: [{ id: options.modelId, name: options.modelName }]
      }
    ],
    addCustomModel: vi.fn().mockResolvedValue(undefined),
    removeCustomModel: vi.fn().mockResolvedValue(undefined),
    updateCustomModel: vi.fn().mockResolvedValue(undefined),
    updateModelStatus: vi.fn().mockResolvedValue(undefined)
  })

  const providerStore = reactive({
    providers: [{ id: options.providerId, apiType: 'openai-compatible' }]
  })

  const configPresenter = {
    getReasoningPortrait: vi.fn().mockResolvedValue(options.reasoningPortrait ?? null)
  }

  vi.doMock('@/stores/modelConfigStore', () => ({
    useModelConfigStore: () => modelConfigStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => configPresenter
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const ModelConfigDialog = (await import('@/components/settings/ModelConfigDialog.vue')).default
  const wrapper = mount(ModelConfigDialog, {
    props: {
      open: true,
      modelId: options.modelId,
      modelName: options.modelName,
      providerId: options.providerId
    },
    global: {
      stubs: {
        Dialog: passthrough('Dialog'),
        DialogContent: passthrough('DialogContent'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        DialogFooter: passthrough('DialogFooter'),
        AlertDialog: passthrough('AlertDialog'),
        AlertDialogAction: passthrough('AlertDialogAction'),
        AlertDialogCancel: passthrough('AlertDialogCancel'),
        AlertDialogContent: passthrough('AlertDialogContent'),
        AlertDialogDescription: passthrough('AlertDialogDescription'),
        AlertDialogFooter: passthrough('AlertDialogFooter'),
        AlertDialogHeader: passthrough('AlertDialogHeader'),
        AlertDialogTitle: passthrough('AlertDialogTitle'),
        Button: passthrough('Button'),
        Input: passthrough('Input'),
        Label: passthrough('Label'),
        Switch: passthrough('Switch'),
        Select: passthrough('Select'),
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue')
      }
    }
  })

  await flushPromises()

  return { wrapper }
}

describe('ModelConfigDialog reasoning portraits', () => {
  it('renders full effort options for non-grok-3-mini xAI portraits', async () => {
    const { wrapper } = await setup({
      providerId: 'xai',
      modelId: 'grok-4',
      modelName: 'Grok 4',
      modelConfig: {
        reasoning: true,
        reasoningEffort: 'minimal'
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'minimal',
        effortOptions: ['minimal', 'low', 'medium', 'high'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      }
    })

    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.minimal')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.medium')
  })

  it('hides effort and budget controls for level-based portraits', async () => {
    const { wrapper } = await setup({
      providerId: 'vertex',
      modelId: 'gemini-3-flash-preview',
      modelName: 'Gemini 3 Flash Preview',
      modelConfig: {
        reasoning: true,
        reasoningEffort: undefined,
        thinkingBudget: undefined
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'level',
        level: 'high',
        levelOptions: ['minimal', 'low', 'medium', 'high']
      }
    })

    expect(wrapper.text()).not.toContain('settings.model.modelConfig.reasoningEffort.label')
    expect(wrapper.text()).not.toContain('settings.model.modelConfig.thinkingBudget.label')
  })
})
