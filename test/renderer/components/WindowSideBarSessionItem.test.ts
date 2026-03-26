import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const createSession = (options?: {
  isPinned?: boolean
  status?: 'none' | 'working' | 'completed' | 'error'
}) => ({
  id: 'session-1',
  title: 'Session Title',
  agentId: 'deepchat',
  status: options?.status ?? ('none' as const),
  projectDir: '',
  providerId: 'provider-1',
  modelId: 'model-1',
  isPinned: options?.isPinned ?? false,
  isDraft: false,
  createdAt: 1,
  updatedAt: 1
})

const mountComponent = async (options?: {
  isPinned?: boolean
  status?: 'none' | 'working' | 'completed' | 'error'
  heroHidden?: boolean
  pinFeedbackMode?: 'pinning' | 'unpinning' | null
}) => {
  vi.resetModules()

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const WindowSideBarSessionItem = (await import('@/components/WindowSideBarSessionItem.vue'))
    .default

  const wrapper = mount(WindowSideBarSessionItem, {
    props: {
      session: createSession(options),
      active: false,
      region: options?.isPinned ? 'pinned' : 'grouped',
      heroHidden: options?.heroHidden ?? false,
      pinFeedbackMode: options?.pinFeedbackMode ?? null
    },
    global: {
      stubs: {
        Icon: true
      }
    }
  })

  return wrapper
}

describe('WindowSideBarSessionItem', () => {
  it('emits select when the list item is clicked', async () => {
    const wrapper = await mountComponent()

    await wrapper.find('.session-item').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([expect.objectContaining({ id: 'session-1' })])
  }, 10000)

  it('renders the correct pin action label for pinned and unpinned sessions', async () => {
    const unpinnedWrapper = await mountComponent({ isPinned: false })
    const pinnedWrapper = await mountComponent({ isPinned: true })

    const unpinnedPinButton = unpinnedWrapper.find('[aria-label="thread.actions.pin"]')
    const pinnedPinButton = pinnedWrapper.find('[aria-label="thread.actions.unpin"]')

    expect(unpinnedPinButton.exists()).toBe(true)
    expect(unpinnedPinButton.attributes('aria-pressed')).toBe('false')
    expect(pinnedPinButton.exists()).toBe(true)
    expect(pinnedPinButton.attributes('aria-pressed')).toBe('true')
  }, 10000)

  it('emits toggle-pin and delete with the session payload', async () => {
    const wrapper = await mountComponent()

    await wrapper.find('[aria-label="thread.actions.pin"]').trigger('click')
    await wrapper.find('[aria-label="thread.actions.delete"]').trigger('click')

    expect(wrapper.emitted('toggle-pin')?.[0]).toEqual([
      expect.objectContaining({ id: 'session-1' })
    ])
    expect(wrapper.emitted('delete')?.[0]).toEqual([expect.objectContaining({ id: 'session-1' })])
  }, 10000)

  it('applies the loading shimmer to the title without rendering loading text', async () => {
    const wrapper = await mountComponent({ status: 'working' })

    const title = wrapper.find('.session-title')
    const sheen = wrapper.find('.session-title__sheen')

    expect(title.classes()).toContain('session-title--loading')
    expect(sheen.exists()).toBe(true)
    expect(sheen.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.session-status-loading').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('common.loading')
    expect(wrapper.find('[aria-label="thread.actions.pin"]').exists()).toBe(true)
  }, 10000)

  it('exposes hero transition and pin feedback state on the rendered item', async () => {
    const wrapper = await mountComponent({
      isPinned: true,
      heroHidden: true,
      pinFeedbackMode: 'pinning'
    })

    const item = wrapper.find('.session-item')
    const pinButton = wrapper.find('.pin-button')

    expect(item.attributes('data-pin-fx')).toBe('pinning')
    expect(item.attributes('data-session-id')).toBe('session-1')
    expect(item.attributes('data-hero-hidden')).toBe('true')
    expect(pinButton.attributes('data-pin-fx')).toBe('pinning')
  }, 10000)
})
