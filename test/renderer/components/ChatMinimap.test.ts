import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ChatMinimap from '@/components/chat/ChatMinimap.vue'
import type { MinimapTick } from '@/features/chat-page/model/minimapTicks'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const ticks: MinimapTick[] = [
  { id: 'm1', top: 0, height: 0.2, role: 'user' },
  { id: 'm2', top: 0.2, height: 0.2, role: 'assistant' },
  { id: 'm3', top: 0.4, height: 0.6, role: 'assistant' }
]

const railHeight = 200

async function mountRail(props: Partial<InstanceType<typeof ChatMinimap>['$props']> = {}) {
  const wrapper = mount(ChatMinimap, {
    props: { visible: true, ticks, viewport: { top: 0.2, height: 0.2 }, ...props }
  })
  const rail = wrapper.get('[data-testid="chat-minimap-rail"]').element as HTMLElement
  // jsdom reports a zero-sized rect, which would make every position collapse onto the top.
  rail.getBoundingClientRect = () =>
    ({ top: 0, left: 0, bottom: railHeight, right: 10, width: 10, height: railHeight }) as DOMRect
  return { wrapper, rail }
}

async function clickRailAt(rail: HTMLElement, fraction: number) {
  rail.dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientY: fraction * railHeight, clientX: 5 })
  )
  await Promise.resolve()
}

describe('ChatMinimap', () => {
  it('draws one mark per message plus the visible window', async () => {
    const { wrapper } = await mountRail()

    expect(wrapper.findAll('[aria-hidden="true"]')).toHaveLength(ticks.length + 1)
    expect(wrapper.get('[data-testid="chat-minimap-window"]').attributes('style')).toContain(
      'top: 20%'
    )
  })

  it('renders nothing while the conversation fits the viewport', () => {
    const wrapper = mount(ChatMinimap, { props: { visible: false, ticks, viewport: null } })

    expect(wrapper.find('[data-testid="chat-minimap"]').exists()).toBe(false)
  })

  it('jumps to the message under the click', async () => {
    const { wrapper, rail } = await mountRail()

    await clickRailAt(rail, 0.1)
    expect(wrapper.emitted('jump')).toEqual([['m1']])

    await clickRailAt(rail, 0.8)
    expect(wrapper.emitted('jump')?.[1]).toEqual(['m3'])
  })

  it('walks the marks with the arrow keys and jumps to either end with Home/End', async () => {
    const { wrapper } = await mountRail()
    const rail = wrapper.get('[data-testid="chat-minimap-rail"]')

    // The window sits on m2, so stepping down reaches m3 and stepping up reaches m1.
    await rail.trigger('keydown', { key: 'ArrowDown' })
    await rail.trigger('keydown', { key: 'ArrowUp' })
    await rail.trigger('keydown', { key: 'Home' })
    await rail.trigger('keydown', { key: 'End' })

    expect(wrapper.emitted('jump')).toEqual([['m3'], ['m1'], ['m1'], ['m3']])
  })

  it('reports the reading position as a slider value', async () => {
    const { wrapper } = await mountRail()

    const rail = wrapper.get('[data-testid="chat-minimap-rail"]')
    expect(rail.attributes('role')).toBe('slider')
    expect(rail.attributes('aria-label')).toBe('chat.messages.minimap')
    expect(rail.attributes('aria-valuenow')).toBe('2')
    expect(rail.attributes('aria-valuemax')).toBe('3')
  })
})
