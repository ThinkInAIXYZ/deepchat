import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

describe('ChatSidePanel', () => {
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
        emits: ['toggle-fullscreen'],
        template:
          '<div data-testid="workspace-panel-stub" :data-fullscreen="String(isFullscreen)"><button data-testid="workspace-panel-toggle" @click="$emit(\'toggle-fullscreen\')">toggle</button></div>'
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

  it('toggles fullscreen layout from the workspace panel and clears it when switching tabs', async () => {
    const { wrapper, sidepanelStore } = await setup({
      open: true,
      activeTab: 'workspace'
    })

    expect(
      wrapper.get('[data-testid="chat-side-panel-shell"]').attributes('data-workspace-fullscreen')
    ).toBe('false')
    expect(wrapper.find('[data-testid="chat-side-panel-resize-handle"]').exists()).toBe(true)

    await wrapper.get('[data-testid="workspace-panel-toggle"]').trigger('click')

    expect(
      wrapper.get('[data-testid="chat-side-panel-shell"]').attributes('data-workspace-fullscreen')
    ).toBe('true')
    expect(wrapper.find('[data-testid="chat-side-panel-resize-handle"]').exists()).toBe(false)

    sidepanelStore.activeTab = 'browser'
    await nextTick()

    expect(
      wrapper.get('[data-testid="chat-side-panel-shell"]').attributes('data-workspace-fullscreen')
    ).toBe('false')
  })
})
