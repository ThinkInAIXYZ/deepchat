import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({ props: ['icon'], template: '<span :data-icon="icon" />' })
}))
vi.mock('@shadcn/components/ui/popover', () => ({
  Popover: defineComponent({ template: '<div><slot /></div>' }),
  PopoverTrigger: defineComponent({ template: '<div><slot /></div>' }),
  PopoverContent: defineComponent({ template: '<div data-testid="popover-content"><slot /></div>' })
}))

import ReferenceChip from '@/components/chat/ReferenceChip.vue'

describe('ReferenceChip', () => {
  it('allows message shortcuts through read-only references but isolates editor nodes', async () => {
    const wrapper = mount(ReferenceChip, {
      props: { kind: 'file', label: 'src/App.vue', source: '/repo/src/App.vue' },
      attachTo: document.body
    })
    const shortcut = vi.fn()
    window.addEventListener('keydown', shortcut)
    try {
      await wrapper
        .get('button[aria-label="common.preview src/App.vue"]')
        .trigger('keydown', { key: 'f', metaKey: true })
      expect(shortcut).toHaveBeenCalledTimes(1)
      await wrapper.setProps({ removable: true })
      await wrapper
        .get('button[aria-label="common.preview src/App.vue"]')
        .trigger('keydown', { key: 'Enter' })
      expect(shortcut).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', shortcut)
      wrapper.unmount()
    }
  })

  it('opens the source popover without opening the target until Open is chosen', async () => {
    const wrapper = mount(ReferenceChip, {
      props: { kind: 'file', label: 'src/App.vue', source: '/repo/src/App.vue' }
    })

    await wrapper.get('button[aria-label="common.preview src/App.vue"]').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(wrapper.get('[data-testid="popover-content"]').text()).toContain('/repo/src/App.vue')

    await wrapper.get('[data-testid="popover-content"] button').trigger('click')
    expect(wrapper.emitted('open')).toEqual([[]])
  })

  it('removes a reference only through its explicit remove control', async () => {
    const wrapper = mount(ReferenceChip, {
      props: {
        kind: 'session',
        label: 'Source',
        source: 'session-1',
        removable: true
      }
    })

    await wrapper.get('button[aria-label="common.preview Source"]').trigger('click')
    expect(wrapper.emitted('remove')).toBeUndefined()
    await wrapper.get('button[aria-label="common.delete Source"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([[]])
  })
})
