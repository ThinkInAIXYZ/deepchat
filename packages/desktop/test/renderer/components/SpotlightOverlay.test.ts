import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent, nextTick, reactive } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'

const mounted: VueWrapper[] = []
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
})

const setup = async (initialOpen = true) => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.resetModules()

  const resultItem = {
    id: 'session:1',
    kind: 'session' as const,
    icon: 'lucide:message-square',
    title: 'DeepChat Session',
    subtitle: '/workspace/demo',
    score: 100,
    sessionId: 'session-1'
  }

  const spotlightStore = reactive({
    open: initialOpen,
    activationKey: 1,
    query: '',
    results: [resultItem],
    activeIndex: 0,
    loading: false,
    closeSpotlight: vi.fn(),
    setQuery: vi.fn(),
    setActiveItem: vi.fn(),
    moveActiveItem: vi.fn(),
    executeItem: vi.fn(),
    executeActiveItem: vi.fn()
  })

  spotlightStore.closeSpotlight.mockImplementation(() => {
    spotlightStore.open = false
  })

  vi.doMock('@/stores/ui/spotlight', () => ({
    useSpotlightStore: () => spotlightStore
  }))

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({
      name: 'Icon',
      props: {
        icon: {
          type: String,
          default: ''
        }
      },
      template: '<i :data-icon="icon" />'
    })
  }))

  const SpotlightOverlay = (await import('@/components/spotlight/SpotlightOverlay.vue')).default
  document.body.innerHTML = ''
  const wrapper = mount(SpotlightOverlay, {
    attachTo: document.body,
    global: {
      plugins: [createPinia()]
    }
  })

  mounted.push(wrapper)
  await flushPromises()
  return {
    wrapper: new DOMWrapper(document.body),
    spotlightStore,
    resultItem
  }
}

describe('SpotlightOverlay', () => {
  it('marks the overlay as a no-drag region', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('.window-no-drag-region').exists()).toBe(true)
  })

  it('forwards input changes and immediate mouse selections to the spotlight store', async () => {
    const { wrapper, spotlightStore, resultItem } = await setup()

    await wrapper.get('input').setValue('deep')
    expect(spotlightStore.setQuery).toHaveBeenCalledWith('deep')

    await wrapper.get('[role=option]').trigger('mousedown', { button: 0 })
    expect(spotlightStore.executeItem).toHaveBeenCalledWith(resultItem)
  })

  it('exposes the active result and restores focus after closing search', async () => {
    const { wrapper, spotlightStore } = await setup(false)
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    spotlightStore.open = true
    await flushPromises()

    const input = wrapper.get('[role="combobox"]')
    const list = wrapper.get('[role="listbox"]')
    const option = wrapper.get('[role="option"]')
    expect(wrapper.get('[role="dialog"]').exists()).toBe(true)
    expect(input.attributes('aria-controls')).toBe(list.attributes('id'))
    expect(input.attributes('aria-activedescendant')).toBe(option.attributes('id'))
    expect(option.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(input.element)

    await wrapper.get('button[aria-label="common.close"]').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('refocuses the search input when spotlight is activated again', async () => {
    const { wrapper, spotlightStore } = await setup()

    const input = wrapper.get('input').element as HTMLInputElement
    input.blur()

    spotlightStore.activationKey += 1
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(input)
  })
})
