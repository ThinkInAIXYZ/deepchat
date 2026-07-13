import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
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
  emits: ['update:modelValue', 'update:model-value'],
  setup(_, { emit }) {
    const handleInput = (event: Event) => {
      const value = (event.target as HTMLInputElement).value
      emit('update:modelValue', value)
      emit('update:model-value', value)
    }

    return { handleInput }
  },
  template: '<input v-bind="$attrs" :value="modelValue" @input="handleInput" />'
})

const separatorStub = defineComponent({
  name: 'Separator',
  template: '<hr />'
})

const iconStub = defineComponent({
  name: 'Icon',
  template: '<i />'
})

const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string) => {
  const button = wrapper.findAll('button').find((item) => item.text().includes(text))
  if (!button) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}

describe('McpBuiltinMarket', () => {
  async function setup() {
    vi.resetModules()

    const mcpClient = {
      getMcpRouterApiKey: vi.fn().mockResolvedValue('router-key'),
      setMcpRouterApiKey: vi.fn().mockResolvedValue(undefined),
      updateMcpRouterServersAuth: vi.fn().mockResolvedValue(undefined),
      isServerInstalled: vi.fn().mockResolvedValue(false),
      listMcpRouterServers: vi.fn().mockResolvedValue({
        servers: [
          {
            uuid: 'router-item-1',
            created_at: '2026-06-11T00:00:00.000Z',
            updated_at: '2026-06-11T00:00:00.000Z',
            name: 'context7',
            author_name: 'upstash',
            title: 'Context7',
            description: 'Fetch current docs',
            content: 'Documentation helper',
            server_key: 'context7',
            config_name: 'Context7',
            server_url: 'https://mcp.context7.com/mcp'
          }
        ]
      }),
      installMcpRouterServer: vi.fn().mockResolvedValue(true)
    }
    const toast = vi.fn()

    vi.doMock('@api/McpClient', () => ({
      createMcpClient: () => mcpClient
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@shadcn/components/ui/button', () => ({
      Button: buttonStub
    }))
    vi.doMock('@shadcn/components/ui/input', () => ({
      Input: inputStub
    }))
    vi.doMock('@shadcn/components/ui/separator', () => ({
      Separator: separatorStub
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: iconStub
    }))

    const McpBuiltinMarket = (
      await import('../../../src/renderer/settings/components/McpBuiltinMarket.vue')
    ).default
    const wrapper = mount(McpBuiltinMarket)
    await flushPromises()

    return {
      wrapper,
      mcpClient,
      toast
    }
  }

  it('loads, saves, and installs through McpClient', async () => {
    const { wrapper, mcpClient, toast } = await setup()

    expect(mcpClient.getMcpRouterApiKey).toHaveBeenCalledTimes(1)
    expect(mcpClient.listMcpRouterServers).toHaveBeenCalledWith(1, 20)
    expect(mcpClient.isServerInstalled).toHaveBeenCalledWith('mcprouter', 'context7')
    expect(wrapper.text()).toContain('Context7')

    await wrapper.get('input').setValue('new-router-key')
    await findButtonByText(wrapper, 'common.save').trigger('click')
    await flushPromises()

    await findButtonByText(wrapper, 'mcp.market.install').trigger('click')
    await flushPromises()

    expect(mcpClient.setMcpRouterApiKey).toHaveBeenNthCalledWith(1, 'new-router-key')
    expect(mcpClient.updateMcpRouterServersAuth).toHaveBeenCalledWith('new-router-key')
    expect(mcpClient.setMcpRouterApiKey).toHaveBeenNthCalledWith(2, 'new-router-key')
    expect(mcpClient.installMcpRouterServer).toHaveBeenCalledWith('context7')
    expect(toast).toHaveBeenCalledWith({ title: 'common.saved' })
    expect(toast).toHaveBeenCalledWith({ title: 'mcp.market.installSuccess' })
  })
})
