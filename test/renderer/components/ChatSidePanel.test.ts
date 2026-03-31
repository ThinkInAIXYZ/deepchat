import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

describe('ChatSidePanel', () => {
  it('opens the browser sidepanel when OPEN_REQUESTED targets the current host window', async () => {
    vi.resetModules()

    const handlers = new Map<string, (_event: unknown, payload: unknown) => void>()
    const sidepanelStore = {
      open: false,
      activeTab: 'workspace',
      width: 520,
      openWorkspace: vi.fn(),
      openBrowser: vi.fn(),
      closePanel: vi.fn(),
      setWidth: vi.fn()
    }

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    vi.doMock('@/components/sidepanel/BrowserPanel.vue', () => ({
      default: defineComponent({
        name: 'BrowserPanel',
        template: '<div />'
      })
    }))

    vi.doMock('@/components/sidepanel/WorkspacePanel.vue', () => ({
      default: defineComponent({
        name: 'WorkspacePanel',
        template: '<div />'
      })
    }))

    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))
    ;(window as any).api = {
      ...(window as any).api,
      getWindowId: vi.fn(() => 7)
    }
    ;(window as any).electron = {
      ipcRenderer: {
        on: vi.fn((channel: string, handler: (_event: unknown, payload: unknown) => void) => {
          handlers.set(channel, handler)
        }),
        removeListener: vi.fn()
      }
    }

    const ChatSidePanel = (await import('@/components/sidepanel/ChatSidePanel.vue')).default
    mount(ChatSidePanel, {
      props: {
        sessionId: 'session-1',
        workspacePath: 'C:/workspace'
      },
      global: {
        stubs: {
          Button: defineComponent({
            name: 'Button',
            template: '<button v-bind="$attrs"><slot /></button>'
          }),
          Icon: true,
          BrowserPanel: true,
          WorkspacePanel: true
        }
      }
    })

    await flushPromises()
    const handler = handlers.get('yo-browser:open-requested')
    expect(handler).toBeTypeOf('function')

    handler?.({}, { windowId: 7, sessionId: 'session-1' })

    expect(sidepanelStore.openBrowser).toHaveBeenCalledTimes(1)
  })
})
