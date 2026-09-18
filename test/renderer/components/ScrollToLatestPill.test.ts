import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ScrollToLatestPill from '@/components/chat/ScrollToLatestPill.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

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

  it('carries an accessible name for the icon-only control', () => {
    const wrapper = mount(ScrollToLatestPill, { props: { visible: true } })

    expect(wrapper.get('[data-testid="scroll-to-latest-return"]').attributes('aria-label')).toBe(
      'chat.messages.scrollToLatest'
    )
  })
})
