import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SetupOptions = {
  collapsed?: boolean
  currentRoute?: 'newThread' | 'chat'
  selectedAgentId?: string | null
  chatSessionId?: string | null
  newConversationTargetAgentId?: string | null
  sessionError?: string | null
  activeSessionId?: string | null
  bootstrapReject?: boolean
}

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()

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
    applyBootstrapShell: vi.fn().mockResolvedValue(undefined),
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
          activeSessionId: sessionStore.activeSessionId,
          activeSession: sessionStore.activeSession,
          agents:
            agentStore.selectedAgentId === null
              ? []
              : [
                  {
                    id: agentStore.selectedAgentId,
                    name: agentStore.selectedAgentId
                  }
                ],
          defaultProjectPath: 'C:/repo'
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
  vi.doMock('@/pages/ChatPage.vue', () => ({
    default: defineComponent({
      name: 'ChatPage',
      props: {
        sessionId: {
          type: String,
          required: true
        }
      },
      template: '<div data-testid="chat-page">{{ sessionId }}</div>'
    })
  }))

  const ChatTabView = (await import('@/views/ChatTabView.vue')).default
  const wrapper = mount(ChatTabView)

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
    markStartupInteractive
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

  it('hydrates the route from the session store state and keeps provider warmup on demand', async () => {
    const { pageRouter, agentStore, projectStore, sessionStore, markStartupInteractive } =
      await setup({
        collapsed: false,
        currentRoute: 'chat',
        chatSessionId: 'session-42',
        selectedAgentId: 'acp-a'
      })

    expect(sessionStore.fetchSessions).toHaveBeenCalledTimes(1)
    expect(projectStore.applyBootstrapDefaultProjectPath).toHaveBeenCalledWith('C:/repo')
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
})
