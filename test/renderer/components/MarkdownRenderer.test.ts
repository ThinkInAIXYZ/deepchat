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
        codeBlockStream: {
          type: Boolean,
          default: false
        },
        codeBlockOptions: {
          type: Object,
          default: undefined
        },
        themes: {
          type: Array,
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
        content: {
          type: String,
          default: ''
        },
        parseOptions: {
          type: Object,
          default: undefined
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
              'data-code-block-stream': String(props.codeBlockStream),
              'data-code-block-overflow': props.codeBlockOptions?.overflow,
              'data-code-block-font-family': props.codeBlockOptions?.fontFamily,
              'data-code-block-themes': props.themes?.join(','),
              'data-mermaid-strict': String(props.mermaidProps?.isStrict),
              'data-custom-id': props.customId,
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
      normalizeLanguageIdentifier: (language?: string) => {
        const normalized = language?.trim().toLowerCase() ?? ''
        return normalized === 'zsh' ? 'shell' : normalized === 'plaintext' ? 'plain' : normalized
      },
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

  it('leaves generic code blocks on Markstream’s built-in enhanced path', async () => {
    const { getCustomComponents } = await setup({ mode: 'chat' })

    expect(getCustomComponents().code_block).toBeUndefined()
  })

  it('passes renderer-neutral code block options and themes', async () => {
    const { wrapper } = await setup()
    const renderer = wrapper.get('[data-testid="node-renderer"]')

    expect(renderer.attributes('data-code-block-overflow')).toBe('wrap')
    expect(renderer.attributes('data-code-block-font-family')).toBe('monospace')
    expect(renderer.attributes('data-code-block-themes')).toBe('vitesse-dark,vitesse-light')
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

  it('keeps prose wrapping from splitting code surfaces at every character', async () => {
    const { wrapper } = await setup()

    expect(wrapper.classes()).toContain('markdown-renderer-root')
    expect(wrapper.classes()).toContain('break-words')
    expect(wrapper.classes()).not.toContain('break-all')
  })

  it('passes final and code block streaming flags for live content', async () => {
    const { wrapper } = await setup({ streaming: true, final: false })
    const nodeRenderer = wrapper.get('[data-testid="node-renderer"]')

    expect(nodeRenderer.attributes('data-final')).toBe('false')
    expect(nodeRenderer.attributes('data-code-block-stream')).toBe('true')
  })

  it('suppresses only Markdown image nodes backed by promoted local images', async () => {
    const { wrapper } = await setup({
      hiddenImageSources: ['imgcache://generated.png']
    })
    const parseOptions = wrapper.findComponent({ name: 'NodeRenderer' }).props('parseOptions') as {
      postTransformNodes(nodes: any[]): any[]
    }
    const nodes = [
      {
        type: 'paragraph',
        raw: 'images',
        children: [
          {
            type: 'image',
            raw: '![generated](imgcache://generated.png)',
            src: 'imgcache://generated.png',
            alt: 'generated',
            title: null
          },
          {
            type: 'image',
            raw: '![external](https://example.com/external.png)',
            src: 'https://example.com/external.png',
            alt: 'external',
            title: null
          }
        ]
      }
    ]

    expect(parseOptions.postTransformNodes(nodes)).toEqual([
      {
        type: 'paragraph',
        raw: 'images',
        children: [
          {
            type: 'image',
            raw: '![external](https://example.com/external.png)',
            src: 'https://example.com/external.png',
            alt: 'external',
            title: null
          }
        ]
      }
    ])
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

  it('retries reference interactions after a search-result request fails', async () => {
    getSearchResultsMock
      .mockRejectedValueOnce(new Error('transient search failure'))
      .mockResolvedValueOnce([{ url: 'https://example.com/reference' }])
    const { wrapper } = await setup({ messageId: 'message-1' })
    const referenceElement = wrapper.get('[data-testid="reference-node"]').element

    referenceElement.dispatchEvent(new MouseEvent('click'))
    await flushPromises()

    expect(navigateLinkMock).not.toHaveBeenCalled()
    expect(showReferenceMock).not.toHaveBeenCalled()

    referenceElement.dispatchEvent(new MouseEvent('mouseover'))
    await flushPromises()

    expect(getSearchResultsMock).toHaveBeenCalledTimes(2)
    expect(showReferenceMock).toHaveBeenCalledOnce()
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
