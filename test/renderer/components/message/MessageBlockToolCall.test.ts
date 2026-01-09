import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import MessageBlockToolCall from '@/components/message/MessageBlockToolCall.vue'
import type { AssistantMessageBlock } from '@shared/chat'

const createBlock = (overrides: Partial<AssistantMessageBlock> = {}): AssistantMessageBlock => ({
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
      },
      global: {
        stubs: {
          CodeBlockNode: {
            name: 'CodeBlockNode',
            props: ['node', 'isDark'],
            template: '<div class="code-block-stub"></div>'
          }
        }
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
})
