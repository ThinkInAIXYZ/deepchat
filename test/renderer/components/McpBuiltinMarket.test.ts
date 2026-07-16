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
  async function setup(options?: {
    listMcpRouterServers?: ReturnType<typeof vi.fn>
    listInstalledServerIds?: ReturnType<typeof vi.fn>
    installMcpRouterServer?: ReturnType<typeof vi.fn>
    waitForLoad?: boolean
  }) {
    vi.resetModules()

    const mcpClient = {
      getMcpRouterApiKey: vi.fn().mockResolvedValue('router-key'),
      setMcpRouterApiKey: vi.fn().mockResolvedValue(undefined),
      updateMcpRouterServersAuth: vi.fn().mockResolvedValue(undefined),
      isServerInstalled: vi.fn().mockResolvedValue(false),
      listInstalledServerIds: options?.listInstalledServerIds ?? vi.fn().mockResolvedValue([]),
      listMcpRouterServers:
        options?.listMcpRouterServers ??
        vi.fn().mockResolvedValue({
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
      installMcpRouterServer: options?.installMcpRouterServer ?? vi.fn().mockResolvedValue(true)
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
    if (options?.waitForLoad !== false) {
      await flushPromises()
    }

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
    expect(mcpClient.listInstalledServerIds).toHaveBeenCalledWith('mcprouter', ['context7'])
    expect(mcpClient.isServerInstalled).not.toHaveBeenCalled()
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

  it('checks installation status only for items from the newly loaded page', async () => {
    const createItem = (index: number) => ({
      uuid: `router-item-${index}`,
      created_at: '2026-06-11T00:00:00.000Z',
      updated_at: '2026-06-11T00:00:00.000Z',
      name: `server-${index}`,
      author_name: 'deepchat',
      title: `Server ${index}`,
      description: 'Server description',
      server_key: `server-${index}`
    })
    const firstPage = Array.from({ length: 20 }, (_, index) => createItem(index + 1))
    const secondPage = [createItem(21), createItem(22)]
    const listMcpRouterServers = vi
      .fn()
      .mockResolvedValueOnce({ servers: firstPage })
      .mockResolvedValueOnce({ servers: secondPage })
    const listInstalledServerIds = vi.fn().mockResolvedValue([])
    const { wrapper } = await setup({ listMcpRouterServers, listInstalledServerIds })

    const scroller = wrapper.get('.flex-1.overflow-auto')
    Object.defineProperties(scroller.element, {
      scrollTop: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1500 }
    })
    await scroller.trigger('scroll')
    await flushPromises()

    expect(listMcpRouterServers).toHaveBeenNthCalledWith(1, 1, 20)
    expect(listMcpRouterServers).toHaveBeenNthCalledWith(2, 2, 20)
    expect(listInstalledServerIds).toHaveBeenNthCalledWith(
      1,
      'mcprouter',
      firstPage.map((item) => item.server_key)
    )
    expect(listInstalledServerIds).toHaveBeenNthCalledWith(2, 'mcprouter', [
      'server-21',
      'server-22'
    ])
  })

  it('waits for installation status before exposing a newly loaded card', async () => {
    let resolveInstalled: ((value: string[]) => void) | undefined
    const listInstalledServerIds = vi.fn(
      () => new Promise<string[]>((resolve) => (resolveInstalled = resolve))
    )
    const { wrapper } = await setup({ listInstalledServerIds, waitForLoad: false })

    await flushPromises()
    expect(listInstalledServerIds).toHaveBeenCalledWith('mcprouter', ['context7'])
    expect(wrapper.text()).not.toContain('Context7')

    resolveInstalled?.(['context7'])
    await flushPromises()
    expect(wrapper.text()).toContain('Context7')
    expect(wrapper.text()).toContain('mcp.market.installed')
  })

  it('prevents duplicate installs while an item is pending', async () => {
    let resolveInstall: ((value: boolean) => void) | undefined
    const installMcpRouterServer = vi.fn(
      () => new Promise<boolean>((resolve) => (resolveInstall = resolve))
    )
    const { wrapper } = await setup({ installMcpRouterServer })
    const installButton = findButtonByText(wrapper, 'mcp.market.install')

    await installButton.trigger('click')
    await installButton.trigger('click')

    expect(installMcpRouterServer).toHaveBeenCalledTimes(1)
    expect(installButton.attributes('disabled')).toBeDefined()

    resolveInstall?.(true)
    await flushPromises()
    expect(wrapper.text()).toContain('mcp.market.installed')
  })

  it('shows an explicit retry action after a page load failure', async () => {
    const listMcpRouterServers = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ servers: [] })
    const { wrapper } = await setup({ listMcpRouterServers })

    expect(wrapper.text()).toContain('common.error.operationFailed')
    await findButtonByText(wrapper, 'mcp.market.loadMore').trigger('click')
    await flushPromises()

    expect(listMcpRouterServers).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('mcp.market.empty')
  })
})
