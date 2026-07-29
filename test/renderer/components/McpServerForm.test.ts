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

const loadMcpServerForm = async () => {
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

  return (await import('@/components/mcp-config/McpServerForm.vue')).default
}

const globalStubs = {
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

describe('McpServerForm', () => {
  it('renders editable permissions and submission feedback', async () => {
    const McpServerForm = await loadMcpServerForm()

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
        stubs: globalStubs
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

    await wrapper.setProps({
      submitting: true,
      submissionError: 'A server with this name already exists.'
    })

    expect(wrapper.get('[role="alert"]').text()).toBe('A server with this name already exists.')
    expect(wrapper.get('form').attributes('inert')).toBeDefined()
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('keeps invalid JSON feedback beside the configuration input', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const McpServerForm = await loadMcpServerForm()
    const wrapper = mount(McpServerForm, {
      global: {
        stubs: globalStubs
      }
    })

    await wrapper.get('#json-config').setValue('{')
    await wrapper.findAll('button').at(-1)!.trigger('click')

    expect(wrapper.get('#json-config-error').text()).toBe('settings.mcp.serverForm.parseError')
    expect(wrapper.get('#json-config').attributes('aria-invalid')).toBe('true')

    await wrapper.get('#json-config').setValue(
      JSON.stringify({
        mcpServers: {
          filesystem: {
            command: 'node',
            args: ['server.js']
          }
        }
      })
    )
    await wrapper.findAll('button').at(-1)!.trigger('click')

    expect(wrapper.find('#json-config-error').exists()).toBe(false)
    expect(wrapper.find('#server-name').exists()).toBe(true)
    consoleError.mockRestore()
  })
})
