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

    const browserClient = {
      getStatus: vi.fn().mockResolvedValue(options?.browserStatus ?? defaultBrowserStatus),
      attachCurrentWindow: vi.fn().mockResolvedValue(true),
      updateCurrentWindowBounds: vi.fn().mockResolvedValue(true),
      loadUrl: vi.fn().mockResolvedValue(options?.browserStatus ?? defaultBrowserStatus),
      goBack: vi.fn().mockResolvedValue(options?.browserStatus ?? defaultBrowserStatus),
      goForward: vi.fn().mockResolvedValue(options?.browserStatus ?? defaultBrowserStatus),
      reload: vi.fn().mockResolvedValue(options?.browserStatus ?? defaultBrowserStatus),
      detach: vi.fn().mockResolvedValue(true),
      destroy: vi.fn().mockResolvedValue(true),
      onOpenRequestedForCurrentWindow: vi.fn((listener: IpcHandler) => {
        handlers.set('yo-browser:open-requested', listener)
        return () => {
          handlers.delete('yo-browser:open-requested')
        }
      }),
      onStatusChanged: vi.fn((listener: IpcHandler) => {
        handlers.set('yo-browser:status-changed', listener)
        return () => {
          handlers.delete('yo-browser:status-changed')
        }
      })
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

    vi.doMock('@api/BrowserClient', () => ({
      createBrowserClient: () => browserClient
    }))

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
    return { wrapper, browserClient, handlers }
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

    const { browserClient } = await setup()

    expect(browserClient.attachCurrentWindow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(160)
    await flushPromises()

    expect(browserClient.attachCurrentWindow).toHaveBeenCalledWith('session-a')
    expect(browserClient.updateCurrentWindowBounds).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({
        x: 24,
        y: 48,
        width: 320,
        height: 480
      }),
      true
    )
  })

  it('syncs bounds when window resize changes only the browser panel position', async () => {
    let currentRect = makeRect(24, 48, 320, 480)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
      return currentRect
    })

    const { browserClient } = await setup()
    await vi.advanceTimersByTimeAsync(160)
    await flushPromises()
    browserClient.updateCurrentWindowBounds.mockClear()

    currentRect = makeRect(12, 48, 320, 480)
    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    expect(browserClient.updateCurrentWindowBounds).toHaveBeenCalledTimes(1)
    expect(browserClient.updateCurrentWindowBounds).toHaveBeenCalledWith(
      'session-a',
      {
        x: 12,
        y: 48,
        width: 320,
        height: 480
      },
      true
    )
  })

  it('skips resize bounds sync when rounded bounds are unchanged', async () => {
    const currentRect = makeRect(24, 48, 320, 480)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
      return currentRect
    })

    const { browserClient } = await setup()
    await vi.advanceTimersByTimeAsync(160)
    await flushPromises()
    browserClient.updateCurrentWindowBounds.mockClear()

    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    expect(browserClient.updateCurrentWindowBounds).not.toHaveBeenCalled()
  })

  it('ignores open requests for a different host window or session', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      makeRect(10, 10, 300, 400)
    )

    const { browserClient, handlers } = await setup()
    browserClient.attachCurrentWindow.mockClear()
    browserClient.updateCurrentWindowBounds.mockClear()

    const openRequestedHandler = handlers.get('yo-browser:open-requested')
    expect(openRequestedHandler).toBeTypeOf('function')

    await openRequestedHandler?.({}, { sessionId: 'session-b', windowId: 1 })
    await openRequestedHandler?.({}, { sessionId: 'session-a', windowId: 2 })
    await flushPromises()

    expect(browserClient.attachCurrentWindow).not.toHaveBeenCalled()
    expect(browserClient.updateCurrentWindowBounds).not.toHaveBeenCalled()
  })
})
