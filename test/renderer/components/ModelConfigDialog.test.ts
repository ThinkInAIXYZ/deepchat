import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { ReasoningPortrait } from '../../../src/shared/types/model-db'
import { ApiEndpointType, ModelType } from '../../../src/shared/model'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

type SetupOptions = {
  providerId: string
  modelId: string
  modelName: string
  providerApiType?: string
  modelConfig?: Record<string, unknown>
  reasoningPortrait?: ReasoningPortrait | null
  mode?: 'create' | 'edit'
  isCustomModel?: boolean
  providerModels?: Array<Record<string, unknown>>
  customModels?: Array<Record<string, unknown>>
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
    customModels: [
      {
        providerId: options.providerId,
        models: options.customModels ?? []
      }
    ],
    allProviderModels: [
      {
        providerId: options.providerId,
        models: options.providerModels ?? [{ id: options.modelId, name: options.modelName }]
      }
    ],
    addCustomModel: vi.fn().mockResolvedValue(undefined),
    removeCustomModel: vi.fn().mockResolvedValue(undefined),
    updateCustomModel: vi.fn().mockResolvedValue(undefined),
    updateModelStatus: vi.fn().mockResolvedValue(undefined)
  })

  const providerStore = reactive({
    providers: [{ id: options.providerId, apiType: options.providerApiType ?? 'openai-compatible' }]
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
  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      storeToRefs: () => ({
        customModels: ref(modelStore.customModels),
        allProviderModels: ref(modelStore.allProviderModels)
      })
    }
  })
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
      providerId: options.providerId,
      mode: options.mode ?? 'edit',
      isCustomModel: options.isCustomModel ?? false
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

  return { wrapper, modelConfigStore }
}

describe('ModelConfigDialog reasoning portraits', () => {
  it('shows interleaved thinking when an OpenAI-compatible model defaults to interleaved mode', async () => {
    const { wrapper } = await setup({
      providerId: 'zenmux',
      modelId: 'moonshotai/kimi-k2.5',
      modelName: 'Kimi K2.5',
      modelConfig: {
        reasoning: true,
        forceInterleavedThinkingCompat: true
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        interleaved: true,
        mode: 'effort',
        effort: 'medium',
        effortOptions: ['minimal', 'low', 'medium', 'high'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      }
    })

    expect(wrapper.text()).toContain('settings.model.modelConfig.interleavedThinking.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.interleavedThinking.description')
  })

  it('hides interleaved thinking for Responses providers', async () => {
    const { wrapper } = await setup({
      providerId: 'openai',
      modelId: 'gpt-5',
      modelName: 'GPT-5',
      providerApiType: 'openai-responses',
      modelConfig: {
        reasoning: true,
        forceInterleavedThinkingCompat: true
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        interleaved: true,
        mode: 'effort',
        effort: 'medium',
        effortOptions: ['minimal', 'low', 'medium', 'high'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      }
    })

    expect(wrapper.text()).not.toContain('settings.model.modelConfig.interleavedThinking.label')
  })

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

describe('ModelConfigDialog new-api endpoint normalization', () => {
  it('restores chat routing and provider model type when switching away from image-generation', async () => {
    const { wrapper, modelConfigStore } = await setup({
      providerId: 'new-api',
      modelId: 'gpt-4.1',
      modelName: 'GPT-4.1',
      providerApiType: 'new-api',
      providerModels: [
        {
          id: 'gpt-4.1',
          name: 'GPT-4.1',
          type: ModelType.Chat,
          supportedEndpointTypes: ['openai', 'image-generation'],
          endpointType: 'openai'
        }
      ],
      modelConfig: {
        type: ModelType.ImageGeneration,
        apiEndpoint: ApiEndpointType.Image,
        endpointType: 'image-generation'
      }
    })

    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Image)
    expect((wrapper.vm as any).config.type).toBe(ModelType.ImageGeneration)

    ;(wrapper.vm as any).config.endpointType = 'openai'
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Chat)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)

    await (wrapper.vm as any).handleSave()

    expect(modelConfigStore.setModelConfig).toHaveBeenCalledWith(
      'gpt-4.1',
      'new-api',
      expect.objectContaining({
        endpointType: 'openai',
        apiEndpoint: ApiEndpointType.Chat,
        type: ModelType.Chat
      })
    )
  })

  it('forces image endpoint for image-generation and falls back to chat type for custom models', async () => {
    const { wrapper, modelConfigStore } = await setup({
      providerId: 'new-api',
      modelId: '',
      modelName: '',
      providerApiType: 'new-api',
      mode: 'create',
      modelConfig: {
        type: ModelType.Chat,
        apiEndpoint: ApiEndpointType.Chat
      }
    })

    ;(wrapper.vm as any).config.endpointType = 'image-generation'
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Image)
    expect((wrapper.vm as any).config.type).toBe(ModelType.ImageGeneration)

    ;(wrapper.vm as any).config.endpointType = 'openai'
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Chat)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)

    ;(wrapper.vm as any).modelIdField = 'custom-image-model'
    ;(wrapper.vm as any).modelNameField = 'Custom Image Model'
    await (wrapper.vm as any).handleSave()

    expect(modelConfigStore.setModelConfig).toHaveBeenCalledWith(
      'custom-image-model',
      'new-api',
      expect.objectContaining({
        endpointType: 'openai',
        apiEndpoint: ApiEndpointType.Chat,
        type: ModelType.Chat
      })
    )
  })
})
