import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import ScrollToLatestPill from '@/components/chat/ScrollToLatestPill.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const item = {
  id: 'm1',
  role: 'user' as const,
  text: 'a pending question',
  streaming: false,
  failed: false
}

describe('ScrollToLatestPill', () => {
  it('requests a return to the latest message when the pill body is activated', async () => {
    const wrapper = mount(ScrollToLatestPill, { props: { visible: true, count: 3 } })

    await wrapper.get('[data-testid="scroll-to-latest-return"]').trigger('click')

    expect(wrapper.emitted('return')).toHaveLength(1)
  })

  it('shows the below-viewport count only when there is one', () => {
    const withCount = mount(ScrollToLatestPill, { props: { visible: true, count: 7 } })
    expect(withCount.get('[data-testid="scroll-to-latest-count"]').text()).toBe('7')

    const withoutCount = mount(ScrollToLatestPill, { props: { visible: true, count: 0 } })
    expect(withoutCount.find('[data-testid="scroll-to-latest-count"]').exists()).toBe(false)
  })

  it('renders nothing while the viewport is at the bottom', () => {
    const wrapper = mount(ScrollToLatestPill, { props: { visible: false, count: 5 } })

    expect(wrapper.find('[data-testid="scroll-to-latest"]').exists()).toBe(false)
  })

  it('carries an accessible name for the icon-only controls', () => {
    const wrapper = mount(ScrollToLatestPill, { props: { visible: true } })

    expect(wrapper.get('[data-testid="scroll-to-latest-return"]').attributes('aria-label')).toBe(
      'chat.messages.scrollToLatest'
    )
    expect(wrapper.get('[data-testid="scroll-to-latest-expand"]').attributes('aria-label')).toBe(
      'chat.messages.expandNewerMessages'
    )
  })

  it('jumps to a chosen message from the preview list', async () => {
    const wrapper = mount(ScrollToLatestPill, {
      props: { visible: true, count: 1, items: [item] },
      attachTo: document.body
    })

    await wrapper.get('[data-testid="scroll-to-latest-expand"]').trigger('click')
    await nextTick()

    const row = document.querySelector<HTMLElement>('[data-testid="scroll-to-latest-item-m1"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain('a pending question')

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(wrapper.emitted('jump')).toEqual([['m1']])
    wrapper.unmount()
  })
})
