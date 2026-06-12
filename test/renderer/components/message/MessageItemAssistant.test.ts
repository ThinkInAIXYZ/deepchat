import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import MessageItemAssistant from '@/components/message/MessageItemAssistant.vue'
import type {
  DisplayAssistantMessage,
  DisplayAssistantMessageBlock
} from '@/components/chat/messageListItems'

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
  updatedAt: 1,
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

const createVideoLikeImageBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'image',
  status: 'success',
  timestamp: 1,
  image_data: {
    data: 'https://example.com/sample.png',
    mimeType: 'image/png'
  },
  ...overrides
})

const createThinkingBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'reasoning_content',
  content: 'thinking',
  status: 'success',
  timestamp: 1,
  ...overrides
})

const createToolCallBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'tool_call',
  status: 'success',
  timestamp: 2,
  tool_call: {
    id: 'tc1',
    name: 'read_file'
  },
  ...overrides
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
      MessageBlockVideo: defineComponent({
        name: 'MessageBlockVideo',
        props: {
          block: {
            type: Object,
            required: false
          }
        },
        template: '<div data-testid="video-block" />'
      }),
      MessageBlockAudio: componentStub('MessageBlockAudio'),
      MessageBlockPlan: componentStub('MessageBlockPlan'),
      MessageBlockActivityGroup: defineComponent({
        name: 'MessageBlockActivityGroup',
        props: {
          blocks: {
            type: Array,
            required: true
          }
        },
        template:
          '<div data-testid="activity-group" :data-block-count="String(blocks.length)">activity</div>'
      })
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

  it('renders video blocks from legacy content urls', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [
          createVideoLikeImageBlock({
            content: 'https://example.com/media/generated-video.mp4?download=1',
            image_data: undefined
          })
        ]),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.find('[data-testid="video-block"]').exists()).toBe(true)
  })

  it('does not classify non-video urls as video blocks when extensions only appear in query text', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [
          createVideoLikeImageBlock({
            image_data: {
              data: 'https://example.com/assets/preview.png?redirect=.mp4',
              mimeType: 'image/png'
            }
          })
        ]),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.find('[data-testid="video-block"]').exists()).toBe(false)
  })

  it('groups completed assistant activity blocks after the turn is settled', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: false
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="activity-group"]').attributes('data-block-count')).toBe('2')
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(false)
  })

  it('does not group activity while the assistant message is pending', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: true
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(true)
  })

  it('does not group sent activity while the thread is still generating', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: true
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(true)
  })

  it('does not group pending activity when the thread is idle', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: false
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(true)
  })

  it('excludes internal tool calls from activity groups', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [
          createThinkingBlock(),
          createToolCallBlock({
            extra: {
              internalTool: true
            },
            tool_call: {
              id: 'tc-plan',
              name: 'update_plan'
            }
          })
        ]),
        isCapturingImage: false,
        isInGeneratingThread: false
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="activity-group"]').attributes('data-block-count')).toBe('1')
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(false)
  })
})
