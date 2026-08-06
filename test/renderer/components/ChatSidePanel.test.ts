import { defineComponent, nextTick, onMounted, onUnmounted, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_EVENTS } from '@/events'

describe('ChatSidePanel', () => {
  afterEach(() => vi.useRealTimers())

  const setup = async (options?: {
    open?: boolean
    activeTab?: 'workspace' | 'browser' | 'mcp-app'
    mcpAppPreviewOwnerId?: string | null
    sessionId?: string | null
  }) => {
    vi.resetModules()

    let openRequestedHandler: ((payload: unknown) => void) | null = null
    const sidepanelStore = reactive({
      open: options?.open ?? true,
      activeTab: options?.activeTab ?? 'workspace',
      mcpAppPreviewOwnerId: options?.mcpAppPreviewOwnerId ?? null,
      width: 520,
      openWorkspace: vi.fn(),
      openBrowser: vi.fn(() => {
        sidepanelStore.activeTab = 'browser'
        sidepanelStore.open = true
      }),
      openMcpAppPreview: vi.fn((ownerId: string) => {
        sidepanelStore.mcpAppPreviewOwnerId = ownerId
        sidepanelStore.activeTab = 'mcp-app'
        sidepanelStore.open = true
      }),
      closePanel: vi.fn(() => {
        sidepanelStore.open = false
      }),
      setWidth: vi.fn()
    })

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    vi.doMock('@iconify/vue', () => ({
      Icon: defineComponent({
        name: 'Icon',
        template: '<span data-testid="icon" />'
      })
    }))

    vi.doMock('@api/BrowserClient', () => ({
      createBrowserClient: () => ({
        onOpenRequestedForCurrentWindow: vi.fn((handler: (payload: unknown) => void) => {
          openRequestedHandler = handler
          return vi.fn()
        })
      })
    }))

    vi.doMock('@/components/sidepanel/BrowserPanel.vue', () => ({
      default: defineComponent({
        name: 'BrowserPanel',
        setup() {
          onMounted(() => window.dispatchEvent(new Event('browser-panel-mounted')))
        },
        template: '<div data-testid="browser-panel-stub" />'
      })
    }))

    vi.doMock('@/components/sidepanel/WorkspacePanel.vue', () => ({
      default: defineComponent({
        name: 'WorkspacePanel',
        props: {
          isFullscreen: {
            type: Boolean,
            default: false
          }
        },
        emits: ['toggle-fullscreen', 'insert-file-reference'],
        setup() {
          onUnmounted(() => window.dispatchEvent(new Event('workspace-panel-unmounted')))
        },
        template:
          '<div data-testid="workspace-panel-stub" :data-fullscreen="String(isFullscreen)"><button data-testid="workspace-panel-toggle" @click="$emit(\'toggle-fullscreen\')">toggle</button><button data-testid="workspace-panel-insert" @click="$emit(\'insert-file-reference\', \'C:/workspace/README.md\')">insert</button></div>'
      })
    }))

    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))

    const ChatSidePanel = (await import('@/components/sidepanel/ChatSidePanel.vue')).default
    const wrapper = mount(ChatSidePanel, {
      props: {
        sessionId: options?.sessionId ?? 'session-1',
        workspacePath: 'C:/workspace'
      },
      global: {
        stubs: {
          DcButton: defineComponent({
            name: 'Button',
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
          })
        }
      }
    })

    await flushPromises()

    return {
      wrapper,
      sidepanelStore,
      emitOpenRequested: (payload: unknown) => openRequestedHandler?.(payload)
    }
  }

  it('unmounts workspace content before mounting browser content', async () => {
    vi.useFakeTimers()
    const lifecycleEvents: string[] = []
    const recordWorkspaceUnmount = () => lifecycleEvents.push('workspace-unmounted')
    const recordBrowserMount = () => lifecycleEvents.push('browser-mounted')
    window.addEventListener('workspace-panel-unmounted', recordWorkspaceUnmount)
    window.addEventListener('browser-panel-mounted', recordBrowserMount)

    try {
      const { wrapper } = await setup({ activeTab: 'workspace' })
      const browserTab = wrapper
        .findAll('button')
        .find((button) => button.text() === 'common.browser.name')
      expect(browserTab).toBeDefined()

      await browserTab!.trigger('click')
      await vi.runAllTimersAsync()
      await nextTick()

      expect(lifecycleEvents).toEqual(['workspace-unmounted', 'browser-mounted'])
      expect(wrapper.find('[data-testid="workspace-panel-stub"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="browser-panel-stub"]').exists()).toBe(true)
    } finally {
      window.removeEventListener('workspace-panel-unmounted', recordWorkspaceUnmount)
      window.removeEventListener('browser-panel-mounted', recordBrowserMount)
    }
  })

  it('keeps the mcp-app outlet mounted so teleported apps always have a target', async () => {
    const { wrapper } = await setup({
      activeTab: 'workspace',
      mcpAppPreviewOwnerId: 'm1'
    })
    const mcpTab = wrapper.findAll('button').find((button) => button.text() === 'mcp.apps.title')
    expect(mcpTab).toBeDefined()

    // The outlet must already exist while the workspace panel is still in the leave phase
    // (McpAppView teleports synchronously when the mcp-app tab activates).
    await mcpTab!.trigger('click')
    expect(wrapper.find('#mcp-app-sidepanel-outlet').exists()).toBe(true)

    await nextTick()
    expect(wrapper.find('#mcp-app-sidepanel-outlet').isVisible()).toBe(true)
  })

  it('opens the browser sidepanel when OPEN_REQUESTED targets the current host window', async () => {
    const { sidepanelStore, emitOpenRequested } = await setup({
      open: false,
      activeTab: 'workspace'
    })

    emitOpenRequested({
      windowId: 7,
      sessionId: 'session-1',
      url: 'https://example.com',
      version: Date.now()
    })

    expect(sidepanelStore.openBrowser).toHaveBeenCalledTimes(1)
  })

  it('keeps a closed sidepanel closed for Agent browser activity', async () => {
    const { sidepanelStore, emitOpenRequested } = await setup({
      open: false,
      activeTab: 'workspace'
    })

    emitOpenRequested({
      windowId: 7,
      sessionId: 'session-1',
      url: 'https://example.com',
      source: 'agent',
      runId: 'run-1',
      version: Date.now()
    })

    expect(sidepanelStore.openBrowser).not.toHaveBeenCalled()
  })

  it('switches an open workspace sidepanel to Browser for Agent activity', async () => {
    const { sidepanelStore, emitOpenRequested } = await setup({
      open: true,
      activeTab: 'workspace'
    })

    emitOpenRequested({
      windowId: 7,
      sessionId: 'session-1',
      url: 'https://example.com',
      source: 'agent',
      runId: 'run-1',
      version: Date.now()
    })

    expect(sidepanelStore.openBrowser).toHaveBeenCalledTimes(1)
  })

  it('dispatches session-scoped workspace insertion requests from the workspace panel', async () => {
    const insertionListener = vi.fn()
    window.addEventListener(WORKSPACE_EVENTS.INSERT_REFERENCE_REQUESTED, insertionListener)

    try {
      const { wrapper } = await setup({
        open: true,
        activeTab: 'workspace',
        sessionId: 'session-1'
      })

      await wrapper.get('[data-testid="workspace-panel-insert"]').trigger('click')

      expect(insertionListener).toHaveBeenCalledTimes(1)
      const event = insertionListener.mock.calls[0][0] as CustomEvent
      expect(event.detail).toEqual({
        sessionId: 'session-1',
        filePath: 'C:/workspace/README.md'
      })
    } finally {
      window.removeEventListener(WORKSPACE_EVENTS.INSERT_REFERENCE_REQUESTED, insertionListener)
    }
  })

  it('hosts the selected MCP App in the existing sidepanel', async () => {
    const { wrapper, sidepanelStore } = await setup({
      activeTab: 'mcp-app',
      mcpAppPreviewOwnerId: 'conversation:message:block'
    })

    expect(wrapper.find('[data-testid="workspace-panel-stub"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="browser-panel-stub"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="mcp-app-sidepanel-outlet"]').isVisible()).toBe(true)

    await wrapper.get('[data-testid="mcp-app-sidepanel-tab"]').trigger('click')

    expect(sidepanelStore.openMcpAppPreview).toHaveBeenCalledWith('conversation:message:block')
  })
})
