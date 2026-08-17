import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import type {
  DisplayAssistantMessageBlock,
  DisplayMessage
} from '@/features/chat-page/model/displayMessage'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === 'chat.compaction.compacting') return '正在压缩上下文...'
      if (key === 'chat.compaction.compacted') return '上下文已压缩'
      if (key === 'chat.compaction.compactedWithoutSummary') return '上下文已压缩，但未生成摘要'
      if (key === 'chat.compaction.compactedWithoutLargerSummary') {
        return '上下文已压缩，未采用更大的摘要'
      }
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
      },
      isInGeneratingThread: {
        type: Boolean,
        default: false
      },
      isStreamingMessage: {
        type: Boolean,
        default: false
      },
      disableMarkdownVirtualization: {
        type: Boolean,
        default: false
      },
      allowGuardStopContinue: {
        type: Boolean,
        default: true
      }
    },
    template:
      '<div class="assistant-item" :data-read-only="String(isReadOnly)" :data-generating="String(isInGeneratingThread)" :data-streaming="String(isStreamingMessage)" :data-disable-markdown-virtualization="String(disableMarkdownVirtualization)" :data-allow-guard-stop-continue="String(allowGuardStopContinue)">{{ message.id }}</div>'
  })
}))

vi.mock('@/components/message/MessageBlockAction.vue', () => ({
  default: defineComponent({
    name: 'MessageBlockAction',
    props: {
      block: {
        type: Object,
        required: true
      }
    },
    template: '<div class="rate-limit-block-stub">{{ block.action_type || "unknown" }}</div>'
  })
}))

const { captureMessageMock, isCapturingRef } = vi.hoisted(() => ({
  captureMessageMock: vi.fn().mockResolvedValue(undefined),
  isCapturingRef: { current: undefined as undefined | import('vue').Ref<boolean> }
}))

vi.mock('@/composables/message/useMessageCapture', async () => {
  const { ref } = await import('vue')
  const isCapturing = ref(false)
  isCapturingRef.current = isCapturing
  return {
    useMessageCapture: () => ({
      isCapturing,
      captureMessage: captureMessageMock
    })
  }
})

import MessageList from '@/components/chat/MessageList.vue'
import MessageListRow from '@/components/chat/MessageListRow.vue'

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
    updatedAt: orderSeq,
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
  status: 'compacting' | 'compacted',
  boundaryReason?: 'summary_unavailable' | 'summary_rejected_larger'
): DisplayMessage {
  return {
    ...createMessage(id, 'assistant', orderSeq),
    messageType: 'compaction',
    compactionStatus: status,
    compactionBoundaryReason: boundaryReason
  }
}

describe('MessageList', () => {
  beforeEach(() => {
    captureMessageMock.mockClear()
    if (isCapturingRef.current) {
      isCapturingRef.current.value = false
    }
  })

  it('exposes a stable origin before the bounded message window', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('u1', 'user', 1)],
        beforeSpacerHeight: 320,
        afterSpacerHeight: 640
      }
    })

    const origin = wrapper.get('[data-message-window-origin]')
    expect(origin.attributes('aria-hidden')).toBe('true')
    expect(origin.element.nextElementSibling?.getAttribute('style')).toContain('height: 320px')
  })

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
    expect(wrapper.text()).toContain('上下文已压缩')
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
    expect(compactingWrapper.text()).toContain('正在压缩上下文...')
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
    expect(compactedWrapper.text()).toContain('上下文已压缩')
    expect(compactedWrapper.find('[data-compaction-indicator="true"]').attributes()).toMatchObject({
      'data-compaction-status': 'compacted'
    })
    expect(compactedWrapper.find('.compaction-divider__label--compacting').exists()).toBe(false)
  })

  it.each([
    ['summary_unavailable', '上下文已压缩，但未生成摘要'],
    ['summary_rejected_larger', '上下文已压缩，未采用更大的摘要']
  ] as const)('renders the persisted boundary-only reason %s', (reason, expectedCopy) => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createCompactionMessage('c1', 1, 'compacted', reason)]
      }
    })

    expect(wrapper.text()).toContain(expectedCopy)
    expect(wrapper.get('[data-compaction-indicator="true"]').attributes()).toMatchObject({
      'data-compaction-boundary-reason': reason
    })
  })

  it('provides entrance feedback for an optimistic user message in a batched send', async () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: []
      }
    })

    await wrapper.setProps({
      messages: [createMessage('u1', 'user', 1), createMessage('a1', 'assistant', 2)]
    })

    const userRow = wrapper.find('[data-message-id="u1"]')
    expect(userRow.attributes('data-entrance-feedback')).toBe('true')
    expect(
      wrapper.find('[data-message-id="a1"]').attributes('data-entrance-feedback')
    ).toBeUndefined()

    await userRow.trigger('animationend', { animationName: 'message-row-in' })
    expect(userRow.attributes('data-entrance-feedback')).toBeUndefined()
  })

  it('does not animate historical messages after replacing the messages collection', async () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('u1', 'user', 1), createMessage('a1', 'assistant', 2)]
      }
    })

    await wrapper.setProps({
      messages: [
        createMessage('u2', 'user', 1),
        createMessage('a2', 'assistant', 2),
        createMessage('u3', 'user', 3)
      ]
    })

    expect(wrapper.find('[data-message-id="u3"]').classes()).not.toContain('message-row-entrance')
  })

  it('marks only the streaming assistant message as streaming', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [
          createMessage('u1', 'user', 1),
          createMessage('a1', 'assistant', 2),
          createMessage('a2', 'assistant', 3)
        ],
        isGenerating: true,
        streamingMessageId: 'a2'
      }
    })

    const assistants = wrapper.findAll('.assistant-item')
    expect(assistants[0].attributes('data-streaming')).toBe('false')
    expect(assistants[1].attributes('data-streaming')).toBe('true')
    // Thread-level generating still reaches every row for action gating.
    expect(assistants[0].attributes('data-generating')).toBe('true')
    expect(assistants[1].attributes('data-generating')).toBe('true')
  })

  it('does not mark assistant messages as streaming without a matching stream id', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('a1', 'assistant', 1)],
        streamingMessageId: null
      }
    })

    expect(wrapper.find('.assistant-item').attributes('data-streaming')).toBe('false')
    expect(wrapper.find('.assistant-item').attributes('data-generating')).toBe('false')
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

  it('renders an ephemeral rate-limit block without creating an assistant item', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('u1', 'user', 1)],
        conversationId: 's1',
        ephemeralRateLimitMessageId: '__rate_limit__:s1:1',
        ephemeralRateLimitBlock: {
          type: 'action',
          action_type: 'rate_limit',
          status: 'pending',
          timestamp: 1
        } satisfies DisplayAssistantMessageBlock
      }
    })

    expect(wrapper.find('[data-rate-limit-indicator="true"]').exists()).toBe(true)
    expect(wrapper.find('.rate-limit-block-stub').text()).toBe('rate_limit')
    expect(wrapper.findAll('.assistant-item')).toHaveLength(0)
  })

  it('resolves screenshot parents lazily through the supplied resolver', async () => {
    const resolveCaptureParentId = vi.fn(() => 'u1')
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('a1', 'assistant', 2)],
        resolveCaptureParentId
      }
    })

    wrapper.findComponent(MessageListRow).vm.$emit('copyImage', 'a1', undefined, true, {
      model_name: 'model-1',
      model_provider: 'provider-1'
    })
    await wrapper.vm.$nextTick()

    expect(resolveCaptureParentId).toHaveBeenCalledWith('a1', undefined)
    expect(captureMessageMock).toHaveBeenCalledWith({
      messageId: 'a1',
      parentId: 'u1',
      fromTop: true,
      modelInfo: { model_name: 'model-1', model_provider: 'provider-1' }
    })
  })

  it('passes markdown virtualization disable state to assistant rows', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('a1', 'assistant', 1)],
        disableMarkdownVirtualization: true
      }
    })

    expect(wrapper.find('.assistant-item').attributes('data-disable-markdown-virtualization')).toBe(
      'true'
    )
  })

  it('disables markdown virtualization while capturing message screenshots', () => {
    if (isCapturingRef.current) {
      isCapturingRef.current.value = true
    }

    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('a1', 'assistant', 1)]
      }
    })

    expect(wrapper.find('.assistant-item').attributes('data-disable-markdown-virtualization')).toBe(
      'true'
    )
  })

  it('does not enable Continue on a visible older assistant when the newest is outside the window', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('u1', 'user', 1), createMessage('assistant-old', 'assistant', 2)],
        latestAssistantMessageId: 'assistant-new'
      }
    })

    expect(wrapper.find('.assistant-item').text()).toBe('assistant-old')
    expect(wrapper.find('.assistant-item').attributes('data-allow-guard-stop-continue')).toBe(
      'false'
    )
  })

  it('does not enable Continue when the parent explicitly has no latest assistant', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [createMessage('assistant-old', 'assistant', 1)],
        latestAssistantMessageId: null
      }
    })

    expect(wrapper.find('.assistant-item').attributes('data-allow-guard-stop-continue')).toBe(
      'false'
    )
  })
})
