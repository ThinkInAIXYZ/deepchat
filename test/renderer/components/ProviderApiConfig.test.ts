import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '../../../src/shared/presenter'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const createInputStub = () =>
  defineComponent({
    name: 'Input',
    inheritAttrs: false,
    props: {
      modelValue: {
        type: [String, Number],
        default: ''
      }
    },
    emits: ['update:modelValue', 'update:model-value'],
    setup(_, { emit }) {
      const handleInput = (event: Event) => {
        const value = (event.target as HTMLInputElement).value
        emit('update:modelValue', value)
        emit('update:model-value', value)
      }

      return {
        handleInput
      }
    },
    template: '<input v-bind="$attrs" :value="modelValue" @input="handleInput" />'
  })

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" type="button" @click="$emit(\'click\')"><slot /></button>'
})

const labelStub = defineComponent({
  name: 'Label',
  inheritAttrs: false,
  template: '<label v-bind="$attrs"><slot /></label>'
})

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'deepseek',
  name: 'DeepSeek',
  apiType: 'openai-compatible',
  apiKey: 'test-key',
  baseUrl: 'https://api.deepseek.com/v1',
  enable: true,
  custom: false,
  ...overrides
})

async function setup(options?: {
  provider?: LLM_PROVIDER
  providerWebsites?: {
    official: string
    apiKey: string
    docs: string
    models: string
    defaultBaseUrl: string
  }
}) {
  vi.resetModules()

  const toast = vi.fn()
  const llmproviderPresenter = {
    getKeyStatus: vi.fn().mockResolvedValue(null),
    refreshModels: vi.fn().mockResolvedValue(undefined)
  }
  const modelCheckStore = {
    openDialog: vi.fn()
  }

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'settings.provider.modifyBaseUrl') return 'Modify'
        if (key === 'settings.provider.baseUrlLockedHint') {
          return 'This provider is pinned to the recommended Base URL.'
        }
        if (key === 'settings.provider.urlPlaceholder') return 'Enter API URL'
        if (key === 'settings.provider.urlFormat') {
          return `Default: ${params?.defaultUrl ?? ''}`
        }
        if (key === 'settings.provider.urlFormatFill') return 'Fill into API URL'
        if (key === 'settings.provider.dialog.baseUrlUnlock.confirm') return 'Continue'
        return key
      }
    })
  }))

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'llmproviderPresenter') return llmproviderPresenter
      throw new Error(`Unexpected presenter: ${name}`)
    }
  }))

  vi.doMock('@/stores/modelCheck', () => ({
    useModelCheckStore: () => modelCheckStore
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({
      toast
    })
  }))

  vi.doMock('@shadcn/components/ui/input', () => ({
    Input: createInputStub()
  }))
  vi.doMock('@shadcn/components/ui/button', () => ({
    Button: buttonStub
  }))
  vi.doMock('@shadcn/components/ui/label', () => ({
    Label: labelStub
  }))
  vi.doMock('@shadcn/components/ui/tooltip', () => ({
    Tooltip: passthrough('Tooltip'),
    TooltipContent: passthrough('TooltipContent'),
    TooltipProvider: passthrough('TooltipProvider'),
    TooltipTrigger: passthrough('TooltipTrigger')
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({
      name: 'Icon',
      template: '<i />'
    })
  }))

  const ProviderApiConfig = (
    await import('../../../src/renderer/settings/components/ProviderApiConfig.vue')
  ).default

  const wrapper = mount(ProviderApiConfig, {
    props: {
      provider: options?.provider ?? createProvider(),
      providerWebsites: options?.providerWebsites ?? {
        official: 'https://example.com',
        apiKey: 'https://example.com/key',
        docs: 'https://example.com/docs',
        models: 'https://example.com/models',
        defaultBaseUrl: 'https://api.deepseek.com/v1'
      }
    },
    global: {
      stubs: {
        GitHubCopilotOAuth: true
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    toast,
    llmproviderPresenter,
    modelCheckStore
  }
}

function findButtonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().trim() === text)
}

describe('ProviderApiConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a locked Base URL display for built-in providers outside the allowlist', async () => {
    const { wrapper, llmproviderPresenter } = await setup()

    expect(wrapper.find('input#deepseek-url').exists()).toBe(false)
    expect(wrapper.text()).toContain('This provider is pinned to the recommended Base URL.')
    expect(findButtonByText(wrapper, 'Modify')).toBeDefined()
    expect(wrapper.html()).not.toContain('Fill into API URL')
    expect(llmproviderPresenter.getKeyStatus).toHaveBeenCalledWith('deepseek')
  })

  it('switches directly into edit mode and hides the modify button', async () => {
    const { wrapper } = await setup()
    const modifyButton = findButtonByText(wrapper, 'Modify')

    expect(modifyButton).toBeDefined()
    await modifyButton!.trigger('click')
    await flushPromises()

    expect(wrapper.find('input#deepseek-url').exists()).toBe(true)
    expect(findButtonByText(wrapper, 'Modify')).toBeUndefined()
  })

  it('preserves the existing save behavior after unlocking', async () => {
    const { wrapper } = await setup()
    const modifyButton = findButtonByText(wrapper, 'Modify')

    expect(modifyButton).toBeDefined()
    await modifyButton!.trigger('click')
    await flushPromises()

    const input = wrapper.get('input#deepseek-url')
    await input.setValue('https://custom.deepseek.com/v1')
    await input.trigger('blur')

    expect(wrapper.emitted('api-host-change')).toEqual([['https://custom.deepseek.com/v1']])
  })

  it('keeps OpenAI Responses editable without the lock prompt', async () => {
    const { wrapper } = await setup({
      provider: createProvider({
        id: 'openai-responses',
        name: 'OpenAI Responses',
        baseUrl: 'https://api.openai.com/v1'
      })
    })

    expect(wrapper.find('input#openai-responses-url').exists()).toBe(true)
    expect(findButtonByText(wrapper, 'Modify')).toBeUndefined()
    expect(wrapper.text()).not.toContain('This provider is pinned to the recommended Base URL.')
  })

  it('keeps custom providers editable by default', async () => {
    const { wrapper } = await setup({
      provider: createProvider({
        id: 'custom-demo',
        name: 'Custom Demo',
        custom: true,
        baseUrl: 'https://custom.example.com/v1'
      })
    })

    expect(wrapper.find('input#custom-demo-url').exists()).toBe(true)
    expect(findButtonByText(wrapper, 'Modify')).toBeUndefined()
  })

  it('shows the metadata sync hint for DB-backed providers and delegates refresh to the presenter', async () => {
    const { wrapper, toast, llmproviderPresenter } = await setup({
      provider: createProvider({
        id: 'doubao',
        name: 'Doubao',
        apiType: 'doubao',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
      })
    })

    expect(wrapper.text()).toContain('settings.provider.refreshModelsWithMetadataHint')

    const refreshButton = findButtonByText(wrapper, 'settings.provider.refreshModels')
    expect(refreshButton).toBeDefined()

    await refreshButton!.trigger('click')
    await flushPromises()

    expect(llmproviderPresenter.refreshModels).toHaveBeenCalledWith('doubao')
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.provider.toast.refreshModelsSuccessTitle',
      description: 'settings.provider.toast.refreshModelsSuccessDescriptionWithMetadata',
      duration: 4000
    })
  })

  it('refreshes only models for non DB-backed providers', async () => {
    const { wrapper, toast, llmproviderPresenter } = await setup()

    expect(wrapper.text()).not.toContain('settings.provider.refreshModelsWithMetadataHint')

    const refreshButton = findButtonByText(wrapper, 'settings.provider.refreshModels')
    expect(refreshButton).toBeDefined()

    await refreshButton!.trigger('click')
    await flushPromises()

    expect(llmproviderPresenter.refreshModels).toHaveBeenCalledWith('deepseek')
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.provider.toast.refreshModelsSuccessTitle',
      description: 'settings.provider.toast.refreshModelsSuccessDescription',
      duration: 4000
    })
  })

  it('shows a destructive toast when metadata-backed refresh fails', async () => {
    const { wrapper, toast, llmproviderPresenter } = await setup({
      provider: createProvider({
        id: 'doubao',
        name: 'Doubao',
        apiType: 'doubao',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
      })
    })
    llmproviderPresenter.refreshModels.mockRejectedValueOnce(new Error('network down'))

    const refreshButton = findButtonByText(wrapper, 'settings.provider.refreshModels')
    expect(refreshButton).toBeDefined()

    await refreshButton!.trigger('click')
    await flushPromises()

    expect(llmproviderPresenter.refreshModels).toHaveBeenCalledWith('doubao')
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.provider.toast.refreshModelsFailedTitle',
      description: 'settings.provider.toast.refreshModelsFailedDescriptionWithMetadata',
      variant: 'destructive',
      duration: 4000
    })
  })
})
