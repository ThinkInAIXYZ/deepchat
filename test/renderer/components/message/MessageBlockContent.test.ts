import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageBlockContent from '@/components/message/MessageBlockContent.vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import type { MarkdownLinkContext } from '@/components/markdown/linkTypes'

const { syncArtifactMock, completeArtifactMock } = vi.hoisted(() => ({
  syncArtifactMock: vi.fn(),
  completeArtifactMock: vi.fn()
}))

vi.mock('@/stores/artifact', () => ({
  useArtifactStore: () => ({
    syncArtifact: syncArtifactMock,
    completeArtifact: completeArtifactMock
  })
}))

vi.mock('@/components/artifacts/ArtifactThinking.vue', () => ({
  default: defineComponent({
    name: 'ArtifactThinking',
    template: '<div class="artifact-thinking-stub" />'
  })
}))

vi.mock('@/components/artifacts/ArtifactPreview.vue', () => ({
  default: defineComponent({
    name: 'ArtifactPreview',
    props: {
      block: {
        type: Object,
        required: true
      }
    },
    template: '<div class="artifact-preview-stub">{{ block.artifact?.title }}</div>'
  })
}))

vi.mock('@/components/artifacts/ToolCallPreview.vue', () => ({
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
      }
    },
    template:
      '<div class="markdown-stub" :data-mode="mode" :data-message-id="messageId" :data-thread-id="threadId" :data-link-source="linkContext?.source" :data-link-session-id="linkContext?.sessionId" :data-smooth-streaming="String(smoothStreaming)" :data-streaming="String(streaming)" :data-final="String(final)" :data-virtualize-nodes="String(virtualizeNodes)">{{ content }}</div>'
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

describe('MessageBlockContent', () => {
  beforeEach(() => {
    syncArtifactMock.mockReset()
    completeArtifactMock.mockReset()
  })

  it('syncs loading artifact for unclosed artifact content', async () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          status: 'loading',
          content:
            '<antArtifact type="application/vnd.ant.code" identifier="artifact-1" title="Example" language="ts">const answer = 42'
        }),
        messageId: 'm1',
        threadId: 's1'
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Example')
    expect(syncArtifactMock).toHaveBeenCalledWith(
      {
        id: 'artifact-1',
        type: 'application/vnd.ant.code',
        title: 'Example',
        language: 'ts',
        content: 'const answer = 42',
        status: 'loading'
      },
      'm1',
      's1'
    )
    expect(completeArtifactMock).not.toHaveBeenCalled()
  })

  it('completes loaded artifact for closed artifact content', async () => {
    const wrapper = mount(MessageBlockContent, {
      props: {
        block: createBlock({
          status: 'success',
          content:
            '<antArtifact type="text/markdown" identifier="artifact-2" title="Readme"># Hello</antArtifact>'
        }),
        messageId: 'm2',
        threadId: 's2'
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Readme')
    expect(completeArtifactMock).toHaveBeenCalledWith(
      {
        id: 'artifact-2',
        type: 'text/markdown',
        title: 'Readme',
        language: undefined,
        content: '# Hello',
        status: 'loaded'
      },
      'm2',
      's2'
    )
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
      expect(markdown.attributes('data-virtualize-nodes')).toBe('false')
    }
  )

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
