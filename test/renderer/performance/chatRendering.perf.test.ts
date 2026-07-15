import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { generateMockMessages } from '../../fixtures/mockMessages'
import { collectChatSearchResults } from '@/lib/chatSearch'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'
import MessageBlockToolCall from '@/components/message/MessageBlockToolCall.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

vi.mock('@/components/message/MessageItemUser.vue', () => ({
  default: defineComponent({
    name: 'MessageItemUser',
    props: { message: { type: Object, required: true } },
    template: '<div class="user-item">{{ message.id }}</div>'
  })
}))

vi.mock('@/components/message/MessageItemAssistant.vue', () => ({
  default: defineComponent({
    name: 'MessageItemAssistant',
    props: { message: { type: Object, required: true } },
    template: '<div class="assistant-item">{{ message.id }}</div>'
  })
}))

vi.mock('@/components/message/MessageBlockAction.vue', () => ({
  default: defineComponent({
    name: 'MessageBlockAction',
    template: '<div />'
  })
}))

vi.mock('@/composables/message/useMessageCapture', () => ({
  useMessageCapture: () => ({
    isCapturing: false,
    captureMessage: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ isDark: false })
}))

vi.mock('@/stores/ui/session', () => ({
  useSessionStore: () => ({ selectSession: vi.fn() })
}))

describe('chat rendering performance smoke', () => {
  it('mounts the production MessageList path with realistic message shapes', async () => {
    const MessageList = (await import('@/components/chat/MessageList.vue')).default
    const messages = generateMockMessages({ count: 120, seed: 1847 })
    const start = performance.now()
    const wrapper = mount(MessageList, { props: { messages } })
    const duration = performance.now() - start

    console.info(`[perf:chat-rendering] MessageList 120 rows mounted in ${duration.toFixed(1)}ms`)
    expect(wrapper.findAll('[data-message-id]')).toHaveLength(120)
  })

  it('counts search matches from generated message data without DOM mutation', () => {
    const messages = generateMockMessages({ count: 1000, seed: 1847 })
    const start = performance.now()
    const matches = collectChatSearchResults(messages, 'alpha')
    const duration = performance.now() - start

    console.info(`[perf:chat-search] 1000 generated messages searched in ${duration.toFixed(1)}ms`)
    expect(matches.length).toBeGreaterThan(0)
    expect(new Set(matches.map((match) => match.messageId)).size).toBeGreaterThan(1)
  })

  it('mounts and expands a production tool disclosure in a 160-item batch', async () => {
    const blocks: DisplayAssistantMessageBlock[] = Array.from({ length: 160 }, (_, index) => ({
      type: 'tool_call',
      status: 'success',
      timestamp: index,
      tool_call: {
        id: `tool-${index}`,
        name: 'read_file',
        params: JSON.stringify({ path: `/tmp/file-${index}.ts` }),
        response: `file ${index} contents`
      }
    }))
    const Host = defineComponent({
      components: { MessageBlockToolCall },
      setup: () => ({ blocks }),
      template:
        '<div><MessageBlockToolCall v-for="block in blocks" :key="block.tool_call.id" :block="block" /></div>'
    })

    const start = performance.now()
    const wrapper = mount(Host)
    const duration = performance.now() - start

    console.info(`[perf:chat-tools] 160 real tool blocks mounted in ${duration.toFixed(1)}ms`)
    expect(wrapper.findAll('[data-testid="tool-call-trigger"]')).toHaveLength(160)
    expect(duration).toBeLessThan(2000)

    await wrapper.findAll('[data-testid="tool-call-trigger"]')[159].trigger('click')
    expect(wrapper.findAll('[data-testid="tool-call-details"]')).toHaveLength(1)
  })
})
