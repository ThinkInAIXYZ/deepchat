import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

describe('BrowserPanel', () => {
  const setup = async () => {
    vi.resetModules()

    const sidepanelStore = {
      open: true,
      activeTab: 'browser'
    }

    const yoBrowserPresenter = {
      attachEmbeddedToWindow: vi.fn().mockResolvedValue(1),
      getWindowById: vi.fn().mockResolvedValue({
        id: 1,
        page: {
          url: 'about:blank'
        }
      }),
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
        on: vi.fn(),
        removeListener: vi.fn()
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
    return { wrapper }
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
})
