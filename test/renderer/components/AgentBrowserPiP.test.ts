import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { YoBrowserStatus } from '@shared/types/browser'

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

const setup = async () => {
  vi.resetModules()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  let statusChangedHandler:
    | ((payload: { sessionId: string; status: YoBrowserStatus | null }) => void)
    | null = null
  const status = createStatus()
  const browserClient = {
    getStatus: vi.fn(async () => status),
    attachCurrentWindow: vi.fn(async () => true),
    updateCurrentWindowBounds: vi.fn(async () => true),
    onOpenRequestedForCurrentWindow: vi.fn(() => vi.fn()),
    onStatusChanged: vi.fn(
      (handler: (payload: { sessionId: string; status: YoBrowserStatus | null }) => void) => {
        statusChangedHandler = handler
        return vi.fn()
      }
    )
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
  await flushPromises()

  return { wrapper, browserClient, sidepanelStore, sessionStore, emitStatus: statusChangedHandler! }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AgentBrowserPiP', () => {
  it('shows a compact activity bar for an active Agent run and hides when the loop ends', async () => {
    const { wrapper, sessionStore } = await setup()

    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(true)

    sessionStore.sessions[0].status = 'completed'
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(false)
  })

  it('moves the active Agent browser into the sidepanel on request', async () => {
    const { wrapper, browserClient, sidepanelStore } = await setup()

    await wrapper.get('[aria-label="common.open"]').trigger('click')
    await flushPromises()

    expect(browserClient.updateCurrentWindowBounds).toHaveBeenCalledWith(
      'session-1',
      { x: 0, y: 0, width: 0, height: 0 },
      false
    )
    expect(sidepanelStore.openBrowser).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(false)
  })

  it('stays dismissed for the current run', async () => {
    const { wrapper } = await setup()

    await wrapper.get('[aria-label="common.close"]').trigger('click')
    await nextTick()

    expect(wrapper.find('[data-testid="agent-browser-pip"]').exists()).toBe(false)
  })
})
