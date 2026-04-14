import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DisplayUserMessage,
  DisplayUserMessageMentionBlock
} from '@/components/chat/messageListItems'
import type { MessageFile } from '@shared/types/agent-interface'
import MessageItemUser from '@/components/message/MessageItemUser.vue'

const originalApi = window.api

const getVisibleMentionLabel = (block: DisplayUserMessageMentionBlock) => {
  if (block.category === 'prompts') {
    return block.id || block.content
  }
  if (block.category === 'context') {
    return block.id || block.category
  }
  return block.content
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === 'common.expand') return '展开'
      if (key === 'common.collapse') return '收起'
      return key
    }
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<span class="icon-stub" />'
  })
}))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    previewFile: vi.fn()
  })
}))

vi.mock('@/components/message/MessageInfo.vue', () => ({
  default: defineComponent({
    name: 'MessageInfo',
    template: '<div class="message-info-stub" />'
  })
}))

vi.mock('@/components/chat/ChatAttachmentItem.vue', () => ({
  default: defineComponent({
    name: 'ChatAttachmentItem',
    props: {
      file: {
        type: Object,
        required: true
      }
    },
    emits: ['click'],
    template:
      '<button type="button" class="attachment-stub" @click="$emit(\'click\')">{{ file.name }}</button>'
  })
}))

vi.mock('@/components/message/MessageToolbar.vue', () => ({
  default: defineComponent({
    name: 'MessageToolbar',
    emits: ['edit', 'save', 'cancel', 'copy', 'delete', 'retry'],
    template: `
      <div class="message-toolbar-stub">
        <button type="button" data-action="edit" @click="$emit('edit')">edit</button>
      </div>
    `
  })
}))

vi.mock('@/components/message/MessageContent.vue', () => ({
  default: defineComponent({
    name: 'MessageContent',
    props: {
      content: {
        type: Array,
        required: true
      }
    },
    emits: ['mentionClick'],
    methods: {
      renderBlock(block: { type: string; content: string; id?: string; category?: string }) {
        if (block.type === 'mention') {
          return getVisibleMentionLabel(block as DisplayUserMessageMentionBlock)
        }
        return block.content
      }
    },
    template: `
      <div class="message-content-stub text-sm whitespace-pre-wrap break-all">
        <span v-for="(block, index) in content" :key="index">{{ renderBlock(block) }}</span>
      </div>
    `
  })
}))

vi.mock('@/components/message/MessageTextContent.vue', () => ({
  default: defineComponent({
    name: 'MessageTextContent',
    props: {
      content: {
        type: String,
        required: true
      }
    },
    template:
      '<div class="message-text-stub text-sm whitespace-pre-wrap break-all">{{ content }}</div>'
  })
}))

const createMessage = (
  overrides: Partial<DisplayUserMessage> = {},
  contentOverrides: Partial<DisplayUserMessage['content']> = {}
): DisplayUserMessage => ({
  id: 'u1',
  role: 'user',
  timestamp: 1,
  avatar: '',
  name: 'You',
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
  orderSeq: 1,
  content: {
    text: 'short message',
    files: [],
    links: [],
    search: false,
    think: false,
    ...contentOverrides
  },
  ...overrides
})

const createFile = (overrides: Partial<MessageFile> = {}): MessageFile => ({
  name: 'notes.txt',
  path: '/tmp/notes.txt',
  mimeType: 'text/plain',
  ...overrides
})

const globalMountOptions = {
  attachTo: document.body
}

describe('MessageItemUser', () => {
  beforeEach(() => {
    window.api = {
      copyText: vi.fn()
    } as typeof window.api
  })

  afterEach(() => {
    window.api = originalApi
    document.body.innerHTML = ''
  })

  it('does not show a collapse toggle for short text', async () => {
    const wrapper = mount(MessageItemUser, {
      props: {
        message: createMessage()
      },
      ...globalMountOptions
    })

    const body = wrapper.get('[data-user-message-content-body="true"]')
    expect(body.attributes('data-user-message-collapsible')).toBe('false')
    expect(body.attributes('data-user-message-expanded')).toBe('true')
    expect(wrapper.find('[data-user-message-toggle="true"]').exists()).toBe(false)
  })

  it('collapses long plain text by default and toggles expansion', async () => {
    const wrapper = mount(MessageItemUser, {
      props: {
        message: createMessage({}, { text: 'a'.repeat(700) })
      },
      ...globalMountOptions
    })

    const body = wrapper.get('[data-user-message-content-body="true"]')
    const toggle = wrapper.get('[data-user-message-toggle="true"]')

    expect(body.attributes('data-user-message-collapsible')).toBe('true')
    expect(body.attributes('data-user-message-expanded')).toBe('false')
    expect(wrapper.find('.user-message-content--clamped').exists()).toBe(true)
    expect(wrapper.find('[data-user-message-fade="true"]').exists()).toBe(true)
    expect(toggle.text()).toBe('展开')

    await toggle.trigger('click')

    expect(body.attributes('data-user-message-expanded')).toBe('true')
    expect(wrapper.find('[data-user-message-fade="true"]').exists()).toBe(false)
    expect(wrapper.get('[data-user-message-toggle="true"]').text()).toBe('收起')

    await wrapper.get('[data-user-message-toggle="true"]').trigger('click')

    expect(body.attributes('data-user-message-expanded')).toBe('false')
  })

  it('keeps structured user content rendering while collapsed', async () => {
    const wrapper = mount(MessageItemUser, {
      props: {
        message: createMessage(
          {},
          {
            text: '',
            content: [
              {
                type: 'text',
                content: 'x'.repeat(650)
              },
              {
                type: 'mention',
                content: '{"messages":[]}',
                id: 'prompt-name',
                category: 'prompts'
              },
              {
                type: 'code',
                content: 'const answer = 42;',
                language: 'typescript'
              }
            ]
          }
        )
      },
      ...globalMountOptions
    })

    expect(wrapper.find('[data-user-message-toggle="true"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('prompt-name')
    expect(wrapper.text()).toContain('const answer = 42;')
  })

  it('keeps attachments visible when long text collapses', async () => {
    const wrapper = mount(MessageItemUser, {
      props: {
        message: createMessage({}, { text: 'b'.repeat(700), files: [createFile()] })
      },
      ...globalMountOptions
    })

    expect(wrapper.findAll('.attachment-stub')).toHaveLength(1)
    expect(wrapper.find('[data-user-message-toggle="true"]').exists()).toBe(true)
  })

  it('shows full textarea content in edit mode even when the message is collapsible', async () => {
    const wrapper = mount(MessageItemUser, {
      props: {
        message: createMessage({}, { text: 'c'.repeat(700) })
      },
      ...globalMountOptions
    })

    await wrapper.get('[data-action="edit"]').trigger('click')
    await nextTick()

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.find('[data-user-message-content-body="true"]').exists()).toBe(false)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('c'.repeat(700))
  })

  it('re-evaluates collapse state when content length drops below the collapse threshold', async () => {
    const wrapper = mount(MessageItemUser, {
      props: {
        message: createMessage({}, { text: 'd'.repeat(700) })
      },
      ...globalMountOptions
    })

    expect(wrapper.find('[data-user-message-toggle="true"]').exists()).toBe(true)

    await wrapper.setProps({
      message: createMessage({}, { text: 'short again' })
    })
    await nextTick()

    const body = wrapper.get('[data-user-message-content-body="true"]')
    expect(body.attributes('data-user-message-collapsible')).toBe('false')
    expect(body.attributes('data-user-message-expanded')).toBe('true')
    expect(wrapper.find('[data-user-message-toggle="true"]').exists()).toBe(false)
  })
})
