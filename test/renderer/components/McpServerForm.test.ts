import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

const passthrough = (name: string, tag = 'div') =>
  defineComponent({
    name,
    template: `<${tag} v-bind="$attrs"><slot /></${tag}>`
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="$attrs.disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const inputStub = defineComponent({
  name: 'Input',
  props: {
    modelValue: { type: [String, Number], default: '' }
  },
  emits: ['update:modelValue'],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const textareaStub = defineComponent({
  name: 'Textarea',
  props: {
    modelValue: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  template:
    '<textarea v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const checkboxStub = defineComponent({
  name: 'Checkbox',
  props: {
    checked: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:checked'],
  template:
    '<input type="checkbox" data-testid="checkbox" :checked="checked" :disabled="disabled" @click="$emit(\'update:checked\', !checked)" />'
})

describe('McpServerForm', () => {
  it('renders editable auto approve checkboxes and submits selected permissions', async () => {
    vi.resetModules()

    vi.doMock('@api/DeviceClient', () => ({
      createDeviceClient: () => ({
        selectDirectory: vi.fn()
      })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({
        toast: vi.fn()
      })
    }))
    vi.doMock('@/components/emoji-picker', () => ({
      EmojiPicker: defineComponent({
        name: 'EmojiPicker',
        props: {
          modelValue: { type: String, default: '' }
        },
        emits: ['update:modelValue'],
        template:
          '<input data-testid="emoji-picker" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const McpServerForm = (await import('@/components/mcp-config/McpServerForm.vue')).default

    const wrapper = mount(McpServerForm, {
      props: {
        serverName: 'test-server',
        editMode: true,
        initialConfig: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: {},
          descriptions: 'Test server',
          icons: 'folder',
          enabled: true,
          autoApprove: []
        }
      },
      global: {
        stubs: {
          Button: buttonStub,
          Input: inputStub,
          Label: passthrough('Label', 'label'),
          Textarea: textareaStub,
          ScrollArea: passthrough('ScrollArea'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          Checkbox: checkboxStub
        }
      }
    })

    const checkboxes = wrapper.findAll('[data-testid="checkbox"]')
    expect(checkboxes).toHaveLength(3)

    await checkboxes[1].trigger('click')
    await checkboxes[2].trigger('click')
    await wrapper.find('form').trigger('submit')

    const submitEvent = wrapper.emitted('submit')?.[0]
    expect(submitEvent?.[0]).toBe('test-server')
    expect(submitEvent?.[1]).toMatchObject({
      autoApprove: ['read', 'write']
    })
  })
})
