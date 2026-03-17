import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (_event: unknown, payload: unknown) => void | Promise<void>

const makeRect = (x: number, y: number, width: number, height: number): DOMRect => {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({ x, y, width, height })
  } as DOMRect
}

const defaultBrowserStatus = {
  initialized: true,
  page: {
    id: 'page-1',
    url: 'about:blank',
    status: 'idle' as const,
    createdAt: 1,
    updatedAt: 1
  },
  canGoBack: false,
  canGoForward: false,
  visible: false,
  loading: false
}

describe('BrowserPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const setup = async (options?: {
    open?: boolean
    activeTab?: 'browser' | 'workspace'
    sessionId?: string
    browserStatus?: typeof defaultBrowserStatus
    sessions?: Array<{ id: string; status: string }>
  }) => {
    vi.resetModules()

    const handlers = new Map<string, IpcHandler>()
    const sidepanelStore = {
      open: options?.open ?? true,
      activeTab: options?.activeTab ?? 'browser'
    }
    const sessionStore = {
      sessions: options?.sessions ?? [{ id: options?.sessionId ?? 'session-a', status: 'none' }]
    }

    const yoBrowserPresenter = {
      getBrowserStatus: vi.fn().mockResolvedValue(options?.browserStatus ?? defaultBrowserStatus),
      attachSessionBrowser: vi.fn().mockResolvedValue(true),
      updateSessionBrowserBounds: vi.fn().mockResolvedValue(undefined),
      loadUrl: vi.fn().mockResolvedValue(options?.browserStatus ?? defaultBrowserStatus),
      goBack: vi.fn().mockResolvedValue(undefined),
      goForward: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      detachSessionBrowser: vi.fn().mockResolvedValue(undefined),
      destroySessionBrowser: vi.fn().mockResolvedValue(undefined)
    }

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    vi.doMock('@vueuse/core', () => ({
      useResizeObserver: vi.fn()
    }))

    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))

    vi.doMock('@/stores/ui/session', () => ({
      useSessionStore: () => sessionStore
    }))

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: () => yoBrowserPresenter
    }))
    ;(window as any).api = {
      ...(window as any).api,
      getWindowId: vi.fn(() => 1)
    }
    ;(window as any).electron = {
      ipcRenderer: {
        on: vi.fn((channel: string, handler: IpcHandler) => {
          handlers.set(channel, handler)
        }),
        removeListener: vi.fn((channel: string) => {
          handlers.delete(channel)
        })
      }
    }

    const BrowserPanel = (await import('@/components/sidepanel/BrowserPanel.vue')).default
    const wrapper = mount(BrowserPanel, {
      props: {
        sessionId: options?.sessionId ?? 'session-a'
      },
      global: {
        stubs: {
          Button: defineComponent({
            name: 'Button',
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
          }),
          Input: defineComponent({
            name: 'Input',
            props: {
              modelValue: {
                type: String,
                default: ''
              }
            },
            emits: ['update:modelValue'],
            template:
              '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
          }),
          Icon: true,
          BrowserPlaceholder: true
        }
      }
    })

    await flushPromises()
    return { wrapper, yoBrowserPresenter, handlers }
  }

  it('adds accessible labels to browser toolbar controls', async () => {
    const { wrapper } = await setup()
    const buttons = wrapper.findAll('button')
    const input = wrapper.find('input')

    expect(buttons[0].attributes('aria-label')).toBe('common.browser.back')
    expect(buttons[1].attributes('aria-label')).toBe('common.browser.forward')
    expect(buttons[2].attributes('aria-label')).toBe('common.browser.reload')
    expect(input.attributes('aria-label')).toBe('common.browser.addressLabel')
  })

  it('waits for a stable rect before first attach and visible bounds sync', async () => {
    const rects = [makeRect(0, 0, 0, 0), makeRect(24, 48, 320, 480), makeRect(24, 48, 320, 480)]
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
      return rects.shift() ?? makeRect(24, 48, 320, 480)
    })

    const { yoBrowserPresenter } = await setup()

    expect(yoBrowserPresenter.attachSessionBrowser).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(160)
    await flushPromises()

    expect(yoBrowserPresenter.attachSessionBrowser).toHaveBeenCalledWith('session-a', 1)
    expect(yoBrowserPresenter.updateSessionBrowserBounds).toHaveBeenCalledWith(
      'session-a',
      1,
      expect.objectContaining({
        x: 24,
        y: 48,
        width: 320,
        height: 480
      }),
      true
    )
  })

  it('ignores open requests for a different host window or session', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      makeRect(10, 10, 300, 400)
    )

    const { yoBrowserPresenter, handlers } = await setup()
    yoBrowserPresenter.attachSessionBrowser.mockClear()
    yoBrowserPresenter.updateSessionBrowserBounds.mockClear()

    const openRequestedHandler = handlers.get('yo-browser:open-requested')
    expect(openRequestedHandler).toBeTypeOf('function')

    await openRequestedHandler?.({}, { sessionId: 'session-b', windowId: 1 })
    await openRequestedHandler?.({}, { sessionId: 'session-a', windowId: 2 })
    await flushPromises()

    expect(yoBrowserPresenter.attachSessionBrowser).not.toHaveBeenCalled()
    expect(yoBrowserPresenter.updateSessionBrowserBounds).not.toHaveBeenCalled()
  })
})
