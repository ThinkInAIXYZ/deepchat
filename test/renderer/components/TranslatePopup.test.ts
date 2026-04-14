import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TranslatePopup from '@/components/popup/TranslatePopup.vue'

const translateText = vi.fn()

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === 'contextMenu.translate.title') return 'Translate'
      if (key === 'contextMenu.translate.error') return 'Translate failed'
      if (key === 'common.loading') return 'Loading'
      return key
    },
    locale: {
      value: 'en-US'
    }
  })
}))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    translateText
  })
}))

vi.mock('@/stores/ui/agent', () => ({
  useAgentStore: () => ({
    selectedAgentId: null
  })
}))

vi.mock('@shadcn/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    template: '<button type="button"><slot /></button>'
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<span class="icon-stub" />'
  })
}))

describe('TranslatePopup', () => {
  let originalInnerWidth: number
  let originalInnerHeight: number

  beforeEach(() => {
    translateText.mockReset()
    translateText.mockResolvedValue('Bonjour')
    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 800
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 600
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight
    })
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('opens the popup, clamps it to the viewport, and requests translation', async () => {
    const wrapper = mount(TranslatePopup, {
      attachTo: document.body
    })

    window.dispatchEvent(
      new CustomEvent('context-menu-translate-text', {
        detail: {
          text: 'hello',
          x: 900,
          y: 700
        }
      })
    )

    await flushPromises()

    const popup = wrapper.get('[data-translate-popup="true"]')

    expect(translateText).toHaveBeenCalledWith('hello', 'en-US', 'deepchat')
    expect(popup.attributes('style')).toContain('translate3d(760px, 560px, 0)')
    expect(wrapper.text()).toContain('Bonjour')
  })

  it('attaches drag listeners only during dragging and coalesces pointer moves in rAF', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const rafCallbacks: FrameRequestCallback[] = []

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (callback: FrameRequestCallback) => {
        rafCallbacks.push(callback)
        return rafCallbacks.length
      }
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    const wrapper = mount(TranslatePopup, {
      attachTo: document.body
    })

    expect(addEventListenerSpy.mock.calls.some(([type]) => type === 'pointermove')).toBe(false)

    window.dispatchEvent(
      new CustomEvent('context-menu-translate-text', {
        detail: {
          text: 'drag me',
          x: 10,
          y: 20
        }
      })
    )

    await flushPromises()

    const popup = wrapper.get('[data-translate-popup="true"]')
    const header = wrapper.get('[data-translate-popup-header="true"]')

    header.element.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 30,
        clientY: 50
      })
    )

    expect(addEventListenerSpy.mock.calls.some(([type]) => type === 'pointermove')).toBe(true)
    expect(addEventListenerSpy.mock.calls.some(([type]) => type === 'pointerup')).toBe(true)
    expect(addEventListenerSpy.mock.calls.some(([type]) => type === 'pointercancel')).toBe(true)

    window.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 120 })
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 140, clientY: 160 })
    )

    expect(popup.attributes('style')).toContain('translate3d(10px, 20px, 0)')
    expect(rafCallbacks).toHaveLength(1)

    rafCallbacks[0](performance.now())
    await flushPromises()

    expect(popup.attributes('style')).toContain('translate3d(120px, 130px, 0)')

    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))

    expect(removeEventListenerSpy.mock.calls.some(([type]) => type === 'pointermove')).toBe(true)
    expect(removeEventListenerSpy.mock.calls.some(([type]) => type === 'pointerup')).toBe(true)
    expect(removeEventListenerSpy.mock.calls.some(([type]) => type === 'pointercancel')).toBe(true)
  })
})
