import { defineComponent } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@shadcn/components/ui/context-menu'

const Fixture = defineComponent({
  components: { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger },
  emits: ['select'],
  template: `<ContextMenu>
    <ContextMenuTrigger as-child><button>Local file</button></ContextMenuTrigger>
    <ContextMenuContent><ContextMenuItem @select="$emit('select')">Insert path</ContextMenuItem></ContextMenuContent>
  </ContextMenu>`
})

describe('Context menu keyboard access', () => {
  it.each([{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }])(
    'opens and activates an action with $key',
    async (keyboard) => {
      HTMLElement.prototype.scrollIntoView = vi.fn()
      const wrapper = mount(Fixture, { attachTo: document.body })
      try {
        const trigger = wrapper.get('button')
        trigger.element.focus()
        await trigger.trigger('keydown', keyboard)
        await flushPromises()
        const menu = new DOMWrapper(document.body).get('[role="menuitem"]')
        expect(menu.text()).toBe('Insert path')
        await menu.trigger('keydown', { key: 'Enter' })
        await flushPromises()
        expect(wrapper.emitted('select')).toHaveLength(1)
        await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element))
      } finally {
        wrapper.unmount()
      }
    }
  )
})
