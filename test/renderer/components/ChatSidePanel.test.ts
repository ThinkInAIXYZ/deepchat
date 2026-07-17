import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { WORKSPACE_EVENTS } from '@/events'

describe('ChatSidePanel', () => {
  it('keeps shell width out of CSS transitions', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/renderer/src/components/sidepanel/ChatSidePanel.vue'),
      'utf8'
    )
    const shellStyles = source.match(/\.chat-side-panel-shell\s*\{([\s\S]*?)\}/)?.[1] ?? ''

    expect(shellStyles).not.toMatch(/transition(?:-property)?:[^;]*width/)
  })

  const setup = async (options?: {
    open?: boolean
    activeTab?: 'workspace' | 'browser'
    sessionId?: string | null
  }) => {
    vi.resetModules()

    let openRequestedHandler: ((payload: unknown) => void) | null = null
    const sidepanelStore = reactive({
      open: options?.open ?? true,
      activeTab: options?.activeTab ?? 'workspace',
      width: 520,
      openWorkspace: vi.fn(),
      openBrowser: vi.fn(() => {
        sidepanelStore.activeTab = 'browser'
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
          Button: defineComponent({
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
})
