import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { YoBrowserStatus } from '@shared/types/browser'

const mountedWrappers: Array<{ unmount: () => void }> = []

const createStatus = (runId = 'run-1'): YoBrowserStatus => ({
  initialized: true,
  page: {
    id: 'page-1',
    url: 'https://example.com',
    title: 'Example',
    status: 'ready' as never,
    createdAt: 1,
    updatedAt: 1
  },
  canGoBack: false,
  canGoForward: false,
  visible: false,
  loading: false,
  owner: 'agent',
  agentRunId: runId
})

const setup = async (options: { wide?: boolean } = {}) => {
  vi.resetModules()
  if (options.wide) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({})
    })
  }
  let statusChangedHandler:
    | ((payload: { sessionId: string; status: YoBrowserStatus | null }) => void)
    | null = null
  let previewFrameHandler:
    | ((payload: {
        sessionId: string
        runId: string
        sequence: number
        width: number
        height: number
        mimeType: 'image/jpeg'
        data: Uint8Array
        timestamp: number
      }) => void)
    | null = null
  let windowStateHandler: ((payload: { exists: boolean; isFocused: boolean }) => void) | null = null
  const status = createStatus()
  const browserClient = {
    getStatus: vi.fn(async () => status),
    setPreviewMode: vi.fn(async () => true),
    onOpenRequestedForCurrentWindow: vi.fn(() => vi.fn()),
    onStatusChanged: vi.fn(
      (handler: (payload: { sessionId: string; status: YoBrowserStatus | null }) => void) => {
        statusChangedHandler = handler
        return vi.fn()
      }
    ),
    onActivityChanged: vi.fn(() => vi.fn()),
    onPreviewFrame: vi.fn((handler: NonNullable<typeof previewFrameHandler>) => {
      previewFrameHandler = handler
      return vi.fn()
    })
  }
  const windowClient = {
    getCurrentState: vi.fn(async () => ({ exists: true, isFocused: true })),
    onCurrentStateChanged: vi.fn((handler: NonNullable<typeof windowStateHandler>) => {
      windowStateHandler = handler
      return vi.fn()
    })
  }
  const sidepanelStore = reactive({
    open: false,
    activeTab: 'workspace',
    openBrowser: vi.fn(() => {
      sidepanelStore.open = true
      sidepanelStore.activeTab = 'browser'
    })
  })
  const sessionStore = reactive({
    sessions: [{ id: 'session-1', status: 'working' }]
  })

  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({ name: 'Icon', template: '<span />' })
  }))
  vi.doMock('@api/BrowserClient', () => ({ createBrowserClient: () => browserClient }))
  vi.doMock('@api/WindowClient', () => ({ createWindowClient: () => windowClient }))
  vi.doMock('@/stores/ui/sidepanel', () => ({ useSidepanelStore: () => sidepanelStore }))
  vi.doMock('@/stores/ui/session', () => ({ useSessionStore: () => sessionStore }))

  const AgentBrowserPiP = (await import('@/components/browser/AgentBrowserPiP.vue')).default
  const wrapper = mount(AgentBrowserPiP, {
    props: { sessionId: 'session-1' },
    global: {
      stubs: {
        Button: defineComponent({
          name: 'Button',
          emits: ['click'],
          template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
        })
      }
    }
  })
  mountedWrappers.push(wrapper)
  await flushPromises()

  return {
    wrapper,
    browserClient,
    sidepanelStore,
    sessionStore,
    emitStatus: statusChangedHandler!,
    emitPreviewFrame: previewFrameHandler!,
    emitWindowState: windowStateHandler!
  }
}

afterEach(async () => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  await flushPromises()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AgentBrowserPiP', () => {
  it('shows a compact activity bar for an active Agent run and hides when the loop ends', async () => {
    const { wrapper, browserClient, sessionStore } = await setup()

    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(true)

    sessionStore.sessions[0].status = 'completed'
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(false)
    expect(browserClient.setPreviewMode).toHaveBeenCalledWith('session-1', 'stopped', 'run-1')
  })

  it('moves the active Agent browser into the sidepanel on request', async () => {
    const { wrapper, browserClient, sidepanelStore } = await setup()

    await wrapper.get('[aria-label="common.open"]').trigger('click')
    await flushPromises()

    expect(browserClient.setPreviewMode).toHaveBeenCalledWith('session-1', 'stopped', 'run-1')
    expect(sidepanelStore.openBrowser).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(false)
  })

  it('stays dismissed for the current run', async () => {
    const { wrapper } = await setup()

    await wrapper.get('[aria-label="common.close"]').trigger('click')
    await nextTick()

    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(false)
  })

  it('reveals controls on click and drags from the mirror surface', async () => {
    const { wrapper, browserClient } = await setup({ wide: true })
    const pip = wrapper.get('[data-testid="agent-browser-pip"]')

    const toolbar = wrapper.get('[data-testid="agent-browser-pip-toolbar"]')
    expect(toolbar.classes()).toContain('group-hover:opacity-100')
    expect(wrapper.find('[data-testid="agent-browser-pip-drag-hint"]').exists()).toBe(true)
    expect(pip.attributes('style')).toContain('width: 400px')
    expect(pip.attributes('style')).toContain('height: 250px')
    await pip.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    await pip.trigger('pointerup', { pointerId: 1, clientX: 100, clientY: 100 })
    expect(toolbar.classes()).toContain('opacity-100')

    const leftBefore = pip.attributes('style')
    await pip.trigger('pointerdown', { button: 0, pointerId: 2, clientX: 100, clientY: 100 })
    await pip.trigger('pointermove', { pointerId: 2, clientX: 150, clientY: 130 })
    await pip.trigger('pointerup', { pointerId: 2, clientX: 150, clientY: 130 })

    expect(pip.attributes('style')).not.toBe(leftBefore)
    expect(browserClient.setPreviewMode).toHaveBeenCalledWith('session-1', 'capturing', 'run-1')
  })

  it('draws a decoded preview frame into the local Canvas', async () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValueOnce({ close }).mockRejectedValueOnce(new Error('decode failed'))
    )
    const { wrapper, emitPreviewFrame } = await setup({ wide: true })

    emitPreviewFrame({
      sessionId: 'session-1',
      runId: 'run-1',
      sequence: 1,
      width: 480,
      height: 300,
      mimeType: 'image/jpeg',
      data: new Uint8Array([1, 2, 3]),
      timestamp: Date.now()
    })
    await flushPromises()

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 480, 300)
    expect(close).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="agent-browser-pip-placeholder"]').exists()).toBe(false)

    emitPreviewFrame({
      sessionId: 'session-1',
      runId: 'run-1',
      sequence: 2,
      width: 480,
      height: 300,
      mimeType: 'image/jpeg',
      data: new Uint8Array([4, 5, 6]),
      timestamp: Date.now()
    })
    await flushPromises()

    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="agent-browser-pip-placeholder"]').exists()).toBe(false)
  })

  it('accepts a reset frame sequence when the Agent run changes', async () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() }))
    )
    const { wrapper, emitStatus, emitPreviewFrame } = await setup({ wide: true })

    emitPreviewFrame({
      sessionId: 'session-1',
      runId: 'run-1',
      sequence: 10,
      width: 480,
      height: 300,
      mimeType: 'image/jpeg',
      data: new Uint8Array([1]),
      timestamp: Date.now()
    })
    await flushPromises()

    emitStatus({ sessionId: 'session-1', status: createStatus('run-2') })
    await nextTick()
    expect(wrapper.find('[data-testid="agent-browser-pip-placeholder"]').exists()).toBe(true)

    emitPreviewFrame({
      sessionId: 'session-1',
      runId: 'run-2',
      sequence: 0,
      width: 480,
      height: 300,
      mimeType: 'image/jpeg',
      data: new Uint8Array([2]),
      timestamp: Date.now()
    })
    await flushPromises()

    expect(drawImage).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="agent-browser-pip-placeholder"]').exists()).toBe(false)
  })

  it('keeps rendering in the background without publishing frames when the window blurs', async () => {
    const { wrapper, browserClient, emitWindowState } = await setup({ wide: true })

    emitWindowState({ exists: true, isFocused: false })
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(false)
    expect(browserClient.setPreviewMode).toHaveBeenCalledWith('session-1', 'rendering', 'run-1')
  })
})
