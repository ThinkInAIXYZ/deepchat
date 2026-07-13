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
  navigateLinkMock,
  ensureMarkdownWorkersMock
} = vi.hoisted(() => ({
  showArtifactMock: vi.fn(),
  getSearchResultsMock: vi.fn().mockResolvedValue([]),
  hideReferenceMock: vi.fn(),
  showReferenceMock: vi.fn(),
  nanoidMock: vi.fn(),
  navigateLinkMock: vi.fn().mockResolvedValue(true),
  ensureMarkdownWorkersMock: vi.fn().mockResolvedValue(undefined)
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

  vi.doMock('@/lib/markdownWorkerLifecycle', () => ({
    ensureMarkdownWorkers: ensureMarkdownWorkersMock
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
        final: {
          type: Boolean,
          default: undefined
        },
        mode: {
          type: String,
          default: undefined
        },
        htmlPolicy: {
          type: String,
          default: undefined
        },
        smoothStreaming: {
          type: [Boolean, String],
          default: false
        },
        typewriter: {
          type: Boolean,
          default: false
        },
        batchRendering: {
          type: Boolean,
          default: false
        },
        deferNodesUntilVisible: {
          type: Boolean,
          default: false
        },
        viewportPriority: {
          type: Boolean,
          default: false
        },
        nodeVirtual: {
          type: [Boolean, String],
          default: false
        },
        maxLiveNodes: {
          type: Number,
          default: undefined
        },
        liveNodeBuffer: {
          type: Number,
          default: undefined
        },
        codeBlockStream: {
          type: Boolean,
          default: false
        },
        initialRenderBatchSize: {
          type: Number,
          default: undefined
        },
        renderBatchSize: {
          type: Number,
          default: undefined
        },
        renderBatchDelay: {
          type: Number,
          default: undefined
        },
        renderBatchBudgetMs: {
          type: Number,
          default: undefined
        },
        renderBatchIdleTimeoutMs: {
          type: Number,
          default: undefined
        },
        parseCoalesceMs: {
          type: Number,
          default: undefined
        },
        content: {
          type: String,
          default: ''
        }
      },
      setup(props) {
        return () =>
          h(
            'div',
            {
              'data-testid': 'node-renderer',
              'data-final': String(props.final),
              'data-mode': props.mode,
              'data-html-policy': props.htmlPolicy,
              'data-smooth-streaming': String(props.smoothStreaming),
              'data-typewriter': String(props.typewriter),
              'data-batch-rendering': String(props.batchRendering),
              'data-defer-nodes-until-visible': String(props.deferNodesUntilVisible),
              'data-viewport-priority': String(props.viewportPriority),
              'data-node-virtual': String(props.nodeVirtual),
              'data-max-live-nodes': String(props.maxLiveNodes),
              'data-live-node-buffer': String(props.liveNodeBuffer),
              'data-code-block-stream': String(props.codeBlockStream),
              'data-initial-render-batch-size': String(props.initialRenderBatchSize),
              'data-render-batch-size': String(props.renderBatchSize),
              'data-render-batch-delay': String(props.renderBatchDelay),
              'data-render-batch-budget-ms': String(props.renderBatchBudgetMs),
              'data-render-batch-idle-timeout-ms': String(props.renderBatchIdleTimeoutMs),
              'data-parse-coalesce-ms': String(props.parseCoalesceMs),
              'data-content': props.content
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
    ensureMarkdownWorkersMock.mockReset()
    ensureMarkdownWorkersMock.mockResolvedValue(undefined)
    navigateLinkMock.mockReset()
    navigateLinkMock.mockResolvedValue(true)
    nanoidMock.mockReturnValueOnce('fallback-message').mockReturnValueOnce('fallback-thread')
  })

  it('initializes markdown workers lazily when mounted', async () => {
    await setup()

    expect(ensureMarkdownWorkersMock).toHaveBeenCalledTimes(1)
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

  it('renders static markdown as final docs content by default', async () => {
    const { wrapper } = await setup()
    const nodeRenderer = wrapper.get('[data-testid="node-renderer"]')

    expect(nodeRenderer.attributes('data-mode')).toBe('docs')
    expect(nodeRenderer.attributes('data-html-policy')).toBe('safe')
    expect(nodeRenderer.attributes('data-final')).toBe('true')
    expect(nodeRenderer.attributes('data-smooth-streaming')).toBe('false')
    expect(nodeRenderer.attributes('data-typewriter')).toBe('false')
    expect(nodeRenderer.attributes('data-batch-rendering')).toBe('true')
    expect(nodeRenderer.attributes('data-defer-nodes-until-visible')).toBe('true')
    expect(nodeRenderer.attributes('data-viewport-priority')).toBe('true')
    expect(nodeRenderer.attributes('data-node-virtual')).toBe('auto')
    expect(nodeRenderer.attributes('data-max-live-nodes')).toBe('260')
    expect(nodeRenderer.attributes('data-live-node-buffer')).toBe('80')
    expect(nodeRenderer.attributes('data-code-block-stream')).toBe('false')
    expect(nodeRenderer.attributes('data-initial-render-batch-size')).toBe('96')
    expect(nodeRenderer.attributes('data-render-batch-size')).toBe('80')
    expect(nodeRenderer.attributes('data-render-batch-delay')).toBe('0')
    expect(nodeRenderer.attributes('data-render-batch-budget-ms')).toBe('8')
    expect(nodeRenderer.attributes('data-render-batch-idle-timeout-ms')).toBe('16')
    expect(nodeRenderer.attributes('data-parse-coalesce-ms')).toBe('0')
  })

  it('marks the root for scoped code block scrollbar stabilization', async () => {
    const { wrapper } = await setup()

    expect(wrapper.classes()).toContain('markdown-renderer-root')
  })

  it('passes the requested chat mode and streaming options to NodeRenderer for live content', async () => {
    const { wrapper } = await setup({
      mode: 'chat',
      streaming: true,
      final: false,
      smoothStreaming: true
    })
    const nodeRenderer = wrapper.get('[data-testid="node-renderer"]')

    expect(nodeRenderer.attributes('data-mode')).toBe('chat')
    expect(nodeRenderer.attributes('data-final')).toBe('false')
    expect(nodeRenderer.attributes('data-smooth-streaming')).toBe('auto')
    expect(nodeRenderer.attributes('data-typewriter')).toBe('true')
    expect(nodeRenderer.attributes('data-node-virtual')).toBe('false')
    expect(nodeRenderer.attributes('data-max-live-nodes')).toBe('0')
    expect(nodeRenderer.attributes('data-live-node-buffer')).toBe('0')
    expect(nodeRenderer.attributes('data-code-block-stream')).toBe('true')
    expect(nodeRenderer.attributes('data-defer-nodes-until-visible')).toBe('false')
    expect(nodeRenderer.attributes('data-viewport-priority')).toBe('false')
    expect(nodeRenderer.attributes('data-initial-render-batch-size')).toBe('10')
    expect(nodeRenderer.attributes('data-render-batch-size')).toBe('14')
    expect(nodeRenderer.attributes('data-render-batch-delay')).toBe('8')
    expect(nodeRenderer.attributes('data-render-batch-budget-ms')).toBe('3')
    expect(nodeRenderer.attributes('data-render-batch-idle-timeout-ms')).toBe('24')
    expect(nodeRenderer.attributes('data-parse-coalesce-ms')).toBe('12')
  })

  it('renders the first non-empty streaming update immediately', async () => {
    const { wrapper } = await setup({
      content: '',
      streaming: true,
      final: false,
      smoothStreaming: true
    })

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-content')).toBe('')

    await wrapper.setProps({ content: 'first chunk' })

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-content')).toBe(
      'first chunk'
    )
  })

  it('disables smooth streaming when requested for live content', async () => {
    const { wrapper } = await setup({
      streaming: true,
      final: false,
      smoothStreaming: false
    })

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-smooth-streaming')).toBe(
      'false'
    )
    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-final')).toBe('false')
  })

  it('marks completed chat markdown as final', async () => {
    const { wrapper } = await setup({
      smoothStreaming: false
    })

    const nodeRenderer = wrapper.get('[data-testid="node-renderer"]')
    expect(nodeRenderer.attributes('data-final')).toBe('true')
  })

  it('allows callers to disable completed-node virtualization and deferral', async () => {
    const { wrapper } = await setup({
      virtualizeNodes: false
    })
    const nodeRenderer = wrapper.get('[data-testid="node-renderer"]')

    expect(nodeRenderer.attributes('data-node-virtual')).toBe('false')
    expect(nodeRenderer.attributes('data-defer-nodes-until-visible')).toBe('false')
    expect(nodeRenderer.attributes('data-viewport-priority')).toBe('false')
    expect(nodeRenderer.attributes('data-max-live-nodes')).toBe('0')
    expect(nodeRenderer.attributes('data-live-node-buffer')).toBe('0')
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
