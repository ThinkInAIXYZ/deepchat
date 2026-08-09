import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { addCustomProvider } = vi.hoisted(() => ({
  addCustomProvider: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/stores/providerStore', () => ({
  useProviderStore: () => ({ addCustomProvider })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('nanoid', () => ({
  nanoid: () => 'provider-id'
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const selectStub = defineComponent({
  name: 'Select',
  props: {
    modelValue: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  template: `
    <div>
      <button type="button" data-testid="select-ollama" @click="$emit('update:modelValue', 'ollama')">
        Ollama
      </button>
      <slot />
    </div>
  `
})

const switchStub = defineComponent({
  name: 'Switch',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue'],
  template: '<button type="button" role="switch" :aria-checked="modelValue" />'
})

const formActionsStub = defineComponent({
  name: 'DcFormActions',
  emits: ['cancel'],
  template: '<button type="submit">submit</button>'
})

const mountDialog = async () => {
  const AddCustomProviderDialog = (
    await import('../../../src/renderer/settings/components/AddCustomProviderDialog.vue')
  ).default

  const wrapper = mount(AddCustomProviderDialog, {
    props: {
      open: true
    },
    global: {
      stubs: {
        Dialog: passthrough('Dialog'),
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        DcFormActions: formActionsStub,
        Select: selectStub,
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue'),
        Switch: switchStub
      }
    }
  })

  return wrapper
}

describe('AddCustomProviderDialog', () => {
  beforeEach(() => {
    addCustomProvider.mockClear()
  })

  it('shows vee-validate errors and rejects missing required fields', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(wrapper.findAll('[data-slot="form-message"]')).toHaveLength(3)
    })

    expect(addCustomProvider).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('components.promptParamsDialog.required')
  })

  it('allows Ollama without an API key and uses its default base URL', async () => {
    const wrapper = await mountDialog()

    await wrapper.get('[data-testid="select-ollama"]').trigger('click')
    await wrapper.get('input[name="name"]').setValue('Local Ollama')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(addCustomProvider).toHaveBeenCalledOnce()
    })

    expect(addCustomProvider).toHaveBeenCalledWith({
      id: 'provider-id',
      name: 'Local Ollama',
      apiType: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      enable: true
    })
  })
})
