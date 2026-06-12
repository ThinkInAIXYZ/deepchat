import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import ChatSearchBar from '@/components/chat/ChatSearchBar.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

describe('ChatSearchBar', () => {
  it('focuses and selects the input through the exposed API', async () => {
    const wrapper = mount(ChatSearchBar, {
      attachTo: document.body,
      props: {
        modelValue: 'hello',
        activeMatch: 0,
        totalMatches: 1
      },
      global: {
        stubs: {
          Icon: true,
          Button: defineComponent({
            name: 'Button',
            template: '<button type="button"><slot /></button>'
          })
        }
      }
    })

    const input = wrapper.get('input').element as HTMLInputElement
    input.setSelectionRange(0, 0)

    ;(wrapper.vm as { selectInput: () => void }).selectInput()
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)

    wrapper.unmount()
  })
})
