import { defineComponent, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const descriptor = {
  schemaVersion: 1 as const,
  serverId: 'server-id',
  configGeneration: 1,
  bindingHash: 'binding-hash',
  serverName: 'charts',
  toolName: 'render_chart',
  resourceUri: 'ui://chart/index.html',
  resourceMimeType: 'text/html;profile=mcp-app'
}

describe('McpAppView', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('scrolls inline content and reloads the frame when moving through the sidepanel', async () => {
    vi.resetModules()
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    )
    const ownerId = 'conversation-1:message-1:block-1'
    const sidepanelStore = reactive({
      open: false,
      activeTab: 'workspace' as 'workspace' | 'browser' | 'mcp-app',
      mcpAppPreviewOwnerId: null as string | null,
      openMcpAppPreview: vi.fn((nextOwnerId: string) => {
        sidepanelStore.open = true
        sidepanelStore.activeTab = 'mcp-app'
        sidepanelStore.mcpAppPreviewOwnerId = nextOwnerId
      }),
      closeMcpAppPreview: vi.fn((currentOwnerId: string) => {
        if (sidepanelStore.mcpAppPreviewOwnerId !== currentOwnerId) {
          return
        }
        sidepanelStore.open = false
        sidepanelStore.activeTab = 'workspace'
        sidepanelStore.mcpAppPreviewOwnerId = null
      })
    })
    const mcpClient = {
      prepareAppView: vi.fn().mockResolvedValue({
        instanceId: 'instance-1',
        sandboxUrl: 'mcp-app://instance-1/sandbox.html',
        html: '<main>Chart</main>',
        sandbox: 'allow-scripts allow-same-origin',
        tool: {
          name: 'render_chart',
          inputSchema: { type: 'object' }
        },
        expiresAt: Date.now() + 60_000
      }),
      releaseAppView: vi.fn().mockResolvedValue(undefined),
      callAppTool: vi.fn(),
      listAppTools: vi.fn(),
      readAppResource: vi.fn(),
      listAppResources: vi.fn(),
      listAppResourceTemplates: vi.fn(),
      listAppPrompts: vi.fn(),
      openAppLink: vi.fn(),
      authorizeAppMessage: vi.fn(),
      updateAppModelContext: vi.fn(),
      retryAppToolAccess: vi.fn()
    }
    class MockAppBridge {
      onsizechange?: (params: { height?: number }) => void
      setRequestHandler = vi.fn()
      setHostContext = vi.fn()
      connect = vi.fn().mockResolvedValue(undefined)
      teardownResource = vi.fn().mockResolvedValue(undefined)
      close = vi.fn().mockResolvedValue(undefined)
      getAppCapabilities = vi.fn(() => ({}))
      sendSandboxResourceReady = vi.fn().mockResolvedValue(undefined)
      sendToolInput = vi.fn().mockResolvedValue(undefined)
      sendToolResult = vi.fn().mockResolvedValue(undefined)

      constructor() {
        appBridges.push(this)
      }
    }
    const appBridges: MockAppBridge[] = []

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key,
        locale: ref('en-US')
      })
    }))
    vi.doMock('@vueuse/core', () => ({
      useResizeObserver: vi.fn()
    }))
    vi.doMock('@/stores/theme', () => ({
      useThemeStore: () => ({ isDark: false })
    }))
    vi.doMock('@/stores/ui/session', () => ({
      useSessionStore: () => ({ sendMessage: vi.fn() })
    }))
    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))
    vi.doMock('@api/McpClient', () => ({
      createMcpClient: () => mcpClient
    }))
    vi.doMock('@api/DeviceClient', () => ({
      createDeviceClient: () => ({
        getAppVersion: vi.fn().mockResolvedValue('1.0.0')
      })
    }))
    vi.doMock('@modelcontextprotocol/ext-apps/app-bridge', () => ({
      buildAllowAttribute: vi.fn(() => ''),
      PostMessageTransport: class {},
      AppBridge: MockAppBridge
    }))

    const outlet = document.createElement('div')
    outlet.id = 'mcp-app-sidepanel-outlet'
    document.body.append(outlet)

    const McpAppView = (await import('@/components/mcp/McpAppView.vue')).default
    const wrapper = mount(McpAppView, {
      attachTo: document.body,
      props: {
        descriptor,
        result: {
          schemaVersion: 1,
          serverId: 'server-id',
          configGeneration: 1,
          bindingHash: 'binding-hash',
          toolName: 'render_chart',
          app: descriptor
        },
        conversationId: 'conversation-1',
        messageId: 'message-1',
        blockId: 'block-1',
        toolInput: {}
      },
      global: {
        stubs: {
          Button: defineComponent({
            name: 'Button',
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
          }),
          Icon: true,
          Spinner: true
        }
      }
    })
    await flushPromises()

    const inlineViewport = wrapper.get('[data-testid="mcp-app-frame-viewport"]')
    const initialIframe = wrapper.get('iframe').element
    expect(inlineViewport.classes()).toContain('aspect-video')
    expect(inlineViewport.classes()).toContain('overflow-auto')
    expect(appBridges).toHaveLength(1)

    appBridges[0].onsizechange?.({ height: 600 })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('iframe').element.style.height).toBe('600px')

    await wrapper.get('[data-testid="mcp-app-open-sidepanel"]').trigger('click')
    await flushPromises()

    expect(sidepanelStore.openMcpAppPreview).toHaveBeenCalledWith(ownerId)
    expect(outlet.querySelector('[data-testid="mcp-app-surface"]')).not.toBeNull()
    expect(outlet.querySelector('iframe')?.classList.contains('flex-1')).toBe(true)
    expect(outlet.querySelector('iframe')).not.toBe(initialIframe)
    expect(appBridges).toHaveLength(2)
    expect(mcpClient.prepareAppView).toHaveBeenCalledTimes(1)

    const sidepanelIframe = outlet.querySelector('iframe')
    const returnButton = outlet.querySelector(
      '[data-testid="mcp-app-return-inline"]'
    ) as HTMLButtonElement
    returnButton.click()
    await flushPromises()

    expect(sidepanelStore.closeMcpAppPreview).toHaveBeenCalledWith(ownerId)
    expect(wrapper.get('[data-testid="mcp-app-frame-viewport"]').classes()).toContain(
      'aspect-video'
    )
    expect(wrapper.get('iframe').element).not.toBe(sidepanelIframe)
    expect(appBridges).toHaveLength(3)
    expect(mcpClient.prepareAppView).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    await flushPromises()
  })
})
