import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, onUnmounted, provide, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SetupOptions = {
  collapsed?: boolean
  currentRoute?: 'newThread' | 'chat'
  selectedAgentId?: string | null
  chatSessionId?: string | null
  newConversationTargetAgentId?: string | null
  sessionError?: string | null
  activeSessionId?: string | null
  bootstrapActiveSessionId?: string | null
  bootstrapReject?: boolean
  performanceReporter?: {
    recordStartup: ReturnType<typeof vi.fn>
    observeStartupWorkload: ReturnType<typeof vi.fn>
  }
}

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()

  const { recentMessageMeasurementCache } =
    await import('@/composables/message/recentMessageMeasurementCache')
  recentMessageMeasurementCache.clear()
  let nextChatPageInstanceId = 1
  const chatPageMounts: Array<{ instanceId: number; sessionId: string }> = []

  const markStartupInteractive = vi.fn()
  const pageRouter = reactive({
    currentRoute: options.currentRoute ?? 'newThread',
    chatSessionId: options.chatSessionId ?? (options.currentRoute === 'chat' ? 'session-1' : null),
    initialize: vi.fn().mockResolvedValue(undefined)
  })
  const sessionStore = reactive({
    activeSession:
      options.currentRoute === 'chat'
        ? {
            projectDir: 'C:/repo',
            providerId: 'openai'
          }
        : null,
    activeSessionId:
      options.activeSessionId ??
      options.chatSessionId ??
      (options.currentRoute === 'chat' ? 'session-1' : null),
    error: options.sessionError ?? null,
    newConversationTargetAgentId: options.newConversationTargetAgentId ?? 'deepchat',
    hasLoadedInitialPage: false,
    applyBootstrapShell: vi.fn().mockImplementation(async ({ activeSessionId, activeSession }) => {
      sessionStore.activeSessionId = activeSessionId
      sessionStore.activeSession = activeSession
    }),
    fetchSessions: vi.fn().mockResolvedValue(undefined),
    startNewConversation: vi.fn().mockResolvedValue(undefined)
  })
  const agentStore = reactive({
    selectedAgentId: options.selectedAgentId ?? null,
    applyBootstrapAgents: vi.fn(),
    fetchAgents: vi.fn().mockResolvedValue(undefined)
  })
  const sidebarStore = reactive({
    collapsed: options.collapsed ?? false
  })
  const projectStore = {
    applyBootstrapDefaultProjectPath: vi.fn(),
    loadDefaultProjectPath: vi.fn().mockResolvedValue(undefined),
    fetchProjects: vi.fn().mockResolvedValue(undefined)
  }
  const modelStore = {
    initialize: vi.fn().mockResolvedValue(undefined)
  }
  const ollamaStore = {
    initialize: vi.fn().mockResolvedValue(undefined)
  }

  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => pageRouter
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/ui/sidebar', () => ({
    useSidebarStore: () => sidebarStore
  }))
  vi.doMock('@/stores/ui/project', () => ({
    useProjectStore: () => projectStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/ollamaStore', () => ({
    useOllamaStore: () => ollamaStore
  }))
  vi.doMock('@api/StartupClient', () => ({
    createStartupClient: () => ({
      getBootstrap: vi.fn().mockImplementation(async () => {
        if (options.bootstrapReject) {
          throw new Error('bootstrap failed')
        }

        return {
          startupRunId: 'run-1',
          activeSessionId:
            options.bootstrapActiveSessionId === undefined
              ? sessionStore.activeSessionId
              : options.bootstrapActiveSessionId,
          activeSession:
            options.bootstrapActiveSessionId === undefined
              ? sessionStore.activeSession
              : options.bootstrapActiveSessionId
                ? { ...sessionStore.activeSession, id: options.bootstrapActiveSessionId }
                : null,
          agents:
            agentStore.selectedAgentId === null
              ? []
              : [
                  {
                    id: agentStore.selectedAgentId,
                    name: agentStore.selectedAgentId
                  }
                ],
          defaultProjectPath: 'C:/repo',
          defaultChatWorkspacePath: null
        }
      })
    })
  }))
  vi.doMock('@/lib/startupDeferred', () => ({
    markStartupInteractive,
    scheduleStartupDeferredTask: vi.fn((task: () => void | Promise<void>) => {
      void task()
      return () => {}
    })
  }))
  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => ({
      getSetting: vi.fn().mockResolvedValue(undefined)
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({
      name: 'Icon',
      template: '<span data-testid="icon" />'
    })
  }))
  vi.doMock('@/components/sidepanel/ChatSidePanel.vue', () => ({
    default: defineComponent({
      name: 'ChatSidePanel',
      props: {
        sessionId: {
          type: String,
          default: null
        },
        workspacePath: {
          type: String,
          default: null
        }
      },
      template: '<div data-testid="chat-side-panel" />'
    })
  }))

  vi.doMock('@/components/browser/AgentBrowserPiP.vue', () => ({
    default: defineComponent({
      name: 'AgentBrowserPiP',
      template: '<div data-testid="agent-browser-pip-stub" />'
    })
  }))
  vi.doMock('@/pages/AgentWelcomePage.vue', () => ({
    default: defineComponent({
      name: 'AgentWelcomePage',
      template: '<div data-testid="agent-welcome-page" />'
    })
  }))
  vi.doMock('@/pages/NewThreadPage.vue', () => ({
    default: defineComponent({
      name: 'NewThreadPage',
      template: '<div data-testid="new-thread-page" />'
    })
  }))
  vi.doMock('@/features/chat-page/ChatPage.vue', () => ({
    default: defineComponent({
      name: 'ChatPage',
      props: {
        sessionId: {
          type: String,
          required: true
        }
      },
      setup(props) {
        const sessionId = props.sessionId
        const instanceId = nextChatPageInstanceId
        nextChatPageInstanceId += 1
        const cachedHeight = recentMessageMeasurementCache.get(sessionId)?.message ?? null
        chatPageMounts.push({ instanceId, sessionId })
        onUnmounted(() => {
          recentMessageMeasurementCache.set(sessionId, { message: 321 })
        })
        return { cachedHeight, instanceId }
      },
      template:
        '<div data-testid="chat-page" :data-instance-id="instanceId" :data-cached-height="cachedHeight">{{ sessionId }}</div>'
    })
  }))

  const ChatTabView = (await import('@/views/ChatTabView.vue')).default
  const { RENDERER_PERFORMANCE_REPORTER } =
    await import('@/platform/performance/rendererPerformance')
  const Host = defineComponent({
    components: { ChatTabView },
    setup() {
      if (options.performanceReporter) {
        provide(RENDERER_PERFORMANCE_REPORTER, options.performanceReporter as never)
      }
    },
    template: '<ChatTabView />'
  })
  const wrapper = mount(Host)

  await flushPromises()
  await vi.runAllTimersAsync()
  await flushPromises()

  return {
    wrapper,
    pageRouter,
    agentStore,
    modelStore,
    ollamaStore,
    projectStore,
    sessionStore,
    markStartupInteractive,
    chatPageMounts,
    recentMessageMeasurementCache
  }
}

describe('ChatTabView startup and routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs full model compensation in deferred hydration after the first screen becomes interactive', async () => {
    const { modelStore, ollamaStore, markStartupInteractive } = await setup({
      collapsed: false,
      currentRoute: 'newThread',
      selectedAgentId: 'deepchat'
    })

    expect(markStartupInteractive).toHaveBeenCalledTimes(1)
    expect(modelStore.initialize).toHaveBeenCalledTimes(1)
    expect(ollamaStore.initialize).toHaveBeenCalledTimes(1)
  })

  it('records bootstrap, route, interactive, and deferred phases through the app-scoped reporter', async () => {
    const performanceReporter = {
      recordStartup: vi.fn(),
      observeStartupWorkload: vi.fn()
    }

    await setup({ performanceReporter })

    expect(performanceReporter.recordStartup).toHaveBeenCalledWith('bootstrap-ready', {
      startupRunId: 'run-1'
    })
    expect(performanceReporter.recordStartup).toHaveBeenCalledWith('route-ready')
    expect(performanceReporter.recordStartup).toHaveBeenCalledWith('interactive')
    expect(performanceReporter.recordStartup).toHaveBeenCalledWith('deferred-settled')
  })

  it('starts the initial session request only after bootstrap shell hydration', async () => {
    const { sessionStore } = await setup({
      currentRoute: 'chat',
      activeSessionId: null,
      bootstrapActiveSessionId: 'bootstrap-session'
    })

    expect(sessionStore.applyBootstrapShell).toHaveBeenCalledWith(
      expect.objectContaining({ activeSessionId: 'bootstrap-session' })
    )
    expect(sessionStore.fetchSessions).toHaveBeenCalledTimes(1)
    expect(sessionStore.fetchSessions.mock.invocationCallOrder[0]).toBeGreaterThan(
      sessionStore.applyBootstrapShell.mock.invocationCallOrder[0]
    )
    expect(sessionStore.activeSessionId).toBe('bootstrap-session')
  })

  it('preserves an explicit null bootstrap session id', async () => {
    const { sessionStore } = await setup({
      currentRoute: 'chat',
      activeSessionId: 'session-1',
      bootstrapActiveSessionId: null
    })

    expect(sessionStore.applyBootstrapShell).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSessionId: null,
        activeSession: null
      })
    )
  })

  it('hydrates the route from the session store state and keeps provider warmup on demand', async () => {
    const { pageRouter, agentStore, projectStore, sessionStore, markStartupInteractive } =
      await setup({
        collapsed: false,
        currentRoute: 'chat',
        chatSessionId: 'session-42',
        selectedAgentId: 'acp-a'
      })

    expect(sessionStore.fetchSessions).toHaveBeenCalledTimes(1)
    expect(projectStore.applyBootstrapDefaultProjectPath).toHaveBeenCalledWith('C:/repo', null)
    expect(pageRouter.initialize).toHaveBeenCalledWith({
      activeSessionId: 'session-42'
    })
    expect(markStartupInteractive).toHaveBeenCalledTimes(1)
    expect(agentStore.fetchAgents).toHaveBeenCalledTimes(1)
    expect(projectStore.fetchProjects).toHaveBeenCalledTimes(1)
  })

  it('falls back to route recovery when the session snapshot is unusable', async () => {
    const { pageRouter, sessionStore } = await setup({
      collapsed: false,
      currentRoute: 'newThread',
      activeSessionId: null,
      sessionError: 'Failed to load sessions',
      bootstrapReject: true
    })

    expect(sessionStore.fetchSessions).toHaveBeenCalledTimes(1)
    expect(pageRouter.initialize).toHaveBeenCalledWith()
    expect(pageRouter.initialize).not.toHaveBeenCalledWith({
      activeSessionId: null
    })
  })

  it('passes a null session id through fallback recovery when the snapshot is still usable', async () => {
    const { pageRouter, sessionStore } = await setup({
      collapsed: false,
      currentRoute: 'newThread',
      activeSessionId: null,
      sessionError: null
    })

    expect(sessionStore.fetchSessions).toHaveBeenCalledTimes(1)
    expect(pageRouter.initialize).toHaveBeenCalledWith({
      activeSessionId: null
    })
  })

  it('does not render the legacy collapsed new chat button when the sidebar is expanded', async () => {
    const { wrapper } = await setup({
      collapsed: false,
      currentRoute: 'newThread',
      selectedAgentId: 'deepchat'
    })

    expect(wrapper.find('[data-testid="collapsed-new-chat-button"]').exists()).toBe(false)
  })

  it('does not render the legacy collapsed new chat button on the all-agents welcome page', async () => {
    const { wrapper } = await setup({
      collapsed: true,
      currentRoute: 'newThread',
      selectedAgentId: null,
      newConversationTargetAgentId: 'deepchat'
    })

    expect(wrapper.find('[data-testid="agent-welcome-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="collapsed-new-chat-button"]').exists()).toBe(false)
  })

  it('does not render the legacy collapsed new chat button on the selected-agent new thread page', async () => {
    const { wrapper } = await setup({
      collapsed: true,
      currentRoute: 'newThread',
      selectedAgentId: 'acp-a',
      newConversationTargetAgentId: 'acp-a'
    })

    expect(wrapper.find('[data-testid="new-thread-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="collapsed-new-chat-button"]').exists()).toBe(false)
  })

  it('does not render the legacy collapsed new chat button on the chat page', async () => {
    const { wrapper } = await setup({
      collapsed: true,
      currentRoute: 'chat',
      selectedAgentId: 'acp-a',
      chatSessionId: 'session-42',
      newConversationTargetAgentId: 'acp-a'
    })

    expect(wrapper.find('[data-testid="chat-page"]').text()).toContain('session-42')
    expect(wrapper.find('[data-testid="collapsed-new-chat-button"]').exists()).toBe(false)
  })

  it('preserves session measurements across keyed ChatPage remounts', async () => {
    const { wrapper, pageRouter, chatPageMounts, recentMessageMeasurementCache } = await setup({
      currentRoute: 'chat',
      chatSessionId: 'session-1'
    })

    const firstInstanceId = wrapper.get('[data-testid="chat-page"]').attributes('data-instance-id')
    pageRouter.chatSessionId = 'session-2'
    await wrapper.vm.$nextTick()

    expect(recentMessageMeasurementCache.get('session-1')).toEqual({ message: 321 })

    pageRouter.chatSessionId = 'session-1'
    await wrapper.vm.$nextTick()

    const restoredPage = wrapper.get('[data-testid="chat-page"]')
    expect(restoredPage.attributes('data-instance-id')).not.toBe(firstInstanceId)
    expect(restoredPage.attributes('data-cached-height')).toBe('321')
    expect(chatPageMounts.map(({ sessionId }) => sessionId)).toEqual([
      'session-1',
      'session-2',
      'session-1'
    ])
  })
})
