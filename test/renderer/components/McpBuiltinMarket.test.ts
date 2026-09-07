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
    getMcpRouterApiKey?: ReturnType<typeof vi.fn>
    listMcpRouterServers?: ReturnType<typeof vi.fn>
    listInstalledServerIds?: ReturnType<typeof vi.fn>
    installMcpRouterServer?: ReturnType<typeof vi.fn>
    waitForLoad?: boolean
  }) {
    vi.resetModules()

    const mcpClient = {
      getMcpRouterApiKey: options?.getMcpRouterApiKey ?? vi.fn().mockResolvedValue('router-key'),
      setMcpRouterApiKey: vi.fn().mockResolvedValue(undefined),
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
    const notifyRenderer = vi.fn(() => true)

    vi.doMock('@api/McpClient', () => ({
      createMcpClient: () => mcpClient
    }))
    vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
      notifyRenderer
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@dc-ui/components/button', () => ({
      DcButton: buttonStub
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
      notifyRenderer
    }
  }

  it('loads, saves, and installs through McpClient', async () => {
    const { wrapper, mcpClient, notifyRenderer } = await setup()

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
    expect(mcpClient.setMcpRouterApiKey).toHaveBeenNthCalledWith(2, 'new-router-key')
    expect(mcpClient.installMcpRouterServer).toHaveBeenCalledWith('context7')
    // 成功反馈走按钮 ✅ 态，不再弹 toast
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('mcp.market.installed')
  })

  it('synchronizes installed router authorization when the API key is cleared', async () => {
    const { wrapper, mcpClient, notifyRenderer } = await setup()

    await wrapper.get('input').setValue('   ')
    await findButtonByText(wrapper, 'common.save').trigger('click')
    await flushPromises()

    expect(mcpClient.setMcpRouterApiKey).toHaveBeenCalledWith('')
    // 成功反馈走按钮 ✅ 态，不再弹 toast
    expect(notifyRenderer).not.toHaveBeenCalled()
  })

  it('reports a failed API key save inline without a toast', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const setMcpRouterApiKey = vi.fn().mockRejectedValue(new Error('keychain write failed'))
    const { wrapper, mcpClient, notifyRenderer } = await setup({})
    mcpClient.setMcpRouterApiKey = setMcpRouterApiKey

    await wrapper.get('input').setValue('new-router-key')
    await findButtonByText(wrapper, 'common.save').trigger('click')
    await flushPromises()

    expect(setMcpRouterApiKey).toHaveBeenCalledWith('new-router-key')
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('common.error.requestFailed')
    consoleError.mockRestore()
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
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    expect(findButtonByText(wrapper, 'common.save').attributes('disabled')).toBeDefined()

    resolveInstall?.(true)
    await flushPromises()
    expect(wrapper.text()).toContain('mcp.market.installed')
  })

  it('shows an explicit retry action after a page load failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const listMcpRouterServers = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ servers: [] })
    const { wrapper } = await setup({ listMcpRouterServers })

    expect(wrapper.text()).toContain('common.error.operationFailed')
    await findButtonByText(wrapper, 'common.retry').trigger('click')
    await flushPromises()

    expect(listMcpRouterServers).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('mcp.market.empty')
    consoleError.mockRestore()
  })

  it('does not expose install actions until installed-state loading succeeds', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const listInstalledServerIds = vi
      .fn()
      .mockRejectedValueOnce(new Error('config unavailable'))
      .mockResolvedValueOnce([])
    const { wrapper } = await setup({ listInstalledServerIds })

    expect(wrapper.text()).toContain('common.error.operationFailed')
    expect(wrapper.text()).not.toContain('Context7')

    await findButtonByText(wrapper, 'common.retry').trigger('click')
    await flushPromises()

    expect(listInstalledServerIds).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Context7')
    consoleError.mockRestore()
  })

  it('does not expose an empty writable API key after loading fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const getMcpRouterApiKey = vi
      .fn()
      .mockRejectedValueOnce(new Error('keychain unavailable'))
      .mockResolvedValueOnce('router-key')
    const { wrapper } = await setup({ getMcpRouterApiKey })

    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    await findButtonByText(wrapper, 'common.retry').trigger('click')
    await flushPromises()

    expect(getMcpRouterApiKey).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('common.error.requestFailed')
    expect(wrapper.get('input').element).toMatchObject({ value: 'router-key' })
    consoleError.mockRestore()
  })

  it('keeps install failures on the affected market card', async () => {
    const { wrapper } = await setup({
      installMcpRouterServer: vi.fn().mockResolvedValue(false)
    })

    await findButtonByText(wrapper, 'mcp.market.install').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('mcp.market.installFailed')
    expect(wrapper.text()).not.toContain('mcp.market.installed')
  })
})
