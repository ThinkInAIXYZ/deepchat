import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import MessageActionButtons from '@/components/message/MessageActionButtons.vue'

describe('MessageActionButtons', () => {
  it('emits events on clicks', async () => {
    const wrapper = mount(MessageActionButtons, {
      props: { showCleanButton: true, showScrollButton: true }
    })
    await wrapper.find('[key="new-chat"]').trigger('click')
    await wrapper.find('[key="scroll-bottom"]').trigger('click')

    expect(wrapper.emitted().clean).toBeTruthy()
    expect(wrapper.emitted()['scroll-to-bottom']).toBeTruthy()
  })
})