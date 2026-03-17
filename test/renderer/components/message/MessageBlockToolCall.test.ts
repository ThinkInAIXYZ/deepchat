import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import MessageBlockToolCall from '@/components/message/MessageBlockToolCall.vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { count?: number }) => {
      if (key === 'toolCall.replacementsCount') {
        return `${params?.count ?? 0} replacements`
      }
      return key
    }
  })
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    isDark: false
  })
}))

vi.mock('markstream-vue', () => ({
  CodeBlockNode: defineComponent({
    name: 'CodeBlockNode',
    props: {
      node: {
        type: Object,
        required: true
      },
      isDark: {
        type: Boolean,
        default: false
      },
      showHeader: {
        type: Boolean,
        default: true
      }
    },
    template: '<div class="code-block-stub"></div>'
  })
}))

const createBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'tool_call',
  status: 'success',
  timestamp: Date.now(),
  tool_call: {
    name: 'edit_text',
    response: ''
  },
  ...overrides
})

describe('MessageBlockToolCall', () => {
  it('renders diff response with CodeBlockNode', async () => {
    const response = JSON.stringify({
      success: true,
      originalCode: 'alpha\nbeta',
      updatedCode: 'alpha\ngamma',
      replacements: 1,
      language: 'typescript'
    })
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: { name: 'edit_text', response }
        })
      }
    })

    await wrapper.find('div.inline-flex').trigger('click')

    const codeBlock = wrapper.findComponent({ name: 'CodeBlockNode' })
    expect(codeBlock.exists()).toBe(true)
    expect(codeBlock.props('node')).toMatchObject({
      diff: true,
      language: 'typescript',
      originalCode: 'alpha\nbeta',
      updatedCode: 'alpha\ngamma'
    })
  })

  it('falls back to preformatted text for non-diff responses', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: { name: 'other_tool', response: 'plain output' }
        })
      }
    })

    await wrapper.find('div.inline-flex').trigger('click')

    expect(wrapper.findComponent({ name: 'CodeBlockNode' }).exists()).toBe(false)
    expect(wrapper.find('pre').text()).toContain('plain output')
  })

  it('shows an RTK badge for command-style tool calls when RTK was applied', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'exec',
            response: 'ok',
            rtkApplied: true,
            rtkMode: 'rewrite'
          }
        })
      }
    })

    expect(wrapper.find('[data-testid="tool-call-rtk-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-call-rtk-badge"]').text()).toBe('RTK')
  })
})
