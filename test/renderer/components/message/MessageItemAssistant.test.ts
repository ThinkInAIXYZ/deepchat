import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import MessageItemAssistant from '@/components/message/MessageItemAssistant.vue'
import type { DisplayAssistantMessage } from '@/components/chat/messageListItems'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@/stores/uiSettingsStore', () => ({
  useUiSettingsStore: () => ({})
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    isDark: false
  })
}))

vi.mock('@shadcn/components/ui/spinner', () => ({
  Spinner: defineComponent({
    name: 'Spinner',
    template: '<div data-testid="spinner" />'
  })
}))

vi.mock('@shadcn/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    template: '<button type="button"><slot /></button>'
  })
}))

vi.mock('@shadcn/components/ui/dialog', () => ({
  Dialog: defineComponent({
    name: 'Dialog',
    template: '<div><slot /></div>'
  }),
  DialogContent: defineComponent({
    name: 'DialogContent',
    template: '<div><slot /></div>'
  }),
  DialogDescription: defineComponent({
    name: 'DialogDescription',
    template: '<div><slot /></div>'
  }),
  DialogFooter: defineComponent({
    name: 'DialogFooter',
    template: '<div><slot /></div>'
  }),
  DialogHeader: defineComponent({
    name: 'DialogHeader',
    template: '<div><slot /></div>'
  }),
  DialogTitle: defineComponent({
    name: 'DialogTitle',
    template: '<div><slot /></div>'
  })
}))

vi.mock('@shadcn/components/ui/context-menu', () => ({
  ContextMenu: defineComponent({
    name: 'ContextMenu',
    template: '<div><slot /></div>'
  }),
  ContextMenuContent: defineComponent({
    name: 'ContextMenuContent',
    template: '<div><slot /></div>'
  }),
  ContextMenuItem: defineComponent({
    name: 'ContextMenuItem',
    template: '<div><slot /></div>'
  }),
  ContextMenuSeparator: defineComponent({
    name: 'ContextMenuSeparator',
    template: '<div />'
  }),
  ContextMenuTrigger: defineComponent({
    name: 'ContextMenuTrigger',
    template: '<div><slot /></div>'
  })
}))

const componentStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const createMessage = (
  status: 'sent' | 'pending' | 'error',
  content: DisplayAssistantMessage['content']
): DisplayAssistantMessage => ({
  id: 'm1',
  role: 'assistant',
  timestamp: 1,
  avatar: '',
  name: 'Assistant',
  model_name: 'GPT-4',
  model_id: 'gpt-4',
  model_provider: 'openai',
  status,
  error: '',
  usage: {
    context_usage: 0,
    tokens_per_second: 0,
    total_tokens: 0,
    generation_time: 0,
    first_token_time: 0,
    reasoning_start_time: 0,
    reasoning_end_time: 0,
    input_tokens: 0,
    output_tokens: 0
  },
  conversationId: 's1',
  is_variant: 0,
  orderSeq: 1,
  content
})

describe('MessageItemAssistant', () => {
  const global = {
    stubs: {
      ModelIcon: componentStub('ModelIcon'),
      MessageInfo: componentStub('MessageInfo'),
      MessageBlockContent: componentStub('MessageBlockContent'),
      MessageBlockThink: componentStub('MessageBlockThink'),
      MessageBlockToolCall: componentStub('MessageBlockToolCall'),
      MessageBlockError: componentStub('MessageBlockError'),
      MessageBlockQuestionRequest: componentStub('MessageBlockQuestionRequest'),
      MessageToolbar: componentStub('MessageToolbar'),
      MessageBlockAction: componentStub('MessageBlockAction'),
      MessageBlockImage: componentStub('MessageBlockImage'),
      MessageBlockAudio: componentStub('MessageBlockAudio'),
      MessageBlockPlan: componentStub('MessageBlockPlan')
    }
  }

  it('does not render a spinner for empty non-pending assistant messages', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('error', []),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(false)
  })

  it('renders a spinner for empty pending assistant messages', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', []),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(true)
  })

  it('renders a spinner for the currently displayed pending variant', async () => {
    const variant = {
      ...createMessage('pending', []),
      id: 'm1-variant',
      is_variant: 1
    }

    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: {
          ...createMessage('sent', []),
          variants: [variant]
        },
        isCapturingImage: false,
        useLegacyActions: true
      },
      global
    })

    wrapper.vm.handleAction('next')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(true)
  })
})
