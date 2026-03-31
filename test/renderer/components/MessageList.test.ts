import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import type { DisplayMessage } from '@/components/chat/messageListItems'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === 'chat.compaction.compacting') return '正在自动压缩...'
      if (key === 'chat.compaction.compacted') return '上下文已自动压缩'
      return key
    }
  })
}))

vi.mock('@/components/message/MessageItemUser.vue', () => ({
  default: defineComponent({
    name: 'MessageItemUser',
    props: {
      message: {
        type: Object,
        required: true
      },
      isReadOnly: {
        type: Boolean,
        default: false
      }
    },
    template: '<div class="user-item" :data-read-only="String(isReadOnly)">{{ message.id }}</div>'
  })
}))

vi.mock('@/components/message/MessageItemAssistant.vue', () => ({
  default: defineComponent({
    name: 'MessageItemAssistant',
    props: {
      message: {
        type: Object,
        required: true
      },
      isReadOnly: {
        type: Boolean,
        default: false
      }
    },
    template:
      '<div class="assistant-item" :data-read-only="String(isReadOnly)">{{ message.id }}</div>'
  })
}))

vi.mock('@/composables/message/useMessageCapture', () => ({
  useMessageCapture: () => ({
    isCapturing: false,
    captureMessage: vi.fn().mockResolvedValue(undefined)
  })
}))

import MessageList from '@/components/chat/MessageList.vue'

function createMessage(id: string, role: 'user' | 'assistant', orderSeq: number): DisplayMessage {
  return {
    id,
    role,
    orderSeq,
    content:
      role === 'user'
        ? {
            text: id,
            files: [],
            links: [],
            search: false,
            think: false
          }
        : [],
    timestamp: orderSeq,
    avatar: '',
    name: role === 'user' ? 'You' : 'Assistant',
    model_name: '',
    model_id: '',
    model_provider: '',
    status: 'sent',
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
    messageType: 'normal',
    summaryUpdatedAt: null
  }
}

function createCompactionMessage(
  id: string,
  orderSeq: number,
  status: 'compacting' | 'compacted'
): DisplayMessage {
  return {
    ...createMessage(id, 'assistant', orderSeq),
    messageType: 'compaction',
    compactionStatus: status
  }
}

describe('MessageList', () => {
  it('renders persisted compaction messages inline with the message list', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [
          createMessage('u1', 'user', 1),
          createMessage('a1', 'assistant', 2),
          createCompactionMessage('c1', 3, 'compacted'),
          createMessage('u2', 'user', 4)
        ]
      }
    })

    expect(wrapper.find('[data-compaction-indicator="true"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('上下文已自动压缩')
    expect(wrapper.text()).toContain('u1')
    expect(wrapper.text()).toContain('a1')
    expect(wrapper.text()).toContain('u2')
  })

  it('switches inline compaction copy between compacting and compacted', () => {
    const compactingWrapper = mount(MessageList, {
      props: {
        messages: [createCompactionMessage('c1', 1, 'compacting')]
      }
    })
    expect(compactingWrapper.text()).toContain('正在自动压缩...')
    expect(compactingWrapper.find('[data-compaction-indicator="true"]').attributes()).toMatchObject(
      {
        'data-compaction-status': 'compacting'
      }
    )
    expect(compactingWrapper.find('.compaction-divider__label--compacting').exists()).toBe(true)

    const compactedWrapper = mount(MessageList, {
      props: {
        messages: [createCompactionMessage('c1', 1, 'compacted')]
      }
    })
    expect(compactedWrapper.text()).toContain('上下文已自动压缩')
    expect(compactedWrapper.find('[data-compaction-indicator="true"]').attributes()).toMatchObject({
      'data-compaction-status': 'compacted'
    })
    expect(compactedWrapper.find('.compaction-divider__label--compacting').exists()).toBe(false)
  })

  it('passes read-only state down to message items', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('u1', 'user', 1), createMessage('a1', 'assistant', 2)],
        isReadOnly: true
      }
    })

    expect(wrapper.find('.user-item').attributes('data-read-only')).toBe('true')
    expect(wrapper.find('.assistant-item').attributes('data-read-only')).toBe('true')
  })
})
