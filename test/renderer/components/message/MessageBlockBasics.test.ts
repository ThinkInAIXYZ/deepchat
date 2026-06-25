import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageBlockAction from '@/components/message/MessageBlockAction.vue'
import MessageBlockError from '@/components/message/MessageBlockError.vue'
import MessageBlockPlan from '@/components/message/MessageBlockPlan.vue'
import MessageBlockQuestionRequest from '@/components/message/MessageBlockQuestionRequest.vue'
import ChatToolInteractionOverlay from '@/components/chat/ChatToolInteractionOverlay.vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        'chat.workspace.plan.section': 'Plan',
        'chat.workspace.plan.completedCount': '{completed}/{total} completed',
        'chat.workspace.plan.empty': 'No tasks yet',
        'chat.workspace.plan.itemAriaLabel': '{status}: {step}',
        'chat.workspace.plan.status.completed': 'Completed',
        'chat.workspace.plan.status.in_progress': 'In Progress',
        'chat.workspace.plan.status.pending': 'Pending',
        'chat.workspace.plan.status.interrupted': 'Interrupted',
        'chat.skillDraft.confirmationTitle': 'Skill Draft',
        'chat.skillDraft.confirmationQuestion': '已生成 skill draft：{name}',
        'chat.skillDraft.actions.view': '查看内容',
        'chat.skillDraft.actions.install': '安装为 Skill',
        'chat.skillDraft.actions.discard': '丢弃',
        'chat.skillDraft.previewTitle': 'Draft content preview'
      }
      return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))
    }
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

  it('translates skill draft question keys with the draft name', () => {
    const wrapper = mount(MessageBlockQuestionRequest, {
      props: {
        block: createBlock({
          action_type: 'question_request',
          content: '',
          extra: {
            questionText: 'chat.skillDraft.confirmationQuestion',
            questionOptions: JSON.stringify([
              { label: 'chat.skillDraft.actions.view' },
              { label: 'chat.skillDraft.actions.install' },
              { label: 'chat.skillDraft.actions.discard' }
            ]),
            answerText: 'chat.skillDraft.actions.install',
            skillDraftName: 'draft-skill'
          }
        })
      }
    })

    expect(wrapper.text()).toContain('已生成 skill draft：draft-skill')
    expect(wrapper.text()).toContain('查看内容')
    expect(wrapper.text()).toContain('安装为 Skill')
    expect(wrapper.text()).toContain('丢弃')
  })

  it('renders skill draft preview and emits the raw action key from the overlay', async () => {
    const wrapper = mount(ChatToolInteractionOverlay, {
      props: {
        interaction: {
          messageId: 'm1',
          toolCallId: 'tc1',
          actionType: 'question_request',
          toolName: 'skill_manage',
          toolArgs: '{}',
          block: createBlock({
            action_type: 'question_request',
            status: 'pending',
            extra: {
              questionHeader: 'chat.skillDraft.confirmationTitle',
              questionText: 'chat.skillDraft.confirmationQuestion',
              questionOptions: [
                { label: 'chat.skillDraft.actions.install' },
                { label: 'chat.skillDraft.actions.discard' }
              ],
              questionCustom: false,
              skillDraftAction: 'confirm',
              skillDraftName: 'draft-skill',
              skillDraftPreview: '# Draft body'
            }
          })
        }
      }
    })

    expect(wrapper.text()).toContain('已生成 skill draft：draft-skill')
    expect(wrapper.text()).toContain('Draft content preview')
    expect(wrapper.text()).toContain('# Draft body')
    expect(wrapper.text()).toContain('安装为 Skill')

    const installButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('安装为 Skill'))
    expect(installButton).toBeTruthy()
    await installButton!.trigger('click')

    expect(wrapper.emitted('respond')).toEqual([
      [{ kind: 'question_option', optionLabel: 'chat.skillDraft.actions.install' }]
    ])
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
            plan_entries: [
              { step: 'Inspect runtime', status: 'completed' },
              { step: 'Write tests', status: 'pending' }
            ]
          }
        })
      }
    })

    expect(wrapper.text()).toContain('Plan')
    expect(wrapper.text()).toContain('1/2 completed')
    expect(wrapper.text()).toContain('Inspect runtime')
    expect(wrapper.text()).toContain('Write tests')
    expect(wrapper.find('[aria-label="Completed: Inspect runtime"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Pending: Write tests"]').exists()).toBe(true)
  })

  it('renders terminal in-progress plan entries without a spinner', () => {
    const wrapper = mount(MessageBlockPlan, {
      props: {
        block: createBlock({
          type: 'plan',
          extra: {
            plan_entries: [{ step: 'Write tests', status: 'in_progress' }],
            plan_terminal_reason: 'error'
          }
        })
      }
    })

    expect(wrapper.find('.animate-spin').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Interrupted: Write tests"]').exists()).toBe(true)
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
