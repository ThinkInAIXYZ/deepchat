import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    props: {
      icon: {
        type: String,
        required: true
      }
    },
    template: '<i :data-icon="icon" />'
  })
}))

vi.mock('@shadcn/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    inheritAttrs: false,
    props: {
      disabled: {
        type: Boolean,
        default: false
      },
      variant: {
        type: String,
        default: 'default'
      }
    },
    emits: ['click'],
    template:
      '<button type="button" :disabled="disabled" :data-variant="variant" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
  })
}))

vi.mock('@shadcn/components/ui/tooltip', () => ({
  Tooltip: defineComponent({
    name: 'Tooltip',
    template: '<div><slot /></div>'
  }),
  TooltipTrigger: defineComponent({
    name: 'TooltipTrigger',
    template: '<div><slot /></div>'
  }),
  TooltipContent: defineComponent({
    name: 'TooltipContent',
    template: '<div><slot /></div>'
  })
}))

describe('ChatInputToolbar', () => {
  it('switches from stop to send when draft input appears during generation', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        isGenerating: true,
        hasInput: false,
        sendDisabled: false
      }
    })

    expect(wrapper.find('[data-icon="lucide:square"]').exists()).toBe(true)

    await wrapper.setProps({ hasInput: true })

    expect(wrapper.find('[data-icon="lucide:arrow-up"]').exists()).toBe(true)
    expect(wrapper.find('[data-icon="lucide:square"]').exists()).toBe(false)
  })

  it('emits send after switching to draft mode while generating', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        isGenerating: true,
        hasInput: false,
        sendDisabled: false
      }
    })

    await wrapper.setProps({ hasInput: true })
    await wrapper.findAll('button')[1].trigger('click')

    expect(wrapper.emitted('send')).toEqual([[]])
    expect(wrapper.emitted('stop')).toBeUndefined()
  })
})
