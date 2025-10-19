import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import MessageActionButtons from '@/components/message/MessageActionButtons.vue'

describe('MessageActionButtons', () => {
  it('emits events on clicks', async () => {
    const wrapper = mount(MessageActionButtons, {
      props: { showCleanButton: true, showScrollButton: true }
    })

    // Find buttons by their component type and index
    const buttons = wrapper.findAllComponents({ name: 'Button' })

    // First button should be clean (new-chat)
    await buttons[0].trigger('click')
    expect(wrapper.emitted().clean).toBeTruthy()

    // Second button should be scroll-to-bottom
    await buttons[1].trigger('click')
    expect(wrapper.emitted()['scroll-to-bottom']).toBeTruthy()
  })
})
