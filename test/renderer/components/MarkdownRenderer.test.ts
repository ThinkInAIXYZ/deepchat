import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownLinkContext } from '@/components/markdown/linkTypes'

const {
  showArtifactMock,
  getSearchResultsMock,
  hideReferenceMock,
  showReferenceMock,
  nanoidMock,
  navigateLinkMock
} = vi.hoisted(() => ({
  showArtifactMock: vi.fn(),
  getSearchResultsMock: vi.fn().mockResolvedValue([]),
  hideReferenceMock: vi.fn(),
  showReferenceMock: vi.fn(),
  nanoidMock: vi.fn(),
  navigateLinkMock: vi.fn().mockResolvedValue(true)
}))

const setup = async (props: Record<string, unknown> = {}) => {
  vi.resetModules()

  let customComponents: Record<string, (...args: any[]) => any> = {}

  vi.doMock('nanoid', () => ({
    nanoid: nanoidMock
  }))

  vi.doMock('@/stores/artifact', () => ({
    useArtifactStore: () => ({
      showArtifact: showArtifactMock
    })
  }))

  vi.doMock('@/stores/reference', () => ({
    useReferenceStore: () => ({
      hideReference: hideReferenceMock,
      showReference: showReferenceMock
    })
  }))

  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => ({
      isDark: false
    })
  }))

  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => ({
      formattedCodeFontFamily: 'monospace'
    })
  }))

  vi.doMock('@api/SessionClient', () => ({
    createSessionClient: vi.fn(() => ({
      getSearchResults: getSearchResultsMock
    }))
  }))

  vi.doMock('@/components/markdown/useMarkdownLinkNavigation', () => ({
    useMarkdownLinkNavigation: () => ({
      navigateLink: navigateLinkMock
    })
  }))

  vi.doMock('markstream-vue', () => {
    const previewPayload = {
      id: 'preview-artifact',
      artifactType: 'text/html',
      artifactTitle: 'HTML Preview',
      language: 'html',
      node: {
        code: '<h1>Hello</h1>'
      }
    }

    const NodeRenderer = defineComponent({
      name: 'NodeRenderer',
      props: {
        smoothStreaming: {
          type: Boolean,
          default: false
        }
      },
      setup(props) {
        return () =>
          h(
            'div',
            {
              'data-testid': 'node-renderer',
              'data-smooth-streaming': String(props.smoothStreaming)
            },
            [
              customComponents.code_block?.({
                node: {
                  language: 'html',
                  code: '<h1>Hello</h1>',
                  raw: '<h1>Hello</h1>'
                }
              }) ?? h('div')
            ]
          )
      }
    })

    const CodeBlockNode = defineComponent({
      name: 'CodeBlockNode',
      emits: ['previewCode'],
      mounted() {
        this.$emit('previewCode', previewPayload)
      },
      render() {
        return h('div', { 'data-testid': 'code-block-node' })
      }
    })

    const ReferenceNode = defineComponent({
      name: 'ReferenceNode',
      render() {
        return h('div')
      }
    })

    const MermaidBlockNode = defineComponent({
      name: 'MermaidBlockNode',
      render() {
        return h('div')
      }
    })

    return {
      default: NodeRenderer,
      NodeRenderer,
      CodeBlockNode,
      ReferenceNode,
      MermaidBlockNode,
      removeCustomComponents: vi.fn(),
      setCustomComponents: (
        customIdOrComponents: string | Record<string, (...args: any[]) => any>,
        maybeComponents?: Record<string, (...args: any[]) => any>
      ) => {
        customComponents =
          typeof customIdOrComponents === 'string' ? (maybeComponents ?? {}) : customIdOrComponents
      }
    }
  })

  const MarkdownRenderer = (await import('@/components/markdown/MarkdownRenderer.vue')).default
  const wrapper = mount(MarkdownRenderer, {
    props: {
      content: '```html\n<h1>Hello</h1>\n```',
      ...props
    }
  })

  await flushPromises()

  return {
    wrapper,
    getCustomComponents: () => customComponents
  }
}

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    showArtifactMock.mockReset()
    getSearchResultsMock.mockReset()
    getSearchResultsMock.mockResolvedValue([])
    hideReferenceMock.mockReset()
    showReferenceMock.mockReset()
    nanoidMock.mockReset()
    navigateLinkMock.mockReset()
    navigateLinkMock.mockResolvedValue(true)
    nanoidMock.mockReturnValueOnce('fallback-message').mockReturnValueOnce('fallback-thread')
  })

  it('uses the provided message and thread ids for HTML preview artifacts', async () => {
    await setup({
      messageId: 'message-1',
      threadId: 'thread-1'
    })

    expect(showArtifactMock).toHaveBeenCalledWith(
      {
        id: 'preview-artifact',
        type: 'text/html',
        title: 'HTML Preview',
        language: 'html',
        content: '<h1>Hello</h1>',
        status: 'loaded'
      },
      'message-1',
      'thread-1',
      { force: true }
    )
  })

  it('falls back to local ids when no message or thread ids are provided', async () => {
    await setup()

    expect(showArtifactMock).toHaveBeenCalledWith(
      {
        id: 'preview-artifact',
        type: 'text/html',
        title: 'HTML Preview',
        language: 'html',
        content: '<h1>Hello</h1>',
        status: 'loaded'
      },
      'artifact-msg-fallback-message',
      'artifact-thread-fallback-thread',
      { force: true }
    )
  })

  it('enables smooth streaming by default', async () => {
    const { wrapper } = await setup()

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-smooth-streaming')).toBe(
      'true'
    )
  })

  it('marks the root for scoped code block scrollbar stabilization', async () => {
    const { wrapper } = await setup()

    expect(wrapper.classes()).toContain('markdown-renderer-root')
  })

  it('passes explicit smooth streaming to NodeRenderer', async () => {
    const { wrapper } = await setup({
      smoothStreaming: true
    })

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-smooth-streaming')).toBe(
      'true'
    )
  })

  it('routes reference clicks through the shared markdown link navigator', async () => {
    getSearchResultsMock.mockResolvedValueOnce([
      {
        url: 'https://example.com/reference'
      }
    ])

    const { getCustomComponents } = await setup({
      messageId: 'message-1',
      threadId: 'thread-1',
      linkContext: {
        source: 'chat',
        sessionId: 'thread-1'
      } satisfies MarkdownLinkContext
    })

    const referenceVNode = getCustomComponents().reference?.({
      node: {
        id: '1'
      }
    })
    const clickEvent = new MouseEvent('click', { altKey: true })

    await referenceVNode.props.onClick(clickEvent)
    await flushPromises()

    expect(getSearchResultsMock).toHaveBeenCalledWith('message-1')
    expect(navigateLinkMock).toHaveBeenCalledWith('https://example.com/reference', clickEvent)
  })
})
