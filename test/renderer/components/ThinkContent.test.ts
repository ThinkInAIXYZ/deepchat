import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ensureMarkdownWorkersMock, setCustomComponentsMock } = vi.hoisted(() => ({
  ensureMarkdownWorkersMock: vi.fn().mockResolvedValue(undefined),
  setCustomComponentsMock: vi.fn()
}))

vi.mock('@/lib/markdownWorkerLifecycle', () => ({
  ensureMarkdownWorkers: ensureMarkdownWorkersMock
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    isDark: false
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    props: {
      icon: {
        type: String,
        required: true
      }
    },
    setup(props) {
      return () => h('span', { 'data-icon': props.icon })
    }
  })
}))

vi.mock('markstream-vue', () => {
  const NodeRenderer = defineComponent({
    name: 'NodeRenderer',
    props: {
      content: {
        type: String,
        default: ''
      },
      final: {
        type: Boolean,
        default: false
      },
      smoothStreaming: {
        type: Boolean,
        default: true
      },
      codeBlockStream: {
        type: Boolean,
        default: true
      },
      codeBlockProps: {
        type: Object,
        default: undefined
      }
    },
    setup(props) {
      return () => h('div', { 'data-testid': 'node-renderer' }, props.content)
    }
  })

  const PreCodeNode = defineComponent({
    name: 'PreCodeNode',
    render() {
      return h('pre')
    }
  })

  return {
    default: NodeRenderer,
    NodeRenderer,
    PreCodeNode,
    setCustomComponents: setCustomComponentsMock
  }
})

const mountThinkContent = async (thinking = false) => {
  vi.resetModules()
  const ThinkContent = (await import('@/components/think-content/ThinkContent.vue')).default
  const wrapper = mount(ThinkContent, {
    props: {
      label: 'Thinking',
      expanded: true,
      thinking,
      content: 'reasoning content'
    }
  })

  await flushPromises()

  return wrapper
}

describe('ThinkContent', () => {
  beforeEach(() => {
    ensureMarkdownWorkersMock.mockReset()
    ensureMarkdownWorkersMock.mockResolvedValue(undefined)
    setCustomComponentsMock.mockReset()
  })

  it('initializes markdown workers lazily when mounted', async () => {
    await mountThinkContent()

    expect(ensureMarkdownWorkersMock).toHaveBeenCalledTimes(1)
  })

  it('uses Markstream lifecycle props for live and completed thinking', async () => {
    const wrapper = await mountThinkContent()
    const renderer = wrapper.getComponent({ name: 'NodeRenderer' })

    expect(renderer.props()).toMatchObject({
      final: true,
      smoothStreaming: false,
      codeBlockStream: false,
      codeBlockProps: {
        isShowPreview: false,
        showCopyButton: false,
        showExpandButton: false,
        showPreviewButton: false,
        showFontSizeButtons: false
      }
    })

    await wrapper.setProps({ thinking: true })

    expect(renderer.props()).toMatchObject({
      final: false,
      smoothStreaming: false,
      codeBlockStream: true
    })
  })

  it('keeps Mermaid source-only without overriding ordinary code blocks', async () => {
    await mountThinkContent()

    expect(setCustomComponentsMock).toHaveBeenCalledTimes(1)
    const [customId, components] = setCustomComponentsMock.mock.calls[0]
    const mermaid = components.mermaid({ node: { language: 'mermaid' } })

    expect(customId).toBe('thinking-content')
    expect(components.code_block).toBeUndefined()
    expect(mermaid.type.name).toBe('PreCodeNode')
  })
})
