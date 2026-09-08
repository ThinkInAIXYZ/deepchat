import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import FloatingButton from '../../../src/renderer/floating/FloatingButton.vue'

describe('Floating widget keyboard access', () => {
  it('opens from its button and returns focus after Escape without exposing the hidden layer', async () => {
    const api = {
      getSnapshot: vi.fn().mockResolvedValue({ expanded: false, activeCount: 0, sessions: [] }),
      onSnapshotUpdate: vi.fn(() => vi.fn()),
      setExpanded: vi.fn(),
      setHovering: vi.fn()
    }
    vi.stubGlobal('floatingButtonAPI', api)
    const wrapper = mount(FloatingButton, { props: { theme: 'light' }, attachTo: document.body })
    try {
      await flushPromises()
      const expand = wrapper.get('button[aria-expanded]')
      const panel = wrapper.get('#floating-task-panel')
      expect(document.activeElement).toBe(expand.element)
      expect(panel.attributes('inert')).toBeDefined()
      expand.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(api.setExpanded).toHaveBeenLastCalledWith(true)
      expect(expand.attributes('inert')).toBeDefined()
      expect(document.activeElement).toBe(panel.get('button').element)
      await panel.trigger('keydown', { key: 'Escape' })
      await flushPromises()
      expect(api.setExpanded).toHaveBeenLastCalledWith(false)
      expect(document.activeElement).toBe(expand.element)
      expect(panel.attributes('aria-hidden')).toBe('true')
    } finally {
      wrapper.unmount()
      vi.unstubAllGlobals()
    }
  })
})
