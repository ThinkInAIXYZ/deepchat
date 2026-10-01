import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, inject, provide } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '@shared/types/provider'

const dialogKey = Symbol('dialog')

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const inputStub = defineComponent({
  name: 'Input',
  inheritAttrs: false,
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    }
  },
  emits: ['update:modelValue'],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
})

const copyButtonStub = defineComponent({
  name: 'CopyButton',
  inheritAttrs: false,
  props: {
    copyText: {
      type: String,
      default: ''
    }
  },
  template: '<button v-bind="$attrs" type="button"><slot /></button>'
})

const dialogStub = defineComponent({
  name: 'Dialog',
  props: {
    open: Boolean
  },
  emits: ['update:open'],
  setup(props, { emit }) {
    provide(dialogKey, {
      open: computed(() => props.open),
      setOpen: (open: boolean) => emit('update:open', open)
    })
  },
  template: '<div><slot /></div>'
})

const dialogTriggerStub = defineComponent({
  name: 'DialogTrigger',
  setup() {
    return { dialog: inject(dialogKey) }
  },
  template: '<div @click="dialog.setOpen(true)"><slot /></div>'
})

const dialogContentStub = defineComponent({
  name: 'DialogContent',
  inheritAttrs: false,
  setup() {
    return { dialog: inject(dialogKey) }
  },
  template:
    '<div v-if="dialog.open.value" v-bind="$attrs"><button data-testid="dialog-dismiss" type="button" @click="dialog.setOpen(false)">dismiss</button><slot /></div>'
})

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'deepseek',
  name: 'DeepSeek',
  apiType: 'openai-compatible',
  apiKey: 'stored-fake-key',
  baseUrl: 'https://api.deepseek.com/v1',
  enable: true,
  custom: false,
  ...overrides
})

async function setup(provider = createProvider()) {
  vi.resetModules()

  const providerClient = {
    getKeyStatus: vi.fn().mockResolvedValue(null)
  }
  const modelCheckStore = {
    openDialog: vi.fn()
  }
  let wrapper: ReturnType<typeof mount>
  const save = vi.fn(async (_id: string, updates: { apiKey: string; baseUrl: string }) => {
    await wrapper.setProps({ provider: { ...wrapper.props('provider'), ...updates } })
  })

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        key === 'settings.provider.urlFormat' ? `Default: ${params?.defaultUrl ?? ''}` : key
    })
  }))
  vi.doMock('@api/ProviderClient', () => ({
    createProviderClient: () => providerClient
  }))
  vi.doMock('@/stores/modelCheck', () => ({
    useModelCheckStore: () => modelCheckStore
  }))
  vi.doMock('@shadcn/components/ui/input', () => ({ Input: inputStub }))
  vi.doMock('@dc-ui/components/button', () => ({
    DcButton: buttonStub,
    DcCopyButton: copyButtonStub
  }))
  vi.doMock('@dc-ui/components/inline-error', () => ({
    DcInlineError: defineComponent({
      name: 'DcInlineError',
      inheritAttrs: false,
      props: { error: String },
      template: '<p v-bind="$attrs" role="alert">{{ error }}</p>'
    })
  }))
  vi.doMock('@shadcn/components/ui/label', () => ({
    Label: defineComponent({
      name: 'Label',
      inheritAttrs: false,
      template: '<label v-bind="$attrs"><slot /></label>'
    })
  }))
  vi.doMock('@shadcn/components/ui/dialog', () => ({
    Dialog: dialogStub,
    DialogContent: dialogContentStub,
    DialogDescription: passthrough('DialogDescription'),
    DialogFooter: passthrough('DialogFooter'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle'),
    DialogTrigger: dialogTriggerStub
  }))
  vi.doMock('@shadcn/components/ui/spinner', () => ({ Spinner: passthrough('Spinner') }))
  vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

  const ProviderApiConfig = (
    await import('../../../src/renderer/settings/components/ProviderApiConfig.vue')
  ).default

  wrapper = mount(ProviderApiConfig, {
    props: {
      provider,
      save,
      providerWebsites: {
        official: 'https://example.com',
        apiKey: 'https://example.com/key',
        docs: 'https://example.com/docs',
        models: 'https://example.com/models',
        defaultBaseUrl: 'https://api.deepseek.com/v1'
      }
    },
    global: {
      stubs: {
        GitHubCopilotOAuth: true,
        OpenAICodexOAuth: true,
        GrokOAuth: true
      }
    }
  })
  await flushPromises()

  return { wrapper, providerClient, modelCheckStore, save }
}

async function openEditor(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid="provider-connection-edit"]').trigger('click')
  await flushPromises()
}

describe('ProviderApiConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows saved URL and masked key summaries, with editable fields only in the dialog', async () => {
    const { wrapper } = await setup()

    expect(wrapper.get('[data-testid="provider-url-summary"]').text()).toBe(
      'https://api.deepseek.com/v1'
    )
    expect(wrapper.get('[data-testid="provider-api-key-summary"]').text()).toContain('••••••••-key')
    expect(wrapper.text()).not.toContain('stored-fake-key')
    expect(wrapper.findComponent(copyButtonStub).props('copyText')).toBe('stored-fake-key')
    expect(wrapper.find('[data-testid="provider-api-url-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="provider-api-key-input"]').exists()).toBe(false)

    await openEditor(wrapper)
    expect(wrapper.get('[data-testid="provider-api-url-input"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-api-key-input"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-current-key"]').text()).toBe('••••••••-key')
  })

  it('trims and saves a replacement key and URL together', async () => {
    const { wrapper, save } = await setup()
    await openEditor(wrapper)
    await wrapper.get('[data-testid="provider-api-url-input"]').setValue(' https://new.example/v1 ')
    await wrapper.get('[data-testid="provider-api-key-input"]').setValue(' replacement-fake-key ')
    await wrapper.get('[data-testid="provider-api-key-input"]').trigger('blur')
    expect(save).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(save).toHaveBeenCalledExactlyOnceWith('deepseek', {
      apiKey: 'replacement-fake-key',
      baseUrl: 'https://new.example/v1'
    })
    expect(wrapper.find('[data-testid="provider-connection-dialog"]').exists()).toBe(false)
  })

  it('preserves the stored key when saving only a changed URL', async () => {
    const { wrapper, save } = await setup()
    await openEditor(wrapper)
    await wrapper.get('[data-testid="provider-api-url-input"]').setValue('https://other.example/v1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(save).toHaveBeenCalledWith('deepseek', {
      apiKey: 'stored-fake-key',
      baseUrl: 'https://other.example/v1'
    })
  })

  it('blocks controls and dismissal while a save is pending', async () => {
    const { wrapper, save } = await setup()
    let finish!: () => void
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    await openEditor(wrapper)
    await wrapper
      .get('[data-testid="provider-api-url-input"]')
      .setValue('https://pending.example/v1')
    await wrapper.get('form').trigger('submit')

    expect(
      wrapper.get('[data-testid="provider-api-url-input"]').attributes('disabled')
    ).toBeDefined()
    expect(
      wrapper.get('[data-testid="provider-connection-cancel"]').attributes('disabled')
    ).toBeDefined()
    await wrapper.get('[data-testid="dialog-dismiss"]').trigger('click')
    expect(wrapper.find('[data-testid="provider-connection-dialog"]').exists()).toBe(true)

    finish()
    await flushPromises()
    expect(wrapper.find('[data-testid="provider-connection-dialog"]').exists()).toBe(false)
  })

  it('retains a failed draft and shows only a generic redacted error', async () => {
    const { wrapper, save } = await setup()
    save.mockRejectedValueOnce(new Error('write failed: replacement-fake-key'))
    await openEditor(wrapper)
    await wrapper.get('[data-testid="provider-api-key-input"]').setValue('replacement-fake-key')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-testid="provider-connection-error"]').text()).toBe(
      'settings.deepchatAgents.saveFeedback.saveFailed'
    )
    expect(wrapper.text()).not.toContain('write failed')
    expect(
      (wrapper.get('[data-testid="provider-api-key-input"]').element as HTMLInputElement).value
    ).toBe('replacement-fake-key')
  })

  it('discards drafts on cancel and controlled dismissal before reopening', async () => {
    const { wrapper, save } = await setup()
    await openEditor(wrapper)
    await wrapper.get('[data-testid="provider-api-url-input"]').setValue('https://draft.example/v1')
    await wrapper.get('[data-testid="provider-connection-cancel"]').trigger('click')
    await openEditor(wrapper)
    expect(
      (wrapper.get('[data-testid="provider-api-url-input"]').element as HTMLInputElement).value
    ).toBe('https://api.deepseek.com/v1')

    await wrapper.get('[data-testid="provider-api-key-input"]').setValue('discard-fake-key')
    await wrapper.get('[data-testid="dialog-dismiss"]').trigger('click')
    await openEditor(wrapper)
    expect(
      (wrapper.get('[data-testid="provider-api-key-input"]').element as HTMLInputElement).value
    ).toBe('')
    expect(save).not.toHaveBeenCalled()
  })

  it('switches OpenAI between API key and ChatGPT OAuth modes', async () => {
    const provider = createProvider({ id: 'openai', apiType: 'openai' })
    const { wrapper } = await setup(provider)

    await wrapper.get('[data-testid="openai-chatgpt-mode-button"]').trigger('click')
    expect(wrapper.emitted('auth-mode-change')?.[0]).toEqual(['chatgpt'])
    await wrapper.setProps({ provider: { ...provider, openaiAuthMode: 'chatgpt' } })
    expect(wrapper.find('[data-testid="provider-api-key-summary"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'OpenAICodexOAuth' }).exists()).toBe(true)
  })

  it('uses OAuth without generic key controls for Codex and Copilot', async () => {
    for (const provider of [
      createProvider({ id: 'openai-codex', apiType: 'openai-codex', apiKey: '' }),
      createProvider({ id: 'github-copilot', apiType: 'github-copilot', apiKey: '' })
    ]) {
      const { wrapper } = await setup(provider)
      expect(wrapper.find('[data-testid="provider-api-key-summary"]').exists()).toBe(false)
      await openEditor(wrapper)
      expect(wrapper.find('[data-testid="provider-api-key-input"]').exists()).toBe(false)
      wrapper.unmount()
    }
  })

  it('shows Grok OAuth only for xAI endpoints while retaining the API key fallback', async () => {
    const { wrapper } = await setup(
      createProvider({ id: 'grok', apiType: 'grok', baseUrl: 'https://api.x.ai/v1' })
    )
    expect(wrapper.findComponent({ name: 'GrokOAuth' }).exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-api-key-summary"]').exists()).toBe(true)

    await wrapper.setProps({
      provider: { ...wrapper.props('provider'), baseUrl: 'https://compatible.example/v1' }
    })
    expect(wrapper.findComponent({ name: 'GrokOAuth' }).exists()).toBe(false)
  })

  it('redacts key-status failures and clears them after credentials change', async () => {
    const { wrapper, providerClient } = await setup(createProvider({ apiKey: '' }))
    providerClient.getKeyStatus.mockRejectedValueOnce(
      new Error("Error invoking remote method 'route': Error: 401 invalid secret-fake-key")
    )
    await wrapper.setProps({ provider: createProvider({ apiKey: 'secret-fake-key' }) })
    await flushPromises()

    expect(wrapper.get('[data-testid="provider-key-status-error"]').text()).toContain('401')
    expect(wrapper.text()).not.toContain('secret-fake-key')
    expect(wrapper.text()).not.toContain('invoking remote method')

    providerClient.getKeyStatus.mockResolvedValueOnce({ usage: '$1' })
    await wrapper.setProps({ provider: createProvider({ apiKey: 'other-fake-key' }) })
    await flushPromises()
    expect(wrapper.find('[data-testid="provider-key-status-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('$1')
  })

  it('ignores stale key-status failures and results', async () => {
    const { wrapper, providerClient } = await setup(createProvider({ apiKey: '' }))
    let rejectOld!: (error: Error) => void
    providerClient.getKeyStatus.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject
        })
    )
    await wrapper.setProps({ provider: createProvider({ apiKey: 'old-fake-key' }) })
    await wrapper.setProps({ provider: createProvider({ id: 'openai', apiKey: 'new-fake-key' }) })
    rejectOld(new Error('401 old-fake-key'))
    await flushPromises()
    expect(wrapper.find('[data-testid="provider-key-status-error"]').exists()).toBe(false)

    let resolveOld!: (status: { usage: string }) => void
    providerClient.getKeyStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    await wrapper.setProps({ provider: createProvider({ apiKey: 'another-fake-key' }) })
    await wrapper.setProps({ provider: createProvider({ apiKey: '' }) })
    resolveOld({ usage: '$999' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('$999')
  })

  it('opens provider verification only while the saved configuration is available', async () => {
    const { wrapper, modelCheckStore } = await setup()
    await wrapper.get('[data-testid="provider-verify-button"]').trigger('click')
    expect(modelCheckStore.openDialog).toHaveBeenCalledWith('deepseek')

    await openEditor(wrapper)
    expect(
      wrapper.get('[data-testid="provider-verify-button"]').attributes('disabled')
    ).toBeDefined()
    await wrapper.get('[data-testid="provider-connection-cancel"]').trigger('click')
    await wrapper.setProps({ provider: { ...wrapper.props('provider'), enable: false } })
    modelCheckStore.openDialog.mockClear()
    await wrapper.get('[data-testid="provider-verify-button"]').trigger('click')
    expect(modelCheckStore.openDialog).not.toHaveBeenCalled()
  })

  it('preserves the AMD Token Factory hint and attributed key link', async () => {
    const { wrapper } = await setup(createProvider({ id: 'amd-developer' }))
    const tokenFactoryUrl = 'https://developer.amd.com.cn/radeon/tokenfactory?source=deepchat'
    await wrapper.setProps({
      providerWebsites: { ...wrapper.props('providerWebsites'), apiKey: tokenFactoryUrl }
    })
    expect(wrapper.get('[data-testid="amd-developer-hint"]').text()).toBe(
      'settings.provider.amdDeveloperHint'
    )
    expect(wrapper.get(`a[href="${tokenFactoryUrl}"]`).attributes('target')).toBe('_blank')
  })
})
