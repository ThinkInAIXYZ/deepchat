import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const TEST_TIMEOUT_MS = 20000

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const draggableStub = defineComponent({
  name: 'draggable',
  props: {
    modelValue: {
      type: Array,
      default: () => []
    },
    itemKey: {
      type: String,
      default: 'id'
    }
  },
  template:
    '<div><slot v-for="element in modelValue" name="item" :element="element" :key="element[itemKey] ?? element.id" /></div>'
})

const waitForGuideTargetSync = async () => {
  await flushPromises()
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }

    resolve()
  })
  await flushPromises()
}

const setup = async (options?: {
  routeProviderId?: string | undefined
  guideCurrentStepId?: string | null
  visibleGuideStepId?: string | null
  initialProviderModels?: Array<{
    providerId: string
    models: Array<{ id: string; enabled?: boolean }>
  }>
  providers?: Array<{
    id: string
    name: string
    apiType: string
    apiKey: string
    baseUrl: string
    enable: boolean
  }>
}) => {
  vi.resetModules()
  const routeProviderId =
    options && 'routeProviderId' in options ? options.routeProviderId : 'anthropic'
  const guideCurrentStepId = options?.guideCurrentStepId ?? null
  const visibleGuideStepId = options?.visibleGuideStepId ?? null
  const route = reactive({
    params: {
      providerId: routeProviderId
    }
  })

  const provider = {
    id: 'anthropic',
    name: 'Anthropic',
    apiType: 'anthropic',
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com',
    enable: true
  }
  const providers = options?.providers ?? [provider]
  const providerStore = reactive({
    providers,
    sortedProviders: providers,
    initialized: ref(true),
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
    refreshProviders: vi.fn().mockResolvedValue(undefined),
    updateProviderConfig: vi.fn().mockResolvedValue(undefined),
    updateProviderApi: vi.fn().mockResolvedValue(undefined),
    updateProviderStatus: vi.fn().mockResolvedValue(undefined),
    addCustomProvider: vi.fn().mockResolvedValue(undefined),
    updateProvidersOrder: vi.fn(),
    defaultProviders: []
  })

  const modelStore = reactive({
    allProviderModels: options?.initialProviderModels ?? [
      {
        providerId: 'anthropic',
        models: [{ id: 'claude-sonnet', providerId: 'anthropic', enabled: false }]
      }
    ],
    customModels: [],
    refreshAllModels: vi.fn().mockResolvedValue(undefined),
    refreshProviderModels: vi.fn().mockResolvedValue(undefined),
    ensureProviderModelsReady: vi.fn().mockResolvedValue(undefined)
  })

  const router = {
    push: vi.fn(async ({ params }: { params?: Record<string, string> }) => {
      route.params.providerId = params?.providerId
    }),
    replace: vi.fn()
  }
  const completeStep = vi.fn().mockResolvedValue({
    status: 'active',
    currentStepId: 'mcp',
    steps: []
  })
  const stepState =
    guideCurrentStepId === 'provider-model'
      ? { id: 'provider-model', status: 'pending', required: false }
      : guideCurrentStepId === 'provider-api-key'
        ? { id: 'provider-api-key', status: 'pending', required: false }
        : guideCurrentStepId === 'select-provider'
          ? { id: 'select-provider', status: 'pending', required: true }
          : { id: 'provider-api-key', status: 'completed', required: false }

  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => ({ isDark: false })
  }))
  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({ dir: 'ltr' })
  }))
  vi.doMock('@/composables/useGuidedOnboardingStep', () => ({
    useGuidedOnboardingStep: (stepId: string) => ({
      onboardingState: ref(null),
      currentStepId: ref(guideCurrentStepId),
      stepState: ref(stepId === guideCurrentStepId ? stepState : null),
      showGuide: ref(stepId === visibleGuideStepId),
      stepIndex: ref(1),
      totalSteps: ref(6),
      canGoPrevious: ref(true),
      dismissGuide: vi.fn(),
      completeStep,
      skipStep: vi.fn().mockResolvedValue(null),
      activatePreviousStep: vi.fn().mockResolvedValue(null),
      forceComplete: vi.fn().mockResolvedValue(null)
    })
  }))
  vi.doMock('@api/WindowClient', () => ({
    createWindowClient: () => ({
      focusMainWindow: vi.fn().mockResolvedValue(true)
    })
  }))
  vi.doMock('../../../src/renderer/settings/components/ModelProviderSettingsDetail.vue', () => ({
    default: defineComponent({
      name: 'ModelProviderSettingsDetail',
      props: {
        provider: {
          type: Object,
          required: true
        }
      },
      emits: ['provider-configured', 'provider-model-enabled'],
      setup(props) {
        const providerModels = computed(
          () =>
            modelStore.allProviderModels.find(
              (entry: { providerId: string }) => entry.providerId === props.provider.id
            )?.models ?? []
        )

        return {
          providerModels
        }
      },
      template: `
        <div data-testid="generic-detail">
          <button data-testid="generic-detail-complete" @click="$emit('provider-configured')">
            complete
          </button>
          <button data-testid="provider-models-tab-trigger" type="button">models</button>
          <button
            v-for="model in providerModels"
            :key="model.id"
            :data-testid="'provider-model-toggle-' + provider.id + '-' + model.id"
            type="button"
            @click="$emit('provider-model-enabled')"
          >
            {{ model.id }}
          </button>
        </div>
      `
    })
  }))
  vi.doMock('../../../src/renderer/settings/components/OllamaProviderSettingsDetail.vue', () => ({
    default: defineComponent({
      name: 'OllamaProviderSettingsDetail',
      props: {
        provider: {
          type: Object,
          required: true
        }
      },
      emits: ['provider-configured', 'provider-model-enabled'],
      setup(props) {
        return {
          provider: props.provider
        }
      },
      template: `
        <div data-testid="ollama-detail">
          <input data-testid="provider-api-key-input" />
          <button data-testid="ollama-detail-complete" type="button" @click="$emit('provider-configured')">
            complete
          </button>
          <button
            :data-testid="'provider-model-toggle-' + provider.id + '-deepseek-r1'"
            type="button"
            @click="$emit('provider-model-enabled')"
          >
            model
          </button>
        </div>
      `
    })
  }))
  vi.doMock('../../../src/renderer/settings/components/BedrockProviderSettingsDetail.vue', () => ({
    default: defineComponent({
      name: 'BedrockProviderSettingsDetail',
      template: '<div data-testid="bedrock-detail" />'
    })
  }))
  vi.doMock('../../../src/renderer/settings/components/AddCustomProviderDialog.vue', () => ({
    default: defineComponent({
      name: 'AddCustomProviderDialog',
      template: '<div />'
    })
  }))
  vi.doMock('@/components/icons/ModelIcon.vue', () => ({
    default: defineComponent({
      name: 'ModelIcon',
      template: '<div />'
    })
  }))
  vi.doMock('vue-router', () => ({
    useRoute: () => route,
    useRouter: () => router
  }))
  vi.doMock('@vueuse/core', () => ({
    refDebounced: (value: unknown) => value,
    reactiveOmit: (value: Record<string, unknown>) => value
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const ModelProviderSettings = (
    await import('../../../src/renderer/settings/components/ModelProviderSettings.vue')
  ).default

  const wrapper = mount(ModelProviderSettings, {
    attachTo: document.body,
    global: {
      stubs: {
        ScrollArea: passthrough('ScrollArea'),
        Input: passthrough('Input'),
        Button: passthrough('Button'),
        Badge: passthrough('Badge'),
        Switch: passthrough('Switch'),
        GuidedOnboardingOverlay: defineComponent({
          name: 'GuidedOnboardingOverlay',
          props: {
            visible: {
              type: Boolean,
              default: false
            },
            targetEl: {
              type: Object,
              default: null
            }
          },
          setup(props) {
            const getTargetTestId = () =>
              (props.targetEl as HTMLElement | null)?.getAttribute('data-testid') ?? ''

            return {
              getTargetTestId
            }
          },
          template:
            '<div v-if="visible" data-testid="guided-overlay" :data-target-testid="getTargetTestId()"></div>'
        }),
        Icon: true,
        draggable: draggableStub,
        AnthropicProviderSettingsDetail: defineComponent({
          name: 'AnthropicProviderSettingsDetail',
          template: '<div data-testid="anthropic-detail" />'
        })
      }
    }
  })

  await waitForGuideTargetSync()

  return { wrapper, router, completeStep, modelStore }
}

describe('ModelProviderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it(
    'renders the generic provider settings detail for anthropic',
    async () => {
      const { wrapper } = await setup()

      expect(wrapper.find('[data-testid="generic-detail"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="anthropic-detail"]').exists()).toBe(false)
    },
    TEST_TIMEOUT_MS
  )

  it('navigates to the selected provider when a provider row is clicked', async () => {
    const { wrapper, router } = await setup()

    await wrapper.get('[data-provider-id="anthropic"]').trigger('click')

    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-provider',
      params: {
        providerId: 'anthropic'
      }
    })
  })

  it('auto-continues onboarding when the highlighted provider row is clicked', async () => {
    const { wrapper, router, completeStep } = await setup({
      guideCurrentStepId: 'select-provider',
      visibleGuideStepId: 'select-provider'
    })

    await wrapper.get('[data-provider-id="anthropic"]').trigger('click')
    await flushPromises()

    expect(completeStep).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenNthCalledWith(1, {
      name: 'settings-provider',
      params: {
        providerId: 'anthropic'
      }
    })
    expect(router.push).toHaveBeenNthCalledWith(2, {
      name: 'settings-mcp'
    })
  })

  it(
    'skips ACP when auto-selecting the default provider settings view',
    async () => {
      const { router } = await setup({
        routeProviderId: undefined,
        providers: [
          {
            id: 'acp',
            name: 'ACP',
            apiType: 'openai',
            apiKey: '',
            baseUrl: '',
            enable: true
          },
          {
            id: 'anthropic',
            name: 'Anthropic',
            apiType: 'anthropic',
            apiKey: 'test-key',
            baseUrl: 'https://api.anthropic.com',
            enable: true
          }
        ]
      })

      expect(router.push).toHaveBeenCalledWith({
        name: 'settings-provider',
        params: {
          providerId: 'anthropic'
        }
      })
      expect(router.replace).not.toHaveBeenCalledWith({ name: 'settings-acp' })
    },
    TEST_TIMEOUT_MS
  )

  it('auto-continues onboarding after the provider is configured', async () => {
    const { wrapper, router, completeStep } = await setup({
      guideCurrentStepId: 'provider-api-key'
    })

    await wrapper.get('[data-testid="generic-detail-complete"]').trigger('click')
    await flushPromises()

    expect(completeStep).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-mcp'
    })
  })

  it('auto-continues onboarding when the ollama provider is configured', async () => {
    const { wrapper, router, completeStep } = await setup({
      routeProviderId: 'ollama',
      guideCurrentStepId: 'provider-api-key',
      visibleGuideStepId: 'provider-api-key',
      providers: [
        {
          id: 'ollama',
          name: 'Ollama',
          apiType: 'ollama',
          apiKey: 'test-key',
          baseUrl: 'http://127.0.0.1:11434',
          enable: true
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          apiType: 'anthropic',
          apiKey: 'test-key',
          baseUrl: 'https://api.anthropic.com',
          enable: true
        }
      ],
      initialProviderModels: [
        {
          providerId: 'ollama',
          models: [{ id: 'deepseek-r1', providerId: 'ollama', enabled: false }]
        }
      ]
    })

    expect(wrapper.get('[data-testid="guided-overlay"]').attributes('data-target-testid')).toBe(
      'provider-api-key-input'
    )

    await wrapper.get('[data-testid="ollama-detail-complete"]').trigger('click')
    await flushPromises()

    expect(completeStep).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-mcp'
    })
  })

  it('ignores provider configured events when another onboarding step is active', async () => {
    const { wrapper, router, completeStep } = await setup({
      guideCurrentStepId: 'mcp'
    })

    await wrapper.get('[data-testid="generic-detail-complete"]').trigger('click')
    await flushPromises()

    expect(completeStep).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalledWith({
      name: 'settings-mcp'
    })
  })

  it('auto-continues onboarding when a model is enabled during the provider-model step', async () => {
    const { wrapper, router, completeStep } = await setup({
      guideCurrentStepId: 'provider-model',
      visibleGuideStepId: 'provider-model'
    })

    await wrapper
      .get('[data-testid="provider-model-toggle-anthropic-claude-sonnet"]')
      .trigger('click')
    await flushPromises()

    expect(completeStep).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith({
      name: 'settings-mcp'
    })
  })

  it('retargets the provider-model guide to the first model toggle after models load', async () => {
    const { wrapper, modelStore } = await setup({
      guideCurrentStepId: 'provider-model',
      visibleGuideStepId: 'provider-model',
      initialProviderModels: [
        {
          providerId: 'anthropic',
          models: []
        }
      ]
    })

    expect(wrapper.get('[data-testid="guided-overlay"]').attributes('data-target-testid')).toBe(
      'provider-models-tab-trigger'
    )

    modelStore.allProviderModels = [
      {
        providerId: 'anthropic',
        models: [{ id: 'claude-sonnet', providerId: 'anthropic', enabled: false }]
      }
    ]

    await waitForGuideTargetSync()

    expect(wrapper.get('[data-testid="guided-overlay"]').attributes('data-target-testid')).toBe(
      'provider-model-toggle-anthropic-claude-sonnet'
    )
  })

  it('retargets the provider-model guide when the toggle mounts after the initial render', async () => {
    const { wrapper } = await setup({
      guideCurrentStepId: 'provider-model',
      visibleGuideStepId: 'provider-model',
      initialProviderModels: [
        {
          providerId: 'anthropic',
          models: []
        }
      ]
    })

    expect(wrapper.get('[data-testid="guided-overlay"]').attributes('data-target-testid')).toBe(
      'provider-models-tab-trigger'
    )

    const delayedToggle = document.createElement('button')
    delayedToggle.setAttribute('data-testid', 'provider-model-toggle-anthropic-claude-sonnet')
    wrapper.get('[data-testid="generic-detail"]').element.appendChild(delayedToggle)

    await waitForGuideTargetSync()

    expect(wrapper.get('[data-testid="guided-overlay"]').attributes('data-target-testid')).toBe(
      'provider-model-toggle-anthropic-claude-sonnet'
    )
  })
})
