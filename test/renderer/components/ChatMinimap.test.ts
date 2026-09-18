import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import ChatMinimap from '@/components/chat/ChatMinimap.vue'
import type { MinimapTick } from '@/features/chat-page/model/minimapTicks'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const ticks: MinimapTick[] = [
  { id: 'm1', top: 0, height: 0.2, width: 1 },
  { id: 'm2', top: 0.2, height: 0.2, width: 0.5 },
  { id: 'm3', top: 0.4, height: 0.6, width: 0.25 }
]

const railHeight = 200

async function mountRail(props: Partial<InstanceType<typeof ChatMinimap>['$props']> = {}) {
  const wrapper = mount(ChatMinimap, {
    props: {
      visible: true,
      ticks,
      viewport: { top: 0.2, height: 0.2 },
      previewText: 'the hovered message',
      ...props
    }
  })
  const rail = wrapper.get('[data-testid="chat-minimap-rail"]').element as HTMLElement
  // jsdom reports a zero-sized rect, which would make every position collapse onto the top.
  rail.getBoundingClientRect = () =>
    ({ top: 0, left: 0, bottom: railHeight, right: 40, width: 40, height: railHeight }) as DOMRect
  return { wrapper, rail }
}

// jsdom has no PointerEvent, and the rail only reads clientY, so a MouseEvent carries the position.
function pointerAtPx(rail: HTMLElement, offsetY: number, type = 'pointermove') {
  rail.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY: offsetY }))
}

function marks(wrapper: Awaited<ReturnType<typeof mountRail>>['wrapper']) {
  return wrapper.findAll('[data-testid="chat-minimap-mark"]')
}

describe('ChatMinimap', () => {
  it('draws one hairline mark per message, widest for the longest', async () => {
    const { wrapper } = await mountRail()
    const drawn = marks(wrapper)

    expect(drawn).toHaveLength(ticks.length)
    // 40 px full width, scaled by each mark's width fraction, never below a hairline.
    expect(drawn[0].attributes('style')).toContain('width: 40px')
    expect(drawn[1].attributes('style')).toContain('width: 20px')
    expect(drawn[2].attributes('style')).toContain('width: 10px')
  })

  it('spaces the marks evenly instead of following the message heights', async () => {
    // The ticks deliberately span very different fractions of the conversation; the rail ignores
    // that and stacks them on a fixed pitch.
    const { wrapper } = await mountRail()
    const drawn = marks(wrapper)

    expect(drawn[0].attributes('style')).toContain('top: 0px')
    expect(drawn[1].attributes('style')).toContain('top: 16px')
    expect(drawn[2].attributes('style')).toContain('top: 32px')
  })

  it('scrolls its own content once the marks no longer fit', async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      id: `m${index}`,
      top: index / 60,
      height: 1 / 60,
      width: 1
    }))
    const { wrapper } = await mountRail({ ticks: many })

    const content = wrapper.get('[data-testid="chat-minimap-rail"] > div')
    expect(content.attributes('style')).toContain('height: 960px')
    expect(wrapper.get('[data-testid="chat-minimap-rail"]').classes()).toContain('overflow-y-auto')
  })

  it('keeps every mark dim until one is hovered', async () => {
    const { wrapper } = await mountRail()

    expect(marks(wrapper)[0].classes()).toContain('bg-muted-foreground/50')

    await wrapper.get('[data-testid="chat-minimap-rail"]').trigger('pointermove', { clientY: 5 })

    expect(marks(wrapper)[0].classes()).toContain('bg-foreground')
    expect(marks(wrapper)[1].classes()).toContain('bg-muted-foreground/50')
  })

  it('reports the hovered message so the parent can project its text', async () => {
    const { wrapper, rail } = await mountRail()

    pointerAtPx(rail, 40)
    expect(wrapper.emitted('hover')?.at(-1)).toEqual(['m3'])

    // Moving within the same slot must not re-emit.
    pointerAtPx(rail, 41)
    expect(wrapper.emitted('hover')).toHaveLength(1)

    pointerAtPx(rail, 5)
    expect(wrapper.emitted('hover')?.at(-1)).toEqual(['m1'])

    pointerAtPx(rail, 5, 'pointerleave')
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
  })

  it('treats the space between two marks as belonging to a mark', async () => {
    const { wrapper, rail } = await mountRail()

    // y=14 is the gap under the first mark; it resolves to that mark rather than to nothing.
    pointerAtPx(rail, 14)
    expect(wrapper.emitted('hover')?.at(-1)).toEqual(['m1'])
  })

  it('shows the preview card for the hovered message', async () => {
    const { wrapper, rail } = await mountRail()
    const card = () => document.querySelector('[data-testid="chat-minimap-preview"]')

    expect(card()).toBeNull()

    pointerAtPx(rail, 5)
    await nextTick()

    // The popover portals to the body, so it is not inside the component's own tree.
    expect(card()?.textContent).toBe('the hovered message')
    // Only a few lines are shown: the card is a thumbnail, not a second copy of the message.
    expect(card()?.className).toContain('line-clamp-4')

    wrapper.unmount()
  })

  it('renders nothing while the conversation fits the viewport', () => {
    const wrapper = mount(ChatMinimap, {
      props: { visible: false, ticks, viewport: null, previewText: null }
    })

    expect(wrapper.find('[data-testid="chat-minimap"]').exists()).toBe(false)
  })

  it('jumps to the message under the click', async () => {
    const { wrapper, rail } = await mountRail()

    pointerAtPx(rail, 5, 'click')
    expect(wrapper.emitted('jump')).toEqual([['m1']])

    pointerAtPx(rail, 40, 'click')
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
