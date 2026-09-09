import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DcButton from '@dc-ui/components/button/DcButton.vue'

describe('DcButton accessible name', () => {
  it('preserves an explicit accessible name and updates it with its caller', async () => {
    const wrapper = mount(DcButton, {
      props: { size: 'icon', label: 'Fallback' },
      attrs: { 'aria-label': 'Open workspace' }
    })

    expect(wrapper.get('button').attributes('aria-label')).toBe('Open workspace')
    await wrapper.setProps({ 'aria-label': 'Close workspace' })
    expect(wrapper.get('button').attributes('aria-label')).toBe('Close workspace')
    wrapper.unmount()
  })
})
