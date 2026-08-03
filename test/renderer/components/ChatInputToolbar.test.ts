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
  it('switches from stop to queue when draft input appears during generation', async () => {
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

    expect(wrapper.find('[data-icon="lucide:list-plus"]').exists()).toBe(true)
    expect(wrapper.find('[data-icon="lucide:square"]').exists()).toBe(false)
  })

  it('emits queue after switching to draft mode while generating', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        isGenerating: true,
        hasInput: false,
        sendDisabled: false,
        queueDisabled: false
      }
    })

    await wrapper.setProps({ hasInput: true })
    await wrapper.get('[data-testid="chat-queue-button"]').trigger('click')

    expect(wrapper.emitted('queue')).toEqual([[]])
    expect(wrapper.emitted('stop')).toBeUndefined()
  })

  it('shows a separate steer button while generating with input', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        isGenerating: true,
        hasInput: true,
        sendDisabled: false,
        queueDisabled: false
      }
    })

    await wrapper.get('[data-testid="chat-steer-button"]').trigger('click')

    expect(wrapper.find('[data-icon="lucide:compass"]').exists()).toBe(true)
    expect(wrapper.emitted('steer')).toEqual([[]])
  })

  it('cancels steer attachment preparation without stopping the active generation', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        isGenerating: true,
        hasInput: true,
        isPreparingAttachments: true,
        sendDisabled: true,
        queueDisabled: true
      }
    })

    const primaryButton = wrapper.get('[data-testid="chat-cancel-preparation-button"]')
    expect((primaryButton.element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.find('[data-icon="lucide:square"]').exists()).toBe(true)

    await primaryButton.trigger('click')
    expect(wrapper.emitted('cancel-preparation')).toEqual([[]])
    expect(wrapper.emitted('stop')).toBeUndefined()
    expect(wrapper.emitted('queue')).toBeUndefined()
  })

  it('keeps an active voice input stoppable while attachments are being prepared', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        showVoiceInput: true,
        isVoiceInputListening: true,
        isPreparingAttachments: true
      }
    })

    const voiceButton = wrapper.get('[data-testid="chat-voice-input-button"]')
    expect((voiceButton.element as HTMLButtonElement).disabled).toBe(false)

    await voiceButton.trigger('click')
    expect(wrapper.emitted('voice-input')).toEqual([[]])
  })

  it('disables steer when the active turn cannot be interrupted', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        isGenerating: true,
        hasInput: true,
        steerDisabled: true
      }
    })

    const steerButton = wrapper.get('[data-testid="chat-steer-button"]')
    expect(steerButton.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('chat.pendingInput.steerUnavailable')

    await steerButton.trigger('click')
    expect(wrapper.emitted('steer')).toBeUndefined()
  })

  it('renders progress and blocks repeated stop clicks while pending', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        isGenerating: true,
        hasInput: false,
        isStopping: true
      }
    })

    const stopButton = wrapper.get('[data-testid="chat-stop-button"]')
    expect(stopButton.attributes('disabled')).toBeDefined()
    expect(stopButton.attributes('aria-busy')).toBe('true')
    expect(stopButton.find('[role="status"]').exists()).toBe(true)

    await stopButton.trigger('click')
    expect(wrapper.emitted('stop')).toBeUndefined()
  })

  it('emits voice-input and switches icon while listening', async () => {
    const ChatInputToolbar = (await import('@/components/chat/ChatInputToolbar.vue')).default
    const wrapper = mount(ChatInputToolbar, {
      props: {
        showVoiceInput: true,
        isVoiceInputListening: false
      }
    })

    await wrapper.get('[data-testid="chat-voice-input-button"]').trigger('click')
    expect(wrapper.emitted('voice-input')).toEqual([[]])

    await wrapper.setProps({ isVoiceInputListening: true })
    expect(wrapper.find('[data-testid="chat-voice-recording-wave"]').exists()).toBe(true)
  })
})
