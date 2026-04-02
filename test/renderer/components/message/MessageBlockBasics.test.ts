import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageBlockAction from '@/components/message/MessageBlockAction.vue'
import MessageBlockError from '@/components/message/MessageBlockError.vue'
import MessageBlockPlan from '@/components/message/MessageBlockPlan.vue'
import MessageBlockQuestionRequest from '@/components/message/MessageBlockQuestionRequest.vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<i class="icon-stub" />'
  })
}))

vi.mock('@shadcn/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>'
  })
}))

const createBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'action',
  status: 'success',
  timestamp: Date.now(),
  content: '',
  ...overrides
})

describe('MessageBlock basics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.electron = {
      ipcRenderer: {
        invoke: vi.fn()
      }
    } as never
  })

  it('emits continue for needContinue action', async () => {
    const wrapper = mount(MessageBlockAction, {
      props: {
        messageId: 'm1',
        conversationId: 's1',
        block: createBlock({
          extra: {
            needContinue: true
          },
          content: 'continue.prompt'
        })
      }
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('continue')).toEqual([['s1', 'm1']])
  })

  it('renders a compact rate limit status block', () => {
    const wrapper = mount(MessageBlockAction, {
      props: {
        messageId: 'm1',
        conversationId: 's1',
        block: createBlock({
          action_type: 'rate_limit',
          timestamp: Date.now()
        })
      }
    })

    expect(wrapper.find('[data-rate-limit-block="true"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('chat.messages.rateLimitCompactLoading')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('renders question request content and answer', () => {
    const wrapper = mount(MessageBlockQuestionRequest, {
      props: {
        block: createBlock({
          action_type: 'question_request',
          content: 'Question body',
          extra: {
            questionText: 'Pick one',
            questionOptions: [{ label: 'A', description: 'Option A' }, { label: 'B' }],
            answerText: 'A'
          }
        })
      }
    })

    expect(wrapper.text()).toContain('Pick one')
    expect(wrapper.text()).toContain('A')
    expect(wrapper.text()).toContain('B')
    expect(wrapper.text()).toContain('components.messageBlockQuestionRequest.answerLabel')
  })

  it('renders plan summary from plan entries', () => {
    const wrapper = mount(MessageBlockPlan, {
      props: {
        block: createBlock({
          type: 'plan',
          extra: {
            plan_entries: [{ status: 'completed' }, { status: 'pending' }]
          }
        })
      }
    })

    expect(wrapper.text()).toContain('plan.title')
    expect(wrapper.text()).toContain('1/2')
  })

  it('expands error details and explanation', async () => {
    const wrapper = mount(MessageBlockError, {
      props: {
        block: createBlock({
          type: 'error',
          content: 'HTTP 429 from upstream'
        })
      }
    })

    await wrapper.find('.group').trigger('click')

    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.text()).toContain('common.error.causeOfError')
    expect(wrapper.text()).toContain('common.error.error429')
  })
})
