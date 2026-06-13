import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    props: {
      open: { type: Boolean, default: false }
    },
    template: '<div><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const InputStub = defineComponent({
  name: 'Input',
  props: {
    modelValue: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const TextareaStub = defineComponent({
  name: 'Textarea',
  props: {
    modelValue: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  template:
    '<textarea v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const CheckboxStub = defineComponent({
  name: 'Checkbox',
  props: {
    checked: { type: Boolean, default: false }
  },
  emits: ['update:checked'],
  template:
    '<button type="button" :data-checked="String(checked)" @click="$emit(\'update:checked\', !checked)"><slot /></button>'
})

const fileClient = vi.hoisted(() => ({
  getPathForFile: vi.fn(),
  getMimeType: vi.fn(),
  prepareFile: vi.fn()
}))

vi.mock('@api/FileClient', () => ({
  createFileClient: () => fileClient
}))
vi.mock('nanoid', () => ({
  nanoid: () => 'file-id'
}))
vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    template: '<span />'
  }
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count !== undefined ? `${key}:${params.count}` : key
  })
}))
vi.mock('@/components/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}))

describe('PromptEditorSheet', () => {
  it('uploads prompt attachments through FileClient before submit', async () => {
    vi.resetModules()
    fileClient.getPathForFile.mockReset().mockReturnValue('/tmp/guide.md')
    fileClient.getMimeType.mockReset().mockResolvedValue('text/markdown')
    fileClient.prepareFile.mockReset().mockResolvedValue({
      name: 'guide.md',
      path: '/tmp/guide.md',
      type: 'text',
      mimeType: 'text/markdown',
      content: '# Guide',
      metadata: {
        fileSize: 42,
        fileDescription: 'Guide file'
      }
    })

    const PromptEditorSheet = (
      await import('../../../src/renderer/settings/components/prompt/PromptEditorSheet.vue')
    ).default
    const wrapper = mount(PromptEditorSheet, {
      props: {
        open: true,
        prompt: null
      },
      global: {
        stubs: {
          Sheet: passthrough('Sheet'),
          SheetContent: passthrough('SheetContent'),
          SheetDescription: passthrough('SheetDescription'),
          SheetFooter: passthrough('SheetFooter'),
          SheetHeader: passthrough('SheetHeader'),
          SheetTitle: passthrough('SheetTitle'),
          ScrollArea: passthrough('ScrollArea'),
          Button: ButtonStub,
          Input: InputStub,
          Label: passthrough('Label'),
          Checkbox: CheckboxStub,
          Textarea: TextareaStub,
          Icon: true
        }
      }
    })

    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('Reusable prompt')
    await wrapper.get('textarea').setValue('Use attached context')

    const file = new File(['# Guide'], 'guide.md', { type: 'text/markdown' })
    const inputElement = {
      type: '',
      multiple: false,
      accept: '',
      onchange: null as ((event: Event) => void | Promise<void>) | null,
      click: vi.fn()
    }
    const originalCreateElement = document.createElement.bind(document)
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        if (tagName === 'input') {
          return inputElement as unknown as HTMLInputElement
        }
        return originalCreateElement(tagName, options)
      })

    const uploadArea = wrapper
      .findAll('div')
      .find(
        (node) =>
          node.classes().includes('group') && node.text().includes('promptSetting.uploadFromDevice')
      )

    expect(uploadArea).toBeDefined()
    await uploadArea!.trigger('click')
    await inputElement.onchange?.({
      target: {
        files: [file]
      }
    } as unknown as Event)
    await flushPromises()

    expect(inputElement.click).toHaveBeenCalledTimes(1)
    expect(fileClient.getPathForFile).toHaveBeenCalledWith(file)
    expect(fileClient.getMimeType).toHaveBeenCalledWith('/tmp/guide.md')
    expect(fileClient.prepareFile).toHaveBeenCalledWith('/tmp/guide.md', 'text/markdown')
    expect(wrapper.text()).toContain('guide.md')

    const submitButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.confirm'))

    expect(submitButton).toBeDefined()
    await submitButton!.trigger('click')

    const submitted = wrapper.emitted('submit')?.[0]?.[0] as {
      files: Array<{ id: string; name: string; path: string; type: string; size: number }>
    }
    expect(submitted.files).toEqual([
      {
        id: 'file-id',
        name: 'guide.md',
        path: '/tmp/guide.md',
        type: 'text/markdown',
        size: 42,
        description: 'Guide file',
        content: '# Guide',
        createdAt: expect.any(Number)
      }
    ])

    createElement.mockRestore()
  })
})
