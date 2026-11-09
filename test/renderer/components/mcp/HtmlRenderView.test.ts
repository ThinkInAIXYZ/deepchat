import { defineComponent, onMounted } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { prepareHtmlRenderView } = vi.hoisted(() => ({ prepareHtmlRenderView: vi.fn() }))

vi.mock('@api/McpClient', () => ({
  createMcpClient: () => ({ prepareHtmlRenderView, readHtmlRenderSections: vi.fn() })
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/theme', () => ({ useThemeStore: () => ({ isDark: false }) }))
vi.mock('@vueuse/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vueuse/core')>()),
  useIntersectionObserver: (
    _target: unknown,
    callback: (entries: Array<{ isIntersecting: boolean }>) => void
  ) => {
    queueMicrotask(() => callback([{ isIntersecting: true }]))
    return { stop: vi.fn() }
  }
}))

const frameStub = defineComponent({
  name: 'HostViewFrame',
  props: { prepare: { type: Function, required: true } },
  emits: ['ready', 'error'],
  setup(props, { emit }) {
    onMounted(() => {
      ;(props.prepare as () => Promise<unknown>)().then(
        () => emit('ready'),
        () => emit('error')
      )
    })
    return {}
  },
  template: '<div />'
})

describe('HtmlRenderView', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads a panel that mounts before its shell is written to the database', async () => {
    vi.useFakeTimers()
    const missing = new Error('The rendered page is no longer available')
    prepareHtmlRenderView
      .mockRejectedValueOnce(missing)
      .mockRejectedValueOnce(missing)
      .mockResolvedValue({ instanceId: 'view-1' })
    const HtmlRenderView = (await import('@/components/mcp/HtmlRenderView.vue')).default
    const wrapper = mount(HtmlRenderView, {
      props: { conversationId: 's1', messageId: 'm1', blockId: 'b1', title: 'Chart' },
      global: { stubs: { HostViewFrame: frameStub, DcButton: true, Icon: true } }
    })

    await vi.advanceTimersByTimeAsync(1000)

    expect(prepareHtmlRenderView).toHaveBeenCalledTimes(3)
    expect(wrapper.find('[data-testid="html-render-error"]').exists()).toBe(false)
  })
})
