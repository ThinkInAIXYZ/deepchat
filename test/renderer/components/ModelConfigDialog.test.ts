import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { ReasoningPortrait } from '../../../src/shared/types/model-db'
import { ApiEndpointType, ModelType } from '../../../src/shared/model'
import type { ModelRequestPolicy } from '../../../src/shared/modelRequestPolicy'

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
  capabilityProviderId?: string
  modelConfig?: Record<string, unknown>
  reasoningPortrait?: ReasoningPortrait | null
  temperatureCapability?: boolean | undefined
  requestPolicy?: ModelRequestPolicy
  mode?: 'create' | 'edit'
  isCustomModel?: boolean
  providerModels?: Array<Record<string, unknown>>
  customModels?: Array<Record<string, unknown>>
  getModelConfig?: (...args: string[]) => Promise<Record<string, unknown>> | Record<string, unknown>
  getCapabilities?: (query: {
    providerId: string
    modelId: string
  }) => Promise<Record<string, unknown>>
}

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const createCapabilityResult = (options: SetupOptions, modelId = options.modelId) => {
  const temperatureCapability =
    'temperatureCapability' in options ? options.temperatureCapability : true

  return {
    identity: {
      providerId: options.capabilityProviderId ?? options.providerId,
      requestModelId: modelId,
      catalogMatched: false as const,
      catalogModelId: null
    },
    requestPolicy: options.requestPolicy ?? {
      temperature:
        temperatureCapability === false
          ? ({ mode: 'omit' } as const)
          : ({ mode: 'passthrough' } as const),
      topP:
        (options.capabilityProviderId ?? options.providerId) === 'anthropic' &&
        temperatureCapability === false
          ? ({ mode: 'omit' } as const)
          : ({ mode: 'passthrough' } as const),
      reasoning: { mode: 'passthrough' as const },
      legacyThinking: { mode: 'passthrough' as const }
    },
    supportsAudioInput: false,
    supportsReasoning: options.reasoningPortrait?.supported ?? true,
    reasoningPortrait: options.reasoningPortrait ?? null,
    thinkingBudgetRange: options.reasoningPortrait?.budget ?? {},
    supportsSearch: false,
    searchDefaults: {},
    supportsTemperatureControl: temperatureCapability !== false,
    temperatureCapability,
    supportsReasoningEffort: Boolean(options.reasoningPortrait?.effort),
    reasoningEffortDefault: options.reasoningPortrait?.effort,
    supportsVerbosity: Boolean(options.reasoningPortrait?.verbosity),
    verbosityDefault: options.reasoningPortrait?.verbosity
  }
}

const setup = async (options: SetupOptions) => {
  vi.resetModules()

  const defaultModelConfig = {
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
  }
  const modelConfigStore = {
    getModelConfig: vi
      .fn()
      .mockImplementation(options.getModelConfig ?? (() => Promise.resolve(defaultModelConfig))),
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

  const defaultGetCapabilities = ({ modelId }: { providerId: string; modelId: string }) =>
    Promise.resolve(createCapabilityResult(options, modelId))
  const modelClient = {
    getCapabilities: vi.fn().mockImplementation(options.getCapabilities ?? defaultGetCapabilities)
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
  vi.doMock('@api/ModelClient', () => ({
    createModelClient: vi.fn(() => modelClient)
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
        DcButton: passthrough('Button'),
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

  return { wrapper, modelConfigStore, modelStore, modelClient }
}

describe('ModelConfigDialog reasoning portraits', () => {
  it('renders the speech recognition model setting for chat models', async () => {
    const { wrapper } = await setup({
      providerId: 'openai',
      modelId: 'gpt-4.1',
      modelName: 'GPT-4.1',
      modelConfig: {
        speechRecognition: true
      }
    })

    expect(wrapper.text()).toContain('settings.model.modelConfig.speechRecognition.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.speechRecognition.description')
  })

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

  it('keeps none as the portrait default and renders explicit extended effort options', async () => {
    const { wrapper } = await setup({
      providerId: 'openai',
      modelId: 'gpt-5.2',
      modelName: 'GPT-5.2',
      modelConfig: {
        reasoning: false,
        reasoningEffort: undefined
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort',
        effort: 'none',
        effortOptions: ['none', 'low', 'medium', 'high', 'xhigh'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      }
    })

    expect((wrapper.vm as any).config.reasoningEffort).toBe('none')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.none')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.xhigh')
  })

  it('uses the resolved New API route for GPT-5.6 defaults until the route is edited', async () => {
    const { wrapper, modelClient } = await setup({
      providerId: 'new-api',
      modelId: 'gpt-5.6-sol',
      modelName: 'GPT-5.6 Sol',
      providerApiType: 'new-api',
      providerModels: [
        {
          id: 'gpt-5.6-sol',
          name: 'GPT-5.6 Sol',
          type: ModelType.Chat,
          endpointType: 'openai',
          supportedEndpointTypes: ['openai', 'openai-response'],
          ownedBy: 'openai'
        }
      ],
      modelConfig: {
        endpointType: 'openai',
        reasoning: true,
        reasoningEffort: 'medium',
        verbosity: 'medium'
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'medium',
        effortOptions: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      }
    })

    expect(modelClient.getCapabilities).toHaveBeenCalledTimes(1)
    expect(modelClient.getCapabilities).toHaveBeenCalledWith({
      providerId: 'new-api',
      modelId: 'gpt-5.6-sol',
      reasoningEnabled: true
    })
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.none')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.max')
    expect(wrapper.text()).toContain('settings.model.modelConfig.verbosity.label')

    ;(wrapper.vm as any).config.endpointType = 'openai-response'
    await vi.waitFor(() => expect(modelClient.getCapabilities).toHaveBeenCalledTimes(2))

    expect(modelClient.getCapabilities).toHaveBeenLastCalledWith({
      providerId: 'new-api',
      modelId: 'gpt-5.6-sol',
      routeOverride: {
        endpointType: 'openai-response',
        type: ModelType.Chat
      },
      reasoningEnabled: true
    })
  })

  it('shows effort-based reasoning support as a disabled capability indicator', async () => {
    const { wrapper } = await setup({
      providerId: 'openai',
      modelId: 'gpt-5.4',
      modelName: 'GPT-5.4',
      modelConfig: {
        reasoning: false,
        reasoningEffort: 'xhigh'
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort',
        effort: 'none',
        effortOptions: ['none', 'low', 'medium', 'high', 'xhigh']
      }
    })

    expect((wrapper.vm as any).reasoningToggleMode).toBe('indicator')
    expect((wrapper.vm as any).reasoningToggleDisabled).toBe(true)
    expect((wrapper.vm as any).reasoningToggleValue).toBe(true)
    expect((wrapper.vm as any).reasoningToggleLabelKey).toBe(
      'settings.model.modelConfig.reasoning.label'
    )
    expect((wrapper.vm as any).reasoningToggleDescriptionKey).toBe(
      'settings.model.modelConfig.reasoning.description'
    )
  })

  it('keeps budget-backed reasoning as an explicit enable toggle', async () => {
    const { wrapper } = await setup({
      providerId: 'anthropic',
      modelId: 'claude-4-sonnet',
      modelName: 'Claude 4 Sonnet',
      modelConfig: {
        reasoning: false,
        thinkingBudget: 2048
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'budget',
        budget: {
          min: 1024,
          default: 2048
        }
      }
    })

    expect((wrapper.vm as any).reasoningToggleMode).toBe('toggle')
    expect((wrapper.vm as any).reasoningToggleDisabled).toBe(false)
    expect((wrapper.vm as any).reasoningToggleValue).toBe(false)
    expect((wrapper.vm as any).reasoningToggleLabelKey).toBe(
      'settings.model.modelConfig.reasoningToggle.label'
    )
    expect((wrapper.vm as any).reasoningToggleDescriptionKey).toBe(
      'settings.model.modelConfig.reasoningToggle.description'
    )
  })

  it('treats official anthropic effort portraits as editable toggles with conditional subsettings', async () => {
    const { wrapper } = await setup({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-7',
      modelName: 'Claude Opus 4.7',
      modelConfig: {
        reasoning: false,
        reasoningEffort: 'high',
        reasoningVisibility: undefined
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort',
        effort: 'high',
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
        visibility: 'omitted'
      }
    })

    expect((wrapper.vm as any).reasoningToggleMode).toBe('toggle')
    expect((wrapper.vm as any).reasoningToggleDisabled).toBe(false)
    expect((wrapper.vm as any).showReasoningEffort).toBe(false)
    expect((wrapper.vm as any).showReasoningVisibility).toBe(false)
    expect(wrapper.text()).not.toContain('settings.model.modelConfig.reasoningVisibility.label')

    ;(wrapper.vm as any).config.reasoning = true
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).showReasoningEffort).toBe(true)
    expect((wrapper.vm as any).showReasoningVisibility).toBe(true)
    expect((wrapper.vm as any).config.reasoningVisibility).toBe('omitted')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.max')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningVisibility.label')
    expect(wrapper.text()).toContain(
      'settings.model.modelConfig.reasoningVisibility.options.omitted'
    )
    expect(wrapper.text()).toContain(
      'settings.model.modelConfig.reasoningVisibility.options.summarized'
    )
  })

  it('treats new-api anthropic routes as editable anthropic toggles with conditional subsettings', async () => {
    const { wrapper } = await setup({
      providerId: 'new-api',
      modelId: 'claude-opus-4-7',
      modelName: 'Claude Opus 4.7',
      providerApiType: 'new-api',
      capabilityProviderId: 'anthropic',
      providerModels: [
        {
          id: 'claude-opus-4-7',
          name: 'Claude Opus 4.7',
          supportedEndpointTypes: ['anthropic'],
          endpointType: 'anthropic'
        }
      ],
      modelConfig: {
        endpointType: 'anthropic',
        reasoning: false,
        reasoningEffort: 'high',
        reasoningVisibility: undefined
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort',
        effort: 'high',
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
        visibility: 'omitted'
      }
    })

    expect((wrapper.vm as any).reasoningToggleMode).toBe('toggle')
    expect((wrapper.vm as any).reasoningToggleDisabled).toBe(false)
    expect((wrapper.vm as any).showReasoningEffort).toBe(false)
    expect((wrapper.vm as any).showReasoningVisibility).toBe(false)

    ;(wrapper.vm as any).config.reasoning = true
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).showReasoningEffort).toBe(true)
    expect((wrapper.vm as any).showReasoningVisibility).toBe(true)
    expect((wrapper.vm as any).config.reasoningVisibility).toBe('omitted')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.max')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningVisibility.label')
    expect(wrapper.text()).toContain(
      'settings.model.modelConfig.reasoningVisibility.options.summarized'
    )
  })

  it('treats zenmux anthropic routes as editable anthropic toggles with conditional subsettings', async () => {
    const { wrapper } = await setup({
      providerId: 'zenmux',
      modelId: 'anthropic/claude-opus-4-7',
      modelName: 'Claude Opus 4.7',
      providerApiType: 'openai',
      capabilityProviderId: 'anthropic',
      providerModels: [
        {
          id: 'anthropic/claude-opus-4-7',
          name: 'Claude Opus 4.7'
        }
      ],
      modelConfig: {
        reasoning: false,
        reasoningEffort: 'high',
        reasoningVisibility: undefined
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort',
        effort: 'high',
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
        visibility: 'omitted'
      }
    })

    expect((wrapper.vm as any).reasoningToggleMode).toBe('toggle')
    expect((wrapper.vm as any).showReasoningEffort).toBe(false)
    expect((wrapper.vm as any).showReasoningVisibility).toBe(false)

    ;(wrapper.vm as any).config.reasoning = true
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).showReasoningEffort).toBe(true)
    expect((wrapper.vm as any).showReasoningVisibility).toBe(true)
    expect((wrapper.vm as any).config.reasoningVisibility).toBe('omitted')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningVisibility.label')
  })

  it('keeps anthropic transport relays on provider-local reasoning controls', async () => {
    const { wrapper } = await setup({
      providerId: 'my-anthropic-proxy',
      modelId: 'claude-opus-4-7',
      modelName: 'Claude Opus 4.7',
      providerApiType: 'anthropic',
      providerModels: [
        {
          id: 'claude-opus-4-7',
          name: 'Claude Opus 4.7'
        }
      ],
      modelConfig: {
        reasoning: false,
        reasoningEffort: 'high',
        reasoningVisibility: undefined
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort',
        effort: 'high',
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
        visibility: 'omitted'
      }
    })

    expect((wrapper.vm as any).reasoningToggleMode).toBe('indicator')
    expect((wrapper.vm as any).reasoningToggleDisabled).toBe(true)
    expect((wrapper.vm as any).reasoningToggleValue).toBe(true)
    expect((wrapper.vm as any).showReasoningEffort).toBe(true)
    expect((wrapper.vm as any).showReasoningVisibility).toBe(false)
    expect(wrapper.text()).not.toContain('settings.model.modelConfig.reasoningVisibility.label')
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

  it('keeps model defaults visible when the model capability disables sampling', async () => {
    const { wrapper } = await setup({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-7',
      modelName: 'Claude Opus 4.7',
      temperatureCapability: false,
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort',
        effort: 'high',
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
        visibility: 'omitted'
      }
    })

    expect((wrapper.vm as any).capabilityProviderId).toBe('anthropic')
    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'hidden' })
    expect((wrapper.vm as any).showTemperatureControl).toBe(true)
    expect((wrapper.vm as any).showTopPControl).toBe(true)
    expect((wrapper.vm as any).temperatureSettingReadOnly).toBe(true)
    expect((wrapper.vm as any).topPSettingReadOnly).toBe(true)
    expect(wrapper.find('#temperature').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#topP').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('settings.model.modelConfig.temperature.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.topP.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.maxTokens.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.contextLength.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.timeout.label')
  })

  it('keeps model defaults visible for new-api anthropic routes', async () => {
    const { wrapper } = await setup({
      providerId: 'new-api',
      modelId: 'claude-opus-4-8',
      modelName: 'Claude Opus 4.8',
      providerApiType: 'new-api',
      capabilityProviderId: 'anthropic',
      temperatureCapability: false,
      providerModels: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          endpointType: 'anthropic',
          supportedEndpointTypes: ['openai-response', 'anthropic'],
          type: ModelType.Chat
        }
      ],
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort',
        effort: 'high',
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
        visibility: 'omitted'
      }
    })

    expect((wrapper.vm as any).capabilityProviderId).toBe('anthropic')
    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'hidden' })
    expect((wrapper.vm as any).showTemperatureControl).toBe(true)
    expect((wrapper.vm as any).showTopPControl).toBe(true)
    expect(wrapper.find('#temperature').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#topP').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('settings.model.modelConfig.temperature.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.topP.label')
  })

  it('renders fixed temperature policy without rewriting stored intent', async () => {
    const { wrapper } = await setup({
      providerId: 'moonshot',
      modelId: 'moonshotai/kimi-k2.6:thinking',
      modelName: 'Kimi K2.6 Thinking',
      modelConfig: {
        reasoning: false,
        temperature: 0.6
      },
      requestPolicy: {
        temperature: { mode: 'fixed', value: 1 },
        topP: { mode: 'passthrough' },
        reasoning: { mode: 'fixed', value: true },
        legacyThinking: { mode: 'fixed', value: 'enabled' }
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'budget',
        budget: { min: 0, max: 32768, default: 8192 }
      }
    })

    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'fixed', value: 1 })
    expect((wrapper.vm as any).temperaturePolicyHint).toBe(
      'settings.model.temperatureFixedByPolicy'
    )
    expect((wrapper.vm as any).temperatureInputValue).toBe(1)
    expect((wrapper.vm as any).config.temperature).toBe(0.6)
    expect((wrapper.vm as any).config.reasoning).toBe(false)
    expect((wrapper.vm as any).reasoningToggleMode).toBe('indicator')
    expect((wrapper.vm as any).reasoningToggleValue).toBe(true)
  })

  it('uses fixed policy for proxy-style providers without a provider-specific UI branch', async () => {
    const { wrapper } = await setup({
      providerId: 'new-api',
      providerApiType: 'new-api',
      modelId: 'kimi-k2.6',
      modelName: 'Kimi K2.6',
      modelConfig: {
        reasoning: true,
        temperature: 1.4
      },
      requestPolicy: {
        temperature: { mode: 'fixed', value: 1 },
        topP: { mode: 'passthrough' },
        reasoning: { mode: 'fixed', value: true },
        legacyThinking: { mode: 'fixed', value: 'enabled' }
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'budget',
        budget: { min: 0, max: 32768, default: 8192 }
      }
    })

    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'fixed', value: 1 })
    expect((wrapper.vm as any).temperatureInputValue).toBe(1)
    expect((wrapper.vm as any).config.temperature).toBe(1.4)
  })

  it('locks generic fixed top-p policy without overwriting stored intent', async () => {
    const { wrapper } = await setup({
      providerId: 'proxy',
      modelId: 'fixed-sampling-model',
      modelName: 'Fixed Sampling Model',
      modelConfig: {
        topP: 0.4
      },
      requestPolicy: {
        temperature: { mode: 'passthrough' },
        topP: { mode: 'fixed', value: 0.8 },
        reasoning: { mode: 'passthrough' },
        legacyThinking: { mode: 'passthrough' }
      }
    })

    expect((wrapper.vm as any).topPControl).toEqual({ mode: 'fixed', value: 0.8 })
    expect((wrapper.vm as any).topPInputValue).toBe('0.8')
    expect((wrapper.vm as any).config.topP).toBe(0.4)
    expect((wrapper.vm as any).topPPolicyHint).toBe('settings.model.topPFixedByPolicy')
    expect(wrapper.find('#topP').attributes('disabled')).toBeDefined()
  })

  it('renders K3 request policy without rewriting stored generation intent', async () => {
    const { wrapper, modelConfigStore, modelClient } = await setup({
      providerId: 'new-api',
      providerApiType: 'new-api',
      capabilityProviderId: 'moonshot',
      modelId: 'kimi-k3',
      modelName: 'Kimi K3',
      modelConfig: {
        isUserDefined: true,
        reasoning: false,
        reasoningEffort: 'medium',
        temperature: 0.6,
        topP: 0.8
      },
      temperatureCapability: false,
      requestPolicy: {
        temperature: { mode: 'omit' },
        topP: { mode: 'omit' },
        reasoning: { mode: 'fixed', value: true },
        legacyThinking: { mode: 'omit' }
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'max',
        effortOptions: ['low', 'high', 'max']
      }
    })

    expect((wrapper.vm as any).showTemperatureControl).toBe(true)
    expect((wrapper.vm as any).showTopPControl).toBe(true)
    expect((wrapper.vm as any).temperatureSettingReadOnly).toBe(true)
    expect((wrapper.vm as any).topPSettingReadOnly).toBe(true)
    expect((wrapper.vm as any).reasoningToggleMode).toBe('indicator')
    expect((wrapper.vm as any).reasoningToggleValue).toBe(true)
    expect((wrapper.vm as any).config.reasoning).toBe(false)
    expect((wrapper.vm as any).config.reasoningEffort).toBe('medium')
    expect((wrapper.vm as any).effectiveReasoningEffort).toBe('max')
    expect((wrapper.vm as any).config.temperature).toBe(0.6)
    expect((wrapper.vm as any).config.topP).toBe(0.8)
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.max')
    expect(wrapper.text()).not.toContain(
      'settings.model.modelConfig.reasoningEffort.options.medium'
    )
    expect(modelConfigStore.getModelConfig).toHaveBeenCalledTimes(1)
    expect(modelClient.getCapabilities).toHaveBeenCalledTimes(1)

    await (wrapper.vm as any).handleSave()
    expect(modelConfigStore.setModelConfig).toHaveBeenCalledWith(
      'kimi-k3',
      'new-api',
      expect.objectContaining({
        reasoning: false,
        reasoningEffort: 'medium',
        temperature: 0.6,
        topP: 0.8
      })
    )
  })

  it('shows Aihubmix K3 defaults as read-only when policy omits them', async () => {
    const { wrapper } = await setup({
      providerId: 'aihubmix',
      capabilityProviderId: 'aihubmix',
      modelId: 'kimi-k3',
      modelName: 'Kimi K3',
      requestPolicy: {
        temperature: { mode: 'omit' },
        topP: { mode: 'omit' },
        reasoning: { mode: 'fixed', value: true },
        legacyThinking: { mode: 'omit' }
      },
      temperatureCapability: undefined
    })

    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'hidden' })
    expect((wrapper.vm as any).showTemperatureControl).toBe(true)
    expect((wrapper.vm as any).temperatureSettingReadOnly).toBe(true)
    expect(wrapper.find('#temperature').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('settings.model.modelConfig.temperature.label')
  })

  it('shows temperature for effort models when effective policy permits it', async () => {
    const { wrapper } = await setup({
      providerId: 'custom-effort',
      modelId: 'effort-with-temperature',
      modelName: 'Effort With Temperature',
      temperatureCapability: true,
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'high',
        effortOptions: ['low', 'medium', 'high']
      }
    })

    expect((wrapper.vm as any).supportsReasoningEffort).toBe(true)
    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'editable' })
    expect((wrapper.vm as any).showTemperatureControl).toBe(true)
    expect(wrapper.text()).toContain('settings.model.modelConfig.temperature.label')
  })

  it('keeps model defaults stable and read-only while capability policy loads', async () => {
    const pending = createDeferred<Record<string, unknown>>()
    const options: SetupOptions = {
      providerId: 'aihubmix',
      modelId: 'kimi-k3',
      modelName: 'Kimi K3',
      getCapabilities: () => pending.promise
    }
    const { wrapper } = await setup(options)

    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'loading' })
    expect((wrapper.vm as any).temperatureSettingReadOnly).toBe(true)
    expect(wrapper.find('#temperature').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('settings.model.modelConfig.temperature.label')

    pending.resolve(
      createCapabilityResult({
        ...options,
        requestPolicy: {
          temperature: { mode: 'omit' },
          topP: { mode: 'omit' },
          reasoning: { mode: 'fixed', value: true },
          legacyThinking: { mode: 'omit' }
        }
      })
    )
    await flushPromises()

    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'hidden' })
    expect((wrapper.vm as any).temperatureSettingReadOnly).toBe(true)
    expect(wrapper.find('#temperature').attributes('disabled')).toBeDefined()
  })

  it('keeps model defaults editable when capability resolution fails', async () => {
    const options: SetupOptions = {
      providerId: 'aihubmix',
      modelId: 'kimi-k3',
      modelName: 'Kimi K3',
      isCustomModel: true,
      customModels: [{ id: 'kimi-k3', name: 'Kimi K3' }],
      modelConfig: {
        temperature: 0.6,
        topP: 0.4
      },
      requestPolicy: {
        temperature: { mode: 'omit' },
        topP: { mode: 'omit' },
        reasoning: { mode: 'fixed', value: true },
        legacyThinking: { mode: 'omit' }
      },
      getCapabilities: () => Promise.reject(new Error('ipc unavailable'))
    }
    const { wrapper, modelConfigStore } = await setup(options)

    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'hidden' })
    expect((wrapper.vm as any).topPControl).toEqual({ mode: 'hidden' })
    expect((wrapper.vm as any).capabilityResolutionSettledForCurrentModel).toBe(true)
    expect((wrapper.vm as any).isValid).toBe(true)
    expect((wrapper.vm as any).temperatureSettingReadOnly).toBe(false)
    expect((wrapper.vm as any).topPSettingReadOnly).toBe(false)
    expect(wrapper.text()).toContain('settings.model.modelConfig.temperature.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.topP.label')

    ;(wrapper.vm as any).temperatureInputValue = 0.9
    ;(wrapper.vm as any).topPInputValue = '0.6'
    await (wrapper.vm as any).handleSave()

    expect(modelConfigStore.setModelConfig).toHaveBeenCalledWith(
      'kimi-k3',
      'aihubmix',
      expect.objectContaining({
        temperature: 0.9,
        topP: 0.6
      })
    )

    ;(wrapper.vm as any).modelIdField = 'other-model'
    await nextTick()
    expect((wrapper.vm as any).capabilityResolutionSettledForCurrentModel).toBe(false)
    expect((wrapper.vm as any).isValid).toBe(false)
  })
})

describe('ModelConfigDialog OpenAI image generation settings', () => {
  it('uses the image settings form for gpt-image-2', async () => {
    const { wrapper } = await setup({
      providerId: 'openai',
      modelId: 'gpt-image-2',
      modelName: 'GPT Image 2',
      providerApiType: 'openai',
      modelConfig: {
        imageGeneration: {
          size: '1024x1024'
        }
      }
    })

    expect((wrapper.vm as any).showOpenAIImageGenerationSettings).toBe(true)
    expect(wrapper.text()).toContain('settings.model.modelConfig.imageGeneration.size.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.timeout.label')
    expect(wrapper.text()).not.toContain('settings.model.modelConfig.contextLength.label')
    expect(wrapper.text()).not.toContain('settings.model.modelConfig.maxTokens.label')
    expect(wrapper.text()).not.toContain('settings.model.modelConfig.interleavedThinking.label')
  })

  it('keeps ordinary OpenAI chat models on the generic model form', async () => {
    const { wrapper } = await setup({
      providerId: 'openai',
      modelId: 'gpt-5',
      modelName: 'GPT-5',
      providerApiType: 'openai',
      modelConfig: {
        imageGeneration: {
          size: '1024x1024'
        }
      }
    })

    expect((wrapper.vm as any).showOpenAIImageGenerationSettings).toBe(false)
    expect(wrapper.text()).not.toContain('settings.model.modelConfig.imageGeneration.size.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.contextLength.label')
    expect(wrapper.text()).toContain('settings.model.modelConfig.maxTokens.label')
  })

  it('saves normalized image settings for gpt-image-2', async () => {
    const { wrapper, modelConfigStore } = await setup({
      providerId: 'openai',
      modelId: 'gpt-image-2',
      modelName: 'GPT Image 2',
      providerApiType: 'openai',
      modelConfig: {
        topP: 0.4
      }
    })

    ;(wrapper.vm as any).config.imageGeneration = {
      size: '1792x1024',
      quality: 'high',
      outputFormat: 'jpeg',
      outputCompression: 80,
      background: 'opaque',
      moderation: 'low'
    }
    await (wrapper.vm as any).handleSave()

    expect(modelConfigStore.setModelConfig).toHaveBeenCalledWith(
      'gpt-image-2',
      'openai',
      expect.objectContaining({
        topP: 0.4,
        imageGeneration: {
          size: '1792x1024',
          quality: 'high',
          outputFormat: 'jpeg',
          outputCompression: 80,
          background: 'opaque',
          moderation: 'low'
        }
      })
    )
  })
})

describe('ModelConfigDialog new-api endpoint normalization', () => {
  it('uses selectable endpoint types without mutating supported endpoint types', async () => {
    const { wrapper } = await setup({
      providerId: 'new-api',
      modelId: 'gpt-5.5',
      modelName: 'GPT-5.5',
      providerApiType: 'new-api',
      providerModels: [
        {
          id: 'gpt-5.5',
          name: 'GPT-5.5',
          type: ModelType.Chat,
          supportedEndpointTypes: ['openai'],
          selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
          endpointType: 'openai'
        }
      ],
      modelConfig: {
        endpointType: undefined
      }
    })

    expect((wrapper.vm as any).providerModelMeta.supportedEndpointTypes).toEqual(['openai'])
    expect((wrapper.vm as any).availableEndpointTypes).toEqual([
      'openai',
      'openai-response',
      'anthropic',
      'gemini'
    ])
    expect((wrapper.vm as any).config.endpointType).toBe('openai')
  })

  it('restores chat routing when switching type away from image-generation', async () => {
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
        endpointType: 'image-generation',
        isUserDefined: true
      }
    })

    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Image)
    expect((wrapper.vm as any).config.type).toBe(ModelType.ImageGeneration)

    ;(wrapper.vm as any).config.type = ModelType.Chat
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).availableEndpointTypes).toEqual([
      'openai',
      'openai-response',
      'anthropic',
      'gemini'
    ])
    expect((wrapper.vm as any).config.endpointType).toBe('openai')
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

  it('filters endpoint choices from model type for custom models', async () => {
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

    expect((wrapper.vm as any).availableEndpointTypes).toEqual([
      'openai',
      'openai-response',
      'anthropic',
      'gemini'
    ])

    ;(wrapper.vm as any).config.endpointType = 'image-generation'
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).config.endpointType).toBe('openai')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Chat)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)

    ;(wrapper.vm as any).config.type = ModelType.ImageGeneration
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).availableEndpointTypes).toEqual(['image-generation'])
    expect((wrapper.vm as any).config.endpointType).toBe('image-generation')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Image)
    expect((wrapper.vm as any).config.type).toBe(ModelType.ImageGeneration)

    ;(wrapper.vm as any).config.type = ModelType.Chat
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).availableEndpointTypes).toEqual([
      'openai',
      'openai-response',
      'anthropic',
      'gemini'
    ])
    expect((wrapper.vm as any).config.endpointType).toBe('openai')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Chat)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)

    ;(wrapper.vm as any).modelIdField = 'custom-image-model'
    ;(wrapper.vm as any).modelNameField = 'Custom Image Model'
    ;(wrapper.vm as any).queueCapabilityRefresh()
    await flushPromises()
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

  it('refreshes capability policy after a create-mode model ID is entered', async () => {
    const capabilityRequest = createDeferred<Record<string, unknown>>()
    const options: SetupOptions = {
      providerId: 'new-api',
      modelId: '',
      modelName: '',
      providerApiType: 'new-api',
      mode: 'create',
      getCapabilities: () => capabilityRequest.promise
    }
    const { wrapper, modelClient } = await setup(options)

    ;(wrapper.vm as any).modelIdField = 'kimi-k3'
    await vi.waitFor(() =>
      expect(modelClient.getCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'new-api',
          modelId: 'kimi-k3',
          reasoningEnabled: expect.any(Boolean)
        })
      )
    )
    expect(modelClient.getCapabilities).toHaveBeenCalledTimes(1)

    ;(wrapper.vm as any).queueCapabilityRefreshForIdentityChange()
    await nextTick()
    expect(modelClient.getCapabilities).toHaveBeenCalledTimes(1)

    capabilityRequest.resolve(createCapabilityResult(options, 'kimi-k3'))
    await flushPromises()

    ;(wrapper.vm as any).queueCapabilityRefreshForIdentityChange()
    await nextTick()
    await flushPromises()
    expect(modelClient.getCapabilities).toHaveBeenCalledTimes(1)
  })

  it('resolves capabilities for the edited identity when a custom model is renamed', async () => {
    const { wrapper, modelClient } = await setup({
      providerId: 'new-api',
      modelId: 'old-custom-model',
      modelName: 'Old Custom Model',
      providerApiType: 'new-api',
      isCustomModel: true,
      customModels: [{ id: 'old-custom-model', name: 'Old Custom Model' }]
    })

    ;(wrapper.vm as any).modelIdField = 'renamed-custom-model'
    expect((wrapper.vm as any).capabilitySnapshotMatchesCurrentModel).toBe(false)
    expect((wrapper.vm as any).temperatureControl).toEqual({ mode: 'loading' })
    expect((wrapper.vm as any).isValid).toBe(false)

    await vi.waitFor(() => expect(modelClient.getCapabilities).toHaveBeenCalledTimes(2))

    expect(modelClient.getCapabilities).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerId: 'new-api',
        modelId: 'renamed-custom-model'
      })
    )
    expect((wrapper.vm as any).currentModelLookupId).toBe('renamed-custom-model')
    expect((wrapper.vm as any).capabilitySnapshotMatchesCurrentModel).toBe(true)
  })

  it('does not expose media endpoints for explicit chat models', async () => {
    const { wrapper } = await setup({
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
          selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
          endpointType: 'openai'
        }
      ],
      modelConfig: {
        type: ModelType.Chat,
        endpointType: 'image-generation'
      }
    })

    expect((wrapper.vm as any).availableEndpointTypes).toEqual([
      'openai',
      'openai-response',
      'anthropic',
      'gemini'
    ])
    expect((wrapper.vm as any).config.endpointType).toBe('openai')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Chat)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)
  })

  it('uses provider model type over default chat config for non-user media models', async () => {
    const { wrapper } = await setup({
      providerId: 'new-api',
      modelId: 'media-debug-model',
      modelName: 'Media Debug Model',
      providerApiType: 'new-api',
      providerModels: [
        {
          id: 'media-debug-model',
          name: 'Media Debug Model',
          type: ModelType.ImageGeneration,
          supportedEndpointTypes: ['openai', 'image-generation'],
          selectableEndpointTypes: ['image-generation'],
          endpointType: 'image-generation'
        }
      ],
      modelConfig: {
        type: undefined,
        endpointType: undefined,
        isUserDefined: false
      }
    })

    expect((wrapper.vm as any).effectiveNewApiModelType).toBe(ModelType.ImageGeneration)
    expect((wrapper.vm as any).availableEndpointTypes).toEqual(['image-generation'])
    expect((wrapper.vm as any).config.endpointType).toBe('image-generation')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Image)
    expect((wrapper.vm as any).config.type).toBe(ModelType.ImageGeneration)
  })

  it('uses provider model type when legacy user config has no explicit type', async () => {
    const { wrapper } = await setup({
      providerId: 'new-api',
      modelId: 'media-debug-model',
      modelName: 'Media Debug Model',
      providerApiType: 'new-api',
      providerModels: [
        {
          id: 'media-debug-model',
          name: 'Media Debug Model',
          type: ModelType.ImageGeneration,
          supportedEndpointTypes: ['openai', 'image-generation'],
          selectableEndpointTypes: ['image-generation'],
          endpointType: 'image-generation'
        }
      ],
      modelConfig: {
        type: undefined,
        endpointType: undefined,
        isUserDefined: true
      }
    })

    expect((wrapper.vm as any).effectiveNewApiModelType).toBe(ModelType.ImageGeneration)
    expect((wrapper.vm as any).availableEndpointTypes).toEqual(['image-generation'])
    expect((wrapper.vm as any).config.endpointType).toBe('image-generation')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Image)
    expect((wrapper.vm as any).config.type).toBe(ModelType.ImageGeneration)
  })

  it('keeps explicit user chat type ahead of provider media metadata', async () => {
    const { wrapper } = await setup({
      providerId: 'new-api',
      modelId: 'media-debug-model',
      modelName: 'Media Debug Model',
      providerApiType: 'new-api',
      providerModels: [
        {
          id: 'media-debug-model',
          name: 'Media Debug Model',
          type: ModelType.ImageGeneration,
          supportedEndpointTypes: ['openai', 'image-generation'],
          selectableEndpointTypes: ['image-generation'],
          endpointType: 'image-generation'
        }
      ],
      modelConfig: {
        type: ModelType.Chat,
        endpointType: 'openai',
        isUserDefined: true
      }
    })

    expect((wrapper.vm as any).effectiveNewApiModelType).toBe(ModelType.Chat)
    expect((wrapper.vm as any).availableEndpointTypes).toEqual([
      'openai',
      'openai-response',
      'anthropic',
      'gemini'
    ])
    expect((wrapper.vm as any).config.endpointType).toBe('openai')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Chat)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)
  })

  it('uses the current type after manual type selection for provider-managed chat models', async () => {
    const { wrapper } = await setup({
      providerId: 'new-api',
      modelId: 'gpt-4.1',
      modelName: 'GPT-4.1',
      providerApiType: 'new-api',
      providerModels: [
        {
          id: 'gpt-4.1',
          name: 'GPT-4.1',
          type: ModelType.Chat,
          supportedEndpointTypes: ['openai'],
          selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
          endpointType: 'openai'
        }
      ],
      modelConfig: {
        type: ModelType.Chat,
        endpointType: 'openai',
        isUserDefined: false
      }
    })

    expect((wrapper.vm as any).isLoadingModelConfig).toBe(false)

    ;(wrapper.vm as any).config.type = ModelType.ImageGeneration
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).effectiveNewApiModelType).toBe(ModelType.ImageGeneration)
    expect((wrapper.vm as any).availableEndpointTypes).toEqual(['image-generation'])
    expect((wrapper.vm as any).config.endpointType).toBe('image-generation')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Image)
    expect((wrapper.vm as any).config.type).toBe(ModelType.ImageGeneration)
  })

  it('keeps loading guard active until the latest overlapping load finishes', async () => {
    const firstLoad = createDeferred<Record<string, unknown>>()
    const secondLoad = createDeferred<Record<string, unknown>>()
    const getModelConfig = vi
      .fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)

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
          supportedEndpointTypes: ['openai'],
          selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
          endpointType: 'openai'
        }
      ],
      getModelConfig
    })

    void (wrapper.vm as any).loadConfig()
    await nextTick()

    expect(modelConfigStore.getModelConfig).toHaveBeenCalledTimes(2)
    expect((wrapper.vm as any).isLoadingModelConfig).toBe(true)

    firstLoad.resolve({
      type: ModelType.ImageGeneration,
      endpointType: 'image-generation',
      isUserDefined: true
    })
    await flushPromises()
    await nextTick()

    expect((wrapper.vm as any).isLoadingModelConfig).toBe(true)
    expect((wrapper.vm as any).hasManualModelTypeSelection).toBe(false)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)

    secondLoad.resolve({
      type: ModelType.Chat,
      endpointType: 'openai',
      isUserDefined: true
    })
    await flushPromises()
    await nextTick()

    expect((wrapper.vm as any).isLoadingModelConfig).toBe(false)
    expect((wrapper.vm as any).hasManualModelTypeSelection).toBe(false)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)
    expect((wrapper.vm as any).config.endpointType).toBe('openai')
  })

  it('revalidates endpoint selection when provider metadata changes available endpoints', async () => {
    const { wrapper, modelStore } = await setup({
      providerId: 'new-api',
      modelId: 'media-debug-model',
      modelName: 'Media Debug Model',
      providerApiType: 'new-api',
      providerModels: [
        {
          id: 'media-debug-model',
          name: 'Media Debug Model',
          type: ModelType.ImageGeneration,
          supportedEndpointTypes: ['openai', 'image-generation'],
          selectableEndpointTypes: ['image-generation'],
          endpointType: 'image-generation'
        }
      ],
      modelConfig: {
        type: undefined,
        endpointType: 'image-generation',
        isUserDefined: false
      }
    })

    expect((wrapper.vm as any).availableEndpointTypes).toEqual(['image-generation'])
    expect((wrapper.vm as any).config.endpointType).toBe('image-generation')

    Object.assign(modelStore.allProviderModels[0].models[0], {
      type: ModelType.Chat,
      supportedEndpointTypes: ['openai'],
      selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
      endpointType: 'openai'
    })
    await nextTick()
    await flushPromises()

    expect((wrapper.vm as any).availableEndpointTypes).toEqual([
      'openai',
      'openai-response',
      'anthropic',
      'gemini'
    ])
    expect((wrapper.vm as any).config.endpointType).toBe('openai')
    expect((wrapper.vm as any).config.apiEndpoint).toBe(ApiEndpointType.Chat)
    expect((wrapper.vm as any).config.type).toBe(ModelType.Chat)
  })
})
