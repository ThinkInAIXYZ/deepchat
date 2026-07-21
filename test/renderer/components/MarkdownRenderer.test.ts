import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownLinkContext } from '@/components/markdown/linkTypes'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

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
  const setCustomComponentsMock = vi.fn(
    (
      customIdOrComponents: string | Record<string, (...args: any[]) => any>,
      maybeComponents?: Record<string, (...args: any[]) => any>
    ) => {
      customComponents =
        typeof customIdOrComponents === 'string' ? (maybeComponents ?? {}) : customIdOrComponents
    }
  )
  const removeCustomComponentsMock = vi.fn()

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
        code: '<h1>Hello</h1>',
        language: 'html'
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
          type: [Boolean, String],
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
        codeRenderer: {
          type: String,
          default: undefined
        },
        codeBlockProps: {
          type: Object,
          default: undefined
        },
        mermaidProps: {
          type: Object,
          default: undefined
        },
        customId: {
          type: String,
          default: undefined
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
      emits: ['click', 'mouseover', 'mouseout', 'handleArtifactClick'],
      setup(props, { emit }) {
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
              'data-code-renderer': props.codeRenderer,
              'data-code-block-theme-count': String(props.codeBlockProps?.themes?.length ?? 0),
              'data-mermaid-strict': String(props.mermaidProps?.isStrict),
              'data-custom-id': props.customId,
              'data-initial-render-batch-size': String(props.initialRenderBatchSize),
              'data-render-batch-size': String(props.renderBatchSize),
              'data-render-batch-delay': String(props.renderBatchDelay),
              'data-render-batch-budget-ms': String(props.renderBatchBudgetMs),
              'data-render-batch-idle-timeout-ms': String(props.renderBatchIdleTimeoutMs),
              'data-parse-coalesce-ms': String(props.parseCoalesceMs),
              'data-content': props.content
            },
            [
              h(
                'a',
                {
                  href: 'https://example.com/link',
                  class: 'link-node',
                  'data-testid': 'rendered-link',
                  onClick: (event: MouseEvent) => emit('click', event)
                },
                'link'
              ),
              h(
                'a',
                {
                  href: '#unmarked-anchor',
                  'data-testid': 'unmarked-anchor',
                  onClick: (event: MouseEvent) => emit('click', event)
                },
                'unmarked anchor'
              ),
              h(
                'button',
                {
                  type: 'button',
                  'data-testid': 'preview-code',
                  onClick: () => emit('handleArtifactClick', previewPayload)
                },
                'preview code'
              ),
              h(
                'span',
                {
                  class: 'reference-node',
                  'data-testid': 'reference-node',
                  onClick: (event: MouseEvent) => emit('click', event),
                  onMouseover: (event: MouseEvent) => emit('mouseover', event),
                  onMouseout: (event: MouseEvent) => emit('mouseout', event)
                },
                '1'
              )
            ]
          )
      }
    })

    return {
      default: NodeRenderer,
      NodeRenderer,
      removeCustomComponents: removeCustomComponentsMock,
      setCustomComponents: setCustomComponentsMock
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
    getCustomComponents: () => customComponents,
    setCustomComponentsMock,
    removeCustomComponentsMock
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
    navigateLinkMock.mockImplementation(async (_href: string, event?: MouseEvent | null) => {
      event?.preventDefault()
      return true
    })
    nanoidMock.mockReturnValueOnce('fallback-message').mockReturnValueOnce('fallback-thread')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes markdown workers lazily when mounted', async () => {
    await setup()

    expect(ensureMarkdownWorkersMock).toHaveBeenCalledTimes(1)
  })

  it('uses the provided message and thread ids for HTML preview artifacts', async () => {
    const { wrapper } = await setup({
      messageId: 'message-1',
      threadId: 'thread-1'
    })

    await wrapper.get('[data-testid="preview-code"]').trigger('click')

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
    const { wrapper } = await setup()
    await wrapper.get('[data-testid="preview-code"]').trigger('click')

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

  it('normalizes unsupported code fence languages before they reach Markstream', async () => {
    const { wrapper } = await setup({
      content: '```desktop-local-file\nconst answer = 42\n```'
    })

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-content')).toBe(
      '```plaintext\nconst answer = 42\n```'
    )
  })

  it('normalizes unsupported code fence languages during streaming updates', async () => {
    const { wrapper } = await setup({ content: '', streaming: true, final: false })

    await wrapper.setProps({
      content: '~~~DESKTOP-LOCAL-FILE path=src/example.ts\nconst answer = 42\n~~~'
    })

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-content')).toBe(
      '~~~plaintext path=src/example.ts\nconst answer = 42\n~~~'
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
    expect(nodeRenderer.attributes('data-code-renderer')).toBe('monaco')
    expect(nodeRenderer.attributes('data-code-block-theme-count')).toBe('2')
    expect(nodeRenderer.attributes('data-initial-render-batch-size')).toBe('96')
    expect(nodeRenderer.attributes('data-render-batch-size')).toBe('80')
    expect(nodeRenderer.attributes('data-render-batch-delay')).toBe('0')
    expect(nodeRenderer.attributes('data-render-batch-budget-ms')).toBe('8')
    expect(nodeRenderer.attributes('data-render-batch-idle-timeout-ms')).toBe('16')
    expect(nodeRenderer.attributes('data-parse-coalesce-ms')).toBe('0')
  })

  it('keeps prose wrapping from splitting code surfaces at every character', async () => {
    const { wrapper } = await setup()

    expect(wrapper.classes()).toContain('markdown-renderer-root')
    expect(wrapper.classes()).toContain('break-words')
    expect(wrapper.classes()).not.toContain('break-all')
  })

  it('leaves generic code blocks on Markstream’s built-in Monaco path', async () => {
    const { getCustomComponents } = await setup({ mode: 'chat' })

    expect(getCustomComponents().code_block).toBeUndefined()
  })

  it('uses the built-in strict Mermaid renderer without a global custom registry', async () => {
    const { wrapper, getCustomComponents, setCustomComponentsMock, removeCustomComponentsMock } =
      await setup()

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-mermaid-strict')).toBe(
      'true'
    )
    expect(getCustomComponents()).toEqual({})
    expect(setCustomComponentsMock).not.toHaveBeenCalled()

    wrapper.unmount()
    expect(removeCustomComponentsMock).not.toHaveBeenCalled()
  })

  it('keeps each NodeRenderer measurement identity instance-local', async () => {
    const { wrapper } = await setup({ messageId: 'message-1', threadId: 'thread-1' })

    expect(wrapper.get('[data-testid="node-renderer"]').attributes('data-custom-id')).toContain(
      'artifact-msg-fallback-message'
    )
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
    expect(nodeRenderer.attributes('data-typewriter')).toBe('simple')
    expect(nodeRenderer.attributes('data-node-virtual')).toBe('false')
    expect(nodeRenderer.attributes('data-max-live-nodes')).toBe('0')
    expect(nodeRenderer.attributes('data-live-node-buffer')).toBe('0')
    expect(nodeRenderer.attributes('data-code-block-stream')).toBe('true')
    expect(nodeRenderer.attributes('data-code-renderer')).toBe('monaco')
    expect(nodeRenderer.attributes('data-code-block-theme-count')).toBe('2')
    expect(nodeRenderer.attributes('data-defer-nodes-until-visible')).toBe('true')
    expect(nodeRenderer.attributes('data-viewport-priority')).toBe('true')
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

  it('hands live snapshots and final content to Markstream without an app-level timer', async () => {
    vi.useFakeTimers()
    const { wrapper } = await setup({ content: 'static content' })
    const nodeRenderer = () => wrapper.get('[data-testid="node-renderer"]')

    // Queue a static update first so the live path also proves that older debounce
    // work cannot repaint stale content after streaming begins.
    await wrapper.setProps({ content: 'queued static content' })
    expect(nodeRenderer().attributes('data-content')).toBe('static content')

    await wrapper.setProps({
      content: 'first live snapshot',
      streaming: true,
      final: false
    })
    expect(nodeRenderer().attributes('data-content')).toBe('first live snapshot')
    expect(nodeRenderer().attributes('data-code-renderer')).toBe('monaco')
    expect(nodeRenderer().attributes('data-defer-nodes-until-visible')).toBe('true')
    expect(nodeRenderer().attributes('data-viewport-priority')).toBe('true')

    await wrapper.setProps({ content: 'second live snapshot' })
    expect(nodeRenderer().attributes('data-content')).toBe('second live snapshot')

    await wrapper.setProps({
      content: 'final content',
      streaming: false,
      final: true
    })
    expect(nodeRenderer().attributes('data-content')).toBe('final content')
    expect(nodeRenderer().attributes('data-final')).toBe('true')
    expect(nodeRenderer().attributes('data-code-renderer')).toBe('monaco')
    expect(nodeRenderer().attributes('data-defer-nodes-until-visible')).toBe('true')
    expect(nodeRenderer().attributes('data-viewport-priority')).toBe('true')

    vi.advanceTimersByTime(500)
    await wrapper.vm.$nextTick()
    expect(nodeRenderer().attributes('data-content')).toBe('final content')
  })

  it('keeps coalescing updates for non-streaming surfaces', async () => {
    vi.useFakeTimers()
    const { wrapper } = await setup({ content: 'initial static content' })
    const nodeRenderer = () => wrapper.get('[data-testid="node-renderer"]')

    await wrapper.setProps({ content: 'updated static content' })
    expect(nodeRenderer().attributes('data-content')).toBe('initial static content')

    vi.advanceTimersByTime(64)
    await wrapper.vm.$nextTick()
    expect(nodeRenderer().attributes('data-content')).toBe('updated static content')
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

    const { wrapper } = await setup({
      messageId: 'message-1',
      threadId: 'thread-1',
      linkContext: {
        source: 'chat',
        sessionId: 'thread-1'
      } satisfies MarkdownLinkContext
    })

    const clickEvent = new MouseEvent('click', { altKey: true })

    wrapper.get('[data-testid="reference-node"]').element.dispatchEvent(clickEvent)
    await flushPromises()

    expect(getSearchResultsMock).toHaveBeenCalledWith('message-1')
    expect(navigateLinkMock).toHaveBeenCalledWith('https://example.com/reference', clickEvent)
  })

  it('ignores reference results that resolve after the renderer unmounts', async () => {
    const searchResults = createDeferred<Array<{ url: string }>>()
    getSearchResultsMock.mockReturnValueOnce(searchResults.promise)
    const { wrapper } = await setup({ messageId: 'message-1' })

    wrapper.get('[data-testid="reference-node"]').element.dispatchEvent(new MouseEvent('click'))
    wrapper.unmount()
    searchResults.resolve([{ url: 'https://example.com/stale' }])
    await flushPromises()

    expect(navigateLinkMock).not.toHaveBeenCalled()
  })

  it('routes built-in link clicks through the shared markdown link navigator', async () => {
    const { wrapper } = await setup()
    const clickEvent = new MouseEvent('click', { cancelable: true })

    wrapper.get('[data-testid="rendered-link"]').element.dispatchEvent(clickEvent)
    await flushPromises()

    expect(navigateLinkMock).toHaveBeenCalledWith('https://example.com/link', clickEvent)
  })

  it('does not take over anchors without Markstream’s link marker', async () => {
    const { wrapper } = await setup()
    const clickEvent = new MouseEvent('click')
    Object.defineProperty(clickEvent, 'target', {
      value: wrapper.get('[data-testid="unmarked-anchor"]').element
    })

    wrapper.findComponent({ name: 'NodeRenderer' }).vm.$emit('click', clickEvent)
    await flushPromises()

    expect(navigateLinkMock).not.toHaveBeenCalled()
  })

  it('supports keyboard activation for built-in reference nodes', async () => {
    getSearchResultsMock.mockResolvedValueOnce([{ url: 'https://example.com/reference' }])
    const { wrapper } = await setup({ messageId: 'message-1' })
    const referenceElement = wrapper.get('[data-testid="reference-node"]').element

    referenceElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(navigateLinkMock).toHaveBeenCalledWith(
      'https://example.com/reference',
      expect.any(MouseEvent)
    )
  })

  it('anchors reference previews to the delegated reference element', async () => {
    getSearchResultsMock.mockResolvedValueOnce([{ url: 'https://example.com/reference' }])
    const { wrapper } = await setup({ messageId: 'message-1' })
    const referenceElement = wrapper.get('[data-testid="reference-node"]').element as HTMLElement
    const rect = referenceElement.getBoundingClientRect()

    referenceElement.dispatchEvent(new MouseEvent('mouseover'))
    await flushPromises()

    expect(showReferenceMock).toHaveBeenCalledWith({ url: 'https://example.com/reference' }, rect)

    referenceElement.dispatchEvent(new MouseEvent('mouseout'))
    expect(hideReferenceMock).toHaveBeenCalled()
  })
})
