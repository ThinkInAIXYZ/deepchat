import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ensureMarkdownWorkersMock } = vi.hoisted(() => ({
  ensureMarkdownWorkersMock: vi.fn().mockResolvedValue(undefined)
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
      }
    },
    setup(props) {
      return () => h('div', { 'data-testid': 'node-renderer' }, props.content)
    }
  })

  const PassthroughNode = defineComponent({
    name: 'PassthroughNode',
    render() {
      return h('div')
    }
  })

  return {
    default: NodeRenderer,
    NodeRenderer,
    CodeBlockNode: PassthroughNode,
    PreCodeNode: {
      vue: PassthroughNode
    },
    setCustomComponents: vi.fn()
  }
})

const mountThinkContent = async () => {
  const ThinkContent = (await import('@/components/think-content/ThinkContent.vue')).default
  const wrapper = mount(ThinkContent, {
    props: {
      label: 'Thinking',
      expanded: true,
      thinking: false,
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
  })

  it('initializes markdown workers lazily when mounted', async () => {
    await mountThinkContent()

    expect(ensureMarkdownWorkersMock).toHaveBeenCalledTimes(1)
  })
})
