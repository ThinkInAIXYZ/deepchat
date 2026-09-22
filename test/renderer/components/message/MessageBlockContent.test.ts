import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import MessageBlockContent from '@/components/message/MessageBlockContent.vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import type { MarkdownLinkContext } from '@/components/markdown/linkTypes'

vi.mock('@/components/message/ToolCallPreview.vue', () => ({
  default: defineComponent({
    name: 'ToolCallPreview',
    template: '<div class="tool-preview-stub" />'
  })
}))

vi.mock('@/components/markdown/MarkdownRenderer.vue', () => ({
  default: defineComponent({
    name: 'MarkdownRenderer',
    props: {
      content: {
        type: String,
        default: ''
      },
      mode: {
        type: String,
        default: undefined
      },
      messageId: {
        type: String,
        default: undefined
      },
      threadId: {
        type: String,
        default: undefined
      },
      smoothStreaming: {
        type: Boolean,
        default: false
      },
      streaming: {
        type: Boolean,
        default: false
      },
      final: {
        type: Boolean,
        default: true
      },
      virtualizeNodes: {
        type: Boolean,
        default: true
      },
      linkContext: {
        type: Object as () => MarkdownLinkContext | undefined,
        default: undefined
      },
      hiddenImageSources: {
        type: Array,
        default: undefined
      }
    },
    template:
      '<div class="markdown-stub" :data-mode="mode" :data-message-id="messageId" :data-thread-id="threadId" :data-link-source="linkContext?.source" :data-link-session-id="linkContext?.sessionId" :data-smooth-streaming="String(smoothStreaming)" :data-streaming="String(streaming)" :data-final="String(final)" :data-virtualize-nodes="String(virtualizeNodes)" :data-hidden-image-sources="hiddenImageSources?.join(\',\')">{{ content }}</div>'
  })
}))

const createBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'content',
  status: 'success',
  timestamp: Date.now(),
  content: '',
  ...overrides
})

vi.mock('@dc-ui/components', () => ({
  DcCopyButton: defineComponent({
    name: 'DcCopyButton',
    props: ['copyText'],
    template: '<button :data-copy-text="copyText">Copy</button>'
  })
}))

describe('MessageBlockContent', () => {
  it.each([
    'application/vnd.ant.react',
    'text/html',
    'image/svg+xml',
    'application/vnd.ant.mermaid',
    'text/markdown',
    'application/vnd.ant.code',
    'application/unknown'
  ])('shows literal copyable historical %s source', (type) => {
    const source = '\n  <script>throw new Error("never execute")</script>\n  <App />\n'
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          content: `Before<antArtifact type="${type}" identifier="old" title="Saved source">${source}</antArtifact>After`
        }),
        messageId: 'm1',
        threadId: 's1'
      }
    })

    expect(wrapper.text()).toContain('Saved source')
    expect(wrapper.get('pre code').element.textContent).toBe(source)
    expect(wrapper.get('button').attributes('data-copy-text')).toBe(source)
    expect(wrapper.findAll('.markdown-stub').map((part) => part.text())).toEqual([
      'Before',
      'After'
    ])
    expect(wrapper.find('script, iframe, svg').exists()).toBe(false)
  })

  it('keeps unclosed source readable and updates it in place', async () => {
    const content = '<antArtifact type="text/html" identifier="old" title="Partial">  <div>'
    const wrapper = mount(MessageBlockContent, {
      props: { block: createBlock({ content, status: 'loading' }), messageId: 'm1', threadId: 's1' }
    })
    expect(wrapper.get('pre code').element.textContent).toBe('  <div>')
    await wrapper.setProps({
      block: createBlock({ content: `${content}Done</div></antArtifact>` })
    })
    expect(wrapper.get('pre code').element.textContent).toBe('  <div>Done</div>')
  })

  it('shows structured historical artifact metadata as literal source', () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          content: '<App />',
          artifact: { identifier: 'old', title: 'Saved React', type: 'application/vnd.ant.react' }
        }),
        messageId: 'm1',
        threadId: 's1'
      }
    })
    expect(wrapper.text()).toContain('Saved React')
    expect(wrapper.get('pre code').text()).toBe('<App />')
  })

  it('passes message and thread ids to MarkdownRenderer for text parts', async () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          status: 'success',
          content: 'plain markdown content'
        }),
        messageId: 'm3',
        threadId: 's3'
      }
    })

    await flushPromises()

    const markdown = wrapper.get('.markdown-stub')
    expect(markdown.attributes('data-message-id')).toBe('m3')
    expect(markdown.attributes('data-thread-id')).toBe('s3')
    expect(markdown.attributes('data-mode')).toBe('chat')
    expect(markdown.attributes('data-link-source')).toBe('chat')
    expect(markdown.attributes('data-link-session-id')).toBe('s3')
    expect(markdown.text()).toContain('plain markdown content')
  })

  it('passes promoted local image sources to MarkdownRenderer', async () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({ content: '![image](imgcache://generated.png)' }),
        messageId: 'm-image',
        threadId: 's-image',
        hiddenMarkdownImageSources: ['imgcache://generated.png']
      }
    })

    await flushPromises()

    expect(wrapper.get('.markdown-stub').attributes('data-hidden-image-sources')).toBe(
      'imgcache://generated.png'
    )
  })

  it('marks completed content blocks as final static markdown', async () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          status: 'success',
          content: 'completed markdown content'
        }),
        messageId: 'm4',
        threadId: 's4'
      }
    })

    await flushPromises()

    const markdown = wrapper.get('.markdown-stub')
    expect(markdown.attributes('data-smooth-streaming')).toBe('false')
    expect(markdown.attributes('data-streaming')).toBe('false')
    expect(markdown.attributes('data-final')).toBe('true')
    expect(markdown.attributes('data-virtualize-nodes')).toBe('true')
  })

  it.each(['pending', 'loading'] as const)(
    'enables smooth streaming for %s content blocks',
    async (status) => {
      const wrapper = mount(MessageBlockContent, {
        props: {
          block: createBlock({
            status,
            content: `${status} markdown content`
          }),
          messageId: 'm5',
          threadId: 's5'
        }
      })

      await flushPromises()

      const markdown = wrapper.get('.markdown-stub')
      expect(markdown.attributes('data-smooth-streaming')).toBe('true')
      expect(markdown.attributes('data-streaming')).toBe('true')
      expect(markdown.attributes('data-final')).toBe('false')
      // MarkdownRenderer disables its node window while live, but keeps this capability
      // enabled so Markstream can still defer heavy offscreen nodes.
      expect(markdown.attributes('data-virtualize-nodes')).toBe('true')
    }
  )

  it('hands a streaming text part to final state without replacing its renderer node', async () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          status: 'loading',
          content: 'streaming markdown content'
        }),
        messageId: 'm-stream',
        threadId: 's-stream'
      }
    })

    await flushPromises()

    const liveNode = wrapper.get('.markdown-stub').element
    expect(wrapper.get('.markdown-stub').attributes('data-final')).toBe('false')

    await wrapper.setProps({
      block: createBlock({
        status: 'success',
        content: 'final markdown content'
      })
    })
    await flushPromises()

    const finalMarkdown = wrapper.get('.markdown-stub')
    expect(finalMarkdown.element).toBe(liveNode)
    expect(finalMarkdown.attributes('data-streaming')).toBe('false')
    expect(finalMarkdown.attributes('data-final')).toBe('true')
    expect(finalMarkdown.attributes('data-virtualize-nodes')).toBe('true')
    expect(finalMarkdown.text()).toContain('final markdown content')
  })

  it('keeps all nodes mounted for searchable result messages', async () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          status: 'success',
          content: 'searchable markdown content'
        }),
        messageId: 'm6',
        threadId: 's6',
        isSearchResult: true
      }
    })

    await flushPromises()

    expect(wrapper.get('.markdown-stub').attributes('data-virtualize-nodes')).toBe('false')
  })

  it('keeps all nodes mounted when chat search disables markdown virtualization', async () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          status: 'success',
          content: 'plain markdown content'
        }),
        messageId: 'm7',
        threadId: 's7',
        disableMarkdownVirtualization: true
      }
    })

    await flushPromises()

    expect(wrapper.get('.markdown-stub').attributes('data-virtualize-nodes')).toBe('false')
  })
})
