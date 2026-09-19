import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ProviderCustomHeadersEditor from '../../../src/renderer/settings/components/ProviderCustomHeadersEditor.vue'

const monacoMock = vi.hoisted(() => {
  let value = ''
  let changeListener: (() => void) | null = null
  const createEditor = vi.fn(async (_host: HTMLElement, nextValue: string) => {
    value = nextValue
  })
  const updateCode = vi.fn((nextValue: string) => {
    value = nextValue
  })
  const cleanupEditor = vi.fn()
  const focus = vi.fn()
  const onDidChangeModelContent = vi.fn((listener: () => void) => {
    changeListener = listener
    return { dispose: vi.fn() }
  })
  const getValue = vi.fn(() => value)

  return {
    createEditor,
    updateCode,
    cleanupEditor,
    getEditorView: vi.fn(() => ({ onDidChangeModelContent, getValue, focus })),
    setValue(nextValue: string) {
      value = nextValue
      changeListener?.()
    },
    readValue: () => value,
    reset() {
      value = ''
      changeListener = null
      createEditor.mockClear()
      updateCode.mockClear()
      cleanupEditor.mockClear()
      focus.mockClear()
      onDidChangeModelContent.mockClear()
      getValue.mockClear()
    }
  }
})

vi.mock('stream-monaco', () => ({
  useMonaco: () => monacoMock
}))

vi.mock('@/stores/uiSettingsStore', () => ({
  useUiSettingsStore: () => ({ formattedCodeFontFamily: 'JetBrains Mono' })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

const DialogStub = defineComponent({
  name: 'Dialog',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open'],
  template: '<div><slot /></div>'
})

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'DcButton',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const InlineErrorStub = defineComponent({
  name: 'DcInlineError',
  props: {
    error: {
      type: String,
      default: ''
    }
  },
  template: '<p>{{ error }}</p>'
})

const mountEditor = (save = vi.fn().mockResolvedValue({ isOk: true, errorMsg: null })) => {
  monacoMock.reset()
  const wrapper = mount(ProviderCustomHeadersEditor, {
    props: {
      providerId: 'gateway',
      modelValue: { 'X-Tenant-ID': 'team-a' },
      save
    },
    global: {
      stubs: {
        Dialog: DialogStub,
        DialogTrigger: passthrough('DialogTrigger'),
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        DcButton: ButtonStub,
        DcInlineError: InlineErrorStub,
        Spinner: true,
        Icon: true
      }
    }
  })
  return { wrapper, save }
}

describe('ProviderCustomHeadersEditor', () => {
  it('validates the JSON draft and saves a parsed header record', async () => {
    const { wrapper, save } = mountEditor()
    const dialog = wrapper.getComponent(DialogStub)

    dialog.vm.$emit('update:open', true)
    await flushPromises()
    expect(wrapper.get('[data-testid="provider-custom-headers-editor"]').exists()).toBe(true)
    expect(monacoMock.readValue()).toBe('{\n  "X-Tenant-ID": "team-a"\n}')

    monacoMock.setValue('[]')
    await nextTick()
    expect(wrapper.get('[data-testid="provider-custom-headers-save"]').attributes('disabled')).toBe(
      ''
    )

    monacoMock.setValue('{"X-Tenant-ID":"team-b"}')
    await nextTick()
    await wrapper.get('[data-testid="provider-custom-headers-format"]').trigger('click')
    expect(monacoMock.readValue()).toBe('{\n  "X-Tenant-ID": "team-b"\n}')
    expect(
      wrapper.get('[data-testid="provider-custom-headers-save"]').attributes('disabled')
    ).toBeUndefined()
    await wrapper.get('[data-testid="provider-custom-headers-save"]').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({ 'X-Tenant-ID': 'team-b' })
    expect(dialog.props('open')).toBe(false)
  })

  it('discards cancelled edits and keeps failed saves open', async () => {
    const save = vi.fn().mockResolvedValue({ isOk: false, errorMsg: 'Connection failed' })
    const { wrapper } = mountEditor(save)
    const dialog = wrapper.getComponent(DialogStub)

    dialog.vm.$emit('update:open', true)
    await flushPromises()
    monacoMock.setValue('{"X-Tenant-ID":"unsaved"}')
    await nextTick()
    await wrapper.get('[data-testid="provider-custom-headers-cancel"]').trigger('click')
    expect(dialog.props('open')).toBe(false)

    dialog.vm.$emit('update:open', true)
    await flushPromises()
    expect(monacoMock.readValue()).toBe('{\n  "X-Tenant-ID": "team-a"\n}')

    monacoMock.setValue('{"X-Tenant-ID":"team-b"}')
    await nextTick()
    await wrapper.get('[data-testid="provider-custom-headers-save"]').trigger('click')
    await flushPromises()

    expect(dialog.props('open')).toBe(true)
    expect(wrapper.text()).toContain('Connection failed')
  })
})
