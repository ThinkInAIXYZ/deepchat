import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive } from 'vue'
import { mount } from '@vue/test-utils'

const setup = async () => {
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
    open: true,
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
    attachTo: document.body
  })

  return {
    wrapper,
    spotlightStore,
    resultItem
  }
}

describe('SpotlightOverlay', () => {
  it('marks the overlay as a no-drag region', async () => {
    const { wrapper } = await setup()

    expect(wrapper.classes()).toContain('window-no-drag-region')
    expect(wrapper.find('.window-no-drag-region').exists()).toBe(true)
  })

  it('forwards input changes and immediate mouse selections to the spotlight store', async () => {
    const { wrapper, spotlightStore, resultItem } = await setup()

    await wrapper.get('input').setValue('deep')
    expect(spotlightStore.setQuery).toHaveBeenCalledWith('deep')

    await wrapper.get('button').trigger('mousedown', { button: 0 })
    expect(spotlightStore.executeItem).toHaveBeenCalledWith(resultItem)
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
