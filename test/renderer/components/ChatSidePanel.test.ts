import { defineComponent, nextTick, onMounted, onUnmounted, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_EVENTS } from '@/events'

describe('ChatSidePanel', () => {
  afterEach(() => vi.useRealTimers())

  const setup = async (options?: {
    open?: boolean
    activeTab?: 'workspace' | 'browser' | 'mcp-app' | 'tape-inspector'
    mcpAppPreviewOwnerId?: string | null
    sessionId?: string | null
    traceDebugEnabled?: boolean
  }) => {
    vi.resetModules()

    let openRequestedHandler: ((payload: unknown) => void) | null = null
    const sidepanelStore = reactive({
      open: options?.open ?? true,
      activeTab: options?.activeTab ?? 'workspace',
      mcpAppPreviewOwnerId: options?.mcpAppPreviewOwnerId ?? null,
      tapeInspectorOpenRequest: null as { sessionId: string; token: number } | null,
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
      openTapeInspector: vi.fn((sessionId: string) => {
        sidepanelStore.tapeInspectorOpenRequest = {
          sessionId,
          token: 1
        }
        sidepanelStore.activeTab = 'tape-inspector'
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

    vi.doMock('@/components/tape-inspector/TapeInspectorPanel.vue', () => ({
      default: defineComponent({
        name: 'TapeInspectorPanel',
        props: ['sessionId', 'openRequest', 'isFullscreen'],
        emits: ['open-message-diagnostics', 'toggle-fullscreen'],
        template:
          '<div data-testid="tape-inspector-panel-stub" :data-session-id="sessionId" :data-request-token="openRequest?.token" :data-fullscreen="String(isFullscreen)"><button data-testid="toggle-inspector-fullscreen" @click="$emit(\'toggle-fullscreen\')" /><button data-testid="open-message-diagnostics" @click="$emit(\'open-message-diagnostics\', { messageId: \'message-1\', requestSeq: 2 })" /></div>'
      })
    }))

    vi.doMock('@/components/trace/TraceDialog.vue', () => ({
      default: defineComponent({
        name: 'TraceDialog',
        props: ['messageId', 'requestSeq'],
        emits: ['close'],
        template:
          '<div data-testid="trace-dialog-stub" :data-message-id="messageId ?? undefined" :data-request-seq="requestSeq"><button data-testid="close-trace-dialog" @click="$emit(\'close\')" /></div>'
      })
    }))

    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))
    vi.doMock('@/stores/uiSettingsStore', () => ({
      useUiSettingsStore: () => ({
        traceDebugEnabled: options?.traceDebugEnabled ?? true
      })
    }))

    const ChatSidePanel = (await import('@/components/sidepanel/ChatSidePanel.vue')).default
    const wrapper = mount(ChatSidePanel, {
      props: {
        sessionId: options?.sessionId === undefined ? 'session-1' : options.sessionId,
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

  it('lets the Tape Inspector use and restore the shared fullscreen shell', async () => {
    const { wrapper } = await setup({ activeTab: 'tape-inspector' })
    const shell = wrapper.get('[data-testid="chat-side-panel-shell"]')
    const inspector = wrapper.get('[data-testid="tape-inspector-panel-stub"]')

    expect(shell.attributes('data-tape-inspector-fullscreen')).toBe('false')
    expect(inspector.attributes('data-fullscreen')).toBe('false')

    await wrapper.get('[data-testid="toggle-inspector-fullscreen"]').trigger('click')
    expect(shell.attributes('data-tape-inspector-fullscreen')).toBe('true')
    expect(inspector.attributes('data-fullscreen')).toBe('true')

    await wrapper.get('[data-testid="toggle-inspector-fullscreen"]').trigger('click')
    expect(shell.attributes('data-tape-inspector-fullscreen')).toBe('false')
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

  it('hosts the Inspector only behind the diagnostics gate', async () => {
    const { wrapper, sidepanelStore } = await setup({
      activeTab: 'tape-inspector',
      traceDebugEnabled: true
    })

    expect(
      wrapper.get('[data-testid="tape-inspector-panel-stub"]').attributes('data-session-id')
    ).toBe('session-1')
    await wrapper.get('[data-testid="tape-inspector-sidepanel-tab"]').trigger('click')
    expect(sidepanelStore.openTapeInspector).toHaveBeenCalledWith('session-1')

    const hidden = await setup({ activeTab: 'workspace', traceDebugEnabled: false })
    expect(hidden.wrapper.find('[data-testid="tape-inspector-sidepanel-tab"]').exists()).toBe(false)
  })

  it('keeps a closed Inspector sidepanel closed when diagnostics are disabled', async () => {
    const { sidepanelStore } = await setup({
      open: false,
      activeTab: 'tape-inspector',
      traceDebugEnabled: false
    })

    expect(sidepanelStore.openWorkspace).not.toHaveBeenCalled()
    expect(sidepanelStore.open).toBe(false)
  })

  it('returns an open Inspector sidepanel to the workspace when diagnostics are disabled', async () => {
    const { sidepanelStore } = await setup({
      open: true,
      activeTab: 'tape-inspector',
      traceDebugEnabled: false
    })

    expect(sidepanelStore.openWorkspace).toHaveBeenCalledWith('session-1')
  })

  it('opens existing message diagnostics from the Inspector detail pane', async () => {
    const { wrapper } = await setup({
      activeTab: 'tape-inspector',
      traceDebugEnabled: true
    })

    await wrapper.get('[data-testid="open-message-diagnostics"]').trigger('click')
    expect(wrapper.get('[data-testid="trace-dialog-stub"]').attributes('data-message-id')).toBe(
      'message-1'
    )
    expect(wrapper.get('[data-testid="trace-dialog-stub"]').attributes('data-request-seq')).toBe(
      '2'
    )

    await wrapper.get('[data-testid="close-trace-dialog"]').trigger('click')
    expect(
      wrapper.get('[data-testid="trace-dialog-stub"]').attributes('data-message-id')
    ).toBeUndefined()
  })

  it('does not keep the Inspector mounted while the sidepanel is closed', async () => {
    const { wrapper } = await setup({
      open: false,
      activeTab: 'tape-inspector',
      traceDebugEnabled: true
    })

    expect(wrapper.find('[data-testid="tape-inspector-panel-stub"]').exists()).toBe(false)
  })

  it('closes an active Inspector when there is no session to inspect', async () => {
    const { sidepanelStore } = await setup({
      activeTab: 'tape-inspector',
      sessionId: null,
      traceDebugEnabled: true
    })

    expect(sidepanelStore.closePanel).toHaveBeenCalledTimes(1)
  })
})
