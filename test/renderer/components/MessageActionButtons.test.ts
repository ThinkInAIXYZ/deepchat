import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { h } from 'vue'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import MessageActionButtons from '@/components/message/MessageActionButtons.vue'

const mountMessageActionButtons = (props: InstanceType<typeof MessageActionButtons>['$props']) => {
  const provider = mount(TooltipProvider, {
    props: { delayDuration: 200 },
    slots: {
      default: () => h(MessageActionButtons, props)
    }
  })

  return provider.getComponent(MessageActionButtons)
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

describe('MessageActionButtons', () => {
  it('emits events on clicks', async () => {
    const wrapper = mountMessageActionButtons({
      showCleanButton: true,
      showScrollButton: true,
      showWorkspaceButton: true
    })

    // Find buttons by their component type and index
    const buttons = wrapper.findAll('button')

    // First button should be workspace
    await buttons[0].trigger('click')
    expect(wrapper.emitted()['open-workspace']).toBeTruthy()

    // Second button should be clean (new-chat)
    await buttons[1].trigger('click')
    expect(wrapper.emitted().clean).toBeTruthy()

    // Third button should be scroll-to-bottom
    await buttons[2].trigger('click')
    expect(wrapper.emitted()['scroll-to-bottom']).toBeTruthy()
  })
})
