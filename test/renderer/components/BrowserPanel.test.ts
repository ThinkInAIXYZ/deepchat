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
    getWindowByIdResult?: unknown
  }) => {
    vi.resetModules()

    const handlers = new Map<string, IpcHandler>()
    const sidepanelStore = {
      open: options?.open ?? true,
      activeTab: options?.activeTab ?? 'browser'
    }

    const yoBrowserPresenter = {
      attachEmbeddedToWindow: vi.fn().mockResolvedValue(1),
      getWindowById: vi.fn().mockResolvedValue(
        options?.getWindowByIdResult ?? {
          id: 1,
          page: {
            url: 'about:blank'
          }
        }
      ),
      getNavigationState: vi.fn().mockResolvedValue({
        canGoBack: false,
        canGoForward: false
      }),
      updateEmbeddedBounds: vi.fn().mockResolvedValue(undefined),
      navigateWindow: vi.fn().mockResolvedValue(undefined),
      goBack: vi.fn().mockResolvedValue(undefined),
      goForward: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      detachEmbedded: vi.fn().mockResolvedValue(undefined)
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
    return { wrapper, yoBrowserPresenter, sidepanelStore, handlers }
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

    expect(yoBrowserPresenter.attachEmbeddedToWindow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(160)
    await flushPromises()

    expect(yoBrowserPresenter.attachEmbeddedToWindow).toHaveBeenCalledWith(1)
    expect(yoBrowserPresenter.updateEmbeddedBounds).toHaveBeenCalledWith(
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

  it('ignores open requests for a different host window', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      makeRect(10, 10, 300, 400)
    )

    const { yoBrowserPresenter, handlers } = await setup()
    yoBrowserPresenter.attachEmbeddedToWindow.mockClear()
    yoBrowserPresenter.updateEmbeddedBounds.mockClear()

    const openRequestedHandler = handlers.get('yo-browser:open-requested')
    expect(openRequestedHandler).toBeTypeOf('function')

    await openRequestedHandler?.({}, { windowId: 2 })
    await flushPromises()

    expect(yoBrowserPresenter.attachEmbeddedToWindow).not.toHaveBeenCalled()
    expect(yoBrowserPresenter.updateEmbeddedBounds).not.toHaveBeenCalled()
  })
})
