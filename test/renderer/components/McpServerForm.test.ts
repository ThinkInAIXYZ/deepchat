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
  vi.doMock('@api/McpClient', () => ({
    createMcpClient: () => ({
      listEnterpriseProfiles: vi.fn().mockResolvedValue([]),
      getCredentialStatus: vi.fn().mockResolvedValue([]),
      removeCredential: vi.fn()
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
  Badge: passthrough('Badge', 'span'),
  Checkbox: checkboxStub
}

describe('McpServerForm', () => {
  it('does not expose or submit the removed MCP auto-approve policy', async () => {
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
          enabled: true
        }
      },
      global: {
        stubs: globalStubs
      }
    })

    const checkboxes = wrapper.findAll('[data-testid="checkbox"]')
    expect(checkboxes).toHaveLength(0)
    await wrapper.find('form').trigger('submit')

    const submitEvent = wrapper.emitted('submit')?.[0]
    expect(submitEvent?.[0]).toBe('test-server')
    expect(submitEvent?.[1]).not.toHaveProperty('autoApprove')
  })

  it('keeps SSE available as a compatibility transport when adding a server', async () => {
    const McpServerForm = await loadMcpServerForm()
    const wrapper = mount(McpServerForm, {
      global: {
        stubs: globalStubs
      }
    })

    const manualButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.mcp.serverForm.skipToManual')
    expect(manualButton).toBeDefined()
    await manualButton?.trigger('click')

    const sseOption = wrapper.find('[value="sse"]')
    expect(sseOption.exists()).toBe(true)
    expect(sseOption.text()).toContain('settings.mcp.serverForm.sseCompatibilityBadge')
  })
})
