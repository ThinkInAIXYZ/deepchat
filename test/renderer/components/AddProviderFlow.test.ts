import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const inputStub = defineComponent({
  name: 'Input',
  props: {
    modelValue: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

async function setup(options?: {
  validateResult?: {
    isOk: boolean
    errorMsg: string | null
    models: Array<Record<string, unknown>>
  }
  recommendationError?: boolean
}) {
  vi.resetModules()

  const providerStore = {
    validateDraftProvider: vi.fn().mockResolvedValue(
      options?.validateResult ?? {
        isOk: true,
        errorMsg: null,
        models: []
      }
    ),
    commitValidatedDraft: vi.fn().mockResolvedValue(undefined)
  }

  const modelStore = {
    applyInitialModelRecommendations: vi
      .fn()
      .mockImplementation(
        options?.recommendationError
          ? () => Promise.reject(new Error('recommendations failed'))
          : () => Promise.resolve(2)
      )
  }

  const windowClient = {
    focusMainWindow: vi.fn().mockResolvedValue(true)
  }

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@api/WindowClient', () => ({
    createWindowClient: () => windowClient
  }))

  const AddProviderFlow = (
    await import('../../../src/renderer/settings/components/AddProviderFlow.vue')
  ).default

  const wrapper = mount(AddProviderFlow, {
    global: {
      stubs: {
        ScrollArea: passthrough('ScrollArea'),
        Input: inputStub,
        Label: passthrough('Label'),
        Select: passthrough('Select'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: true,
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        Spinner: true,
        Icon: true,
        DcButton: defineComponent({
          name: 'DcButton',
          props: { disabled: { type: Boolean, default: false } },
          emits: ['click'],
          template:
            '<button v-bind="$attrs" type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
        }),
        DcInlineError: defineComponent({
          name: 'DcInlineError',
          props: { error: { type: String, default: '' } },
          template: '<p v-if="error" data-testid="add-provider-error">{{ error }}</p>'
        })
      }
    }
  })

  const fillForm = async () => {
    await wrapper.get('[data-testid="add-provider-name"]').setValue('My Provider')
    await wrapper.get('[data-testid="add-provider-base-url"]').setValue('https://api.example.com')
    await wrapper.get('[data-testid="add-provider-api-key"]').setValue('sk-test')
  }

  return { wrapper, providerStore, modelStore, windowClient, fillForm }
}

describe('AddProviderFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists nothing when validation fails and keeps the editable draft', async () => {
    const { wrapper, providerStore, fillForm } = await setup({
      validateResult: { isOk: false, errorMsg: 'invalid key', models: [] }
    })

    await fillForm()
    await wrapper.get('[data-testid="add-provider-connect"]').trigger('click')
    await flushPromises()

    expect(providerStore.commitValidatedDraft).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="add-provider-error"]').text()).toBe('invalid key')
    expect(
      (wrapper.get('[data-testid="add-provider-name"]').element as HTMLInputElement).value
    ).toBe('My Provider')
  })

  it('commits the draft, applies recommendations, and offers Start chatting', async () => {
    const { wrapper, providerStore, modelStore, windowClient, fillForm } = await setup()

    await fillForm()
    await wrapper.get('[data-testid="add-provider-connect"]').trigger('click')
    await flushPromises()

    expect(providerStore.commitValidatedDraft).toHaveBeenCalledTimes(1)
    const committed = providerStore.commitValidatedDraft.mock.calls[0][0]
    expect(committed.custom).toBe(true)
    expect(modelStore.applyInitialModelRecommendations).toHaveBeenCalledWith(committed.id)

    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.find('[data-testid="add-provider-success"]').exists()).toBe(true)
    // No models loaded → the fallback copy renders instead of "Loaded 0...".
    expect(wrapper.get('[data-testid="add-provider-success-description"]').text()).toBe(
      'settings.provider.addFlow.successNoModels'
    )

    await wrapper.get('[data-testid="add-provider-start-chatting"]').trigger('click')
    await flushPromises()

    expect(windowClient.focusMainWindow).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it('shows the loaded-model summary when models are available', async () => {
    const { wrapper, fillForm } = await setup({
      validateResult: { isOk: true, errorMsg: null, models: [{ id: 'm1' }] }
    })

    await fillForm()
    await wrapper.get('[data-testid="add-provider-connect"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="add-provider-success-description"]').text()).toBe(
      'settings.provider.addFlow.successDescription'
    )
  })

  it('still completes the success flow when model recommendations fail', async () => {
    const { wrapper, providerStore, modelStore, fillForm } = await setup({
      recommendationError: true
    })

    await fillForm()
    await wrapper.get('[data-testid="add-provider-connect"]').trigger('click')
    await flushPromises()

    // The provider was already persisted, so a recommendation failure must not
    // roll the flow back to an error state.
    expect(providerStore.commitValidatedDraft).toHaveBeenCalledTimes(1)
    expect(modelStore.applyInitialModelRecommendations).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="add-provider-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="add-provider-success"]').exists()).toBe(true)
  })
})
