import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageBlockAction from '@/components/message/MessageBlockAction.vue'
import MessageBlockError from '@/components/message/MessageBlockError.vue'
import MessageBlockQuestionRequest from '@/components/message/MessageBlockQuestionRequest.vue'
import ChatToolInteractionOverlay from '@/components/chat/ChatToolInteractionOverlay.vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
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

vi.mock('@dc-ui/components/button', () => ({
  DcButton: defineComponent({
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

  const createPermissionBlock = (
    status: DisplayAssistantMessageBlock['status'],
    overrides: Partial<DisplayAssistantMessageBlock> = {}
  ): DisplayAssistantMessageBlock =>
    createBlock({
      action_type: 'tool_call_permission',
      status,
      tool_call: { id: 'tc1', name: 'run_command' },
      ...overrides
    })

  it('renders granted permission outcome instead of the generic continued label', () => {
    const wrapper = mount(MessageBlockAction, {
      props: {
        messageId: 'm1',
        conversationId: 's1',
        block: createPermissionBlock('granted')
      }
    })

    const label = wrapper.find('[data-testid="permission-resolved-label"]')
    expect(label.exists()).toBe(true)
    expect(label.attributes('data-permission-status')).toBe('granted')
    expect(wrapper.text()).toContain('components.messageBlockPermissionRequest.granted')
    expect(wrapper.text()).not.toContain('components.messageBlockAction.continued')
  })

  it('renders denied permission outcome without any success affordance', () => {
    const wrapper = mount(MessageBlockAction, {
      props: {
        messageId: 'm1',
        conversationId: 's1',
        block: createPermissionBlock('denied', { content: 'User denied the request.' })
      }
    })

    const label = wrapper.find('[data-testid="permission-resolved-label"]')
    expect(label.attributes('data-permission-status')).toBe('denied')
    expect(wrapper.text()).toContain('components.messageBlockPermissionRequest.denied')
    expect(wrapper.text()).not.toContain('components.messageBlockAction.continued')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('keeps denied rendering identical in read-only history', () => {
    const wrapper = mount(MessageBlockAction, {
      props: {
        messageId: 'm1',
        conversationId: 's1',
        isReadOnly: true,
        block: createPermissionBlock('denied')
      }
    })

    expect(
      wrapper.find('[data-testid="permission-resolved-label"]').attributes('data-permission-status')
    ).toBe('denied')
  })

  it('does not mark pending permission requests as resolved', () => {
    const wrapper = mount(MessageBlockAction, {
      props: {
        messageId: 'm1',
        conversationId: 's1',
        block: createPermissionBlock('pending', { extra: { needsUserAction: true } })
      }
    })

    expect(wrapper.find('[data-testid="permission-resolved-label"]').exists()).toBe(false)
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

    const installOption = wrapper
      .findAll('[data-testid="dc-choice-option"]')
      .find((option) => option.text().includes('安装为 Skill'))
    expect(installOption).toBeTruthy()
    await installOption!.trigger('click')

    expect(wrapper.emitted('respond')).toEqual([
      [{ kind: 'question_option', optionLabel: 'chat.skillDraft.actions.install' }]
    ])
  })

  it('bounds standalone permission details while keeping actions outside the scroll region', () => {
    const wrapper = mount(ChatToolInteractionOverlay, {
      props: {
        interaction: {
          messageId: 'm1',
          toolCallId: 'tc1',
          actionType: 'tool_call_permission',
          toolName: 'deepchat_subagents',
          toolArgs: JSON.stringify({ prompt: 'Review the project. '.repeat(200) }),
          block: createBlock({
            action_type: 'tool_call_permission',
            status: 'pending',
            content: 'Approve this subagent task?'
          })
        }
      }
    })

    expect(wrapper.classes()).toContain('max-h-[min(70vh,calc(100vh-12rem))]')
    const scrollRegion = wrapper.get('[data-testid="tool-interaction-scroll-region"]')
    expect(scrollRegion.classes()).toContain('overflow-y-auto')
    expect(scrollRegion.findAll('button')).toHaveLength(0)
    expect(wrapper.get('[data-testid="tool-interaction-actions"]').findAll('button')).toHaveLength(
      2
    )
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

  it('expands error details and explanation', async () => {
    const wrapper = mount(MessageBlockError, {
      props: {
        block: createBlock({
          type: 'error',
          content: 'HTTP 429 from upstream'
        })
      }
    })

    const trigger = wrapper.get('button')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('click')

    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.text()).toContain('common.error.causeOfError')
    expect(wrapper.text()).toContain('common.error.error429')
  })
})
