import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SetupOptions = {
  collapsed?: boolean
  currentRoute?: 'newThread' | 'chat'
  selectedAgentId?: string | null
  chatSessionId?: string | null
  newConversationTargetAgentId?: string | null
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
      options.chatSessionId ?? (options.currentRoute === 'chat' ? 'session-1' : null),
    newConversationTargetAgentId: options.newConversationTargetAgentId ?? 'deepchat',
    fetchSessions: vi.fn().mockResolvedValue(undefined),
    startNewConversation: vi.fn().mockResolvedValue(undefined)
  })
  const agentStore = reactive({
    selectedAgentId: options.selectedAgentId ?? null,
    fetchAgents: vi.fn().mockResolvedValue(undefined)
  })
  const sidebarStore = reactive({
    collapsed: options.collapsed ?? false
  })
  const projectStore = {
    loadDefaultProjectPath: vi.fn().mockResolvedValue(undefined),
    fetchProjects: vi.fn().mockResolvedValue(undefined)
  }
  const modelStore = {
    initialize: vi.fn().mockResolvedValue(undefined),
    refreshProviderModels: vi.fn().mockResolvedValue(undefined)
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
    projectStore,
    sessionStore,
    markStartupInteractive
  }
}

describe('ChatTabView collapsed new chat button', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not initialize modelStore on mount', async () => {
    const { modelStore } = await setup({
      collapsed: false,
      currentRoute: 'newThread',
      selectedAgentId: 'deepchat'
    })

    expect(modelStore.initialize).not.toHaveBeenCalled()
  })

  it('hydrates the route from the session store state and defers non-critical fetches', async () => {
    const {
      pageRouter,
      agentStore,
      modelStore,
      projectStore,
      sessionStore,
      markStartupInteractive
    } = await setup({
      collapsed: false,
      currentRoute: 'chat',
      chatSessionId: 'session-42',
      selectedAgentId: 'acp-a'
    })

    expect(sessionStore.fetchSessions).toHaveBeenCalledTimes(1)
    expect(projectStore.loadDefaultProjectPath).toHaveBeenCalledTimes(1)
    expect(pageRouter.initialize).toHaveBeenCalledWith({
      activeSessionId: 'session-42'
    })
    expect(markStartupInteractive).toHaveBeenCalledTimes(1)
    expect(agentStore.fetchAgents).toHaveBeenCalledTimes(1)
    expect(projectStore.fetchProjects).toHaveBeenCalledTimes(1)
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('openai')
  })

  it('hides the collapsed new chat button when the sidebar is expanded', async () => {
    const { wrapper } = await setup({
      collapsed: false,
      currentRoute: 'newThread',
      selectedAgentId: 'deepchat'
    })

    expect(wrapper.find('[data-testid="collapsed-new-chat-button"]').exists()).toBe(false)
  })

  it('shows the collapsed new chat button on the all-agents welcome page', async () => {
    const { wrapper, sessionStore } = await setup({
      collapsed: true,
      currentRoute: 'newThread',
      selectedAgentId: null,
      newConversationTargetAgentId: 'deepchat'
    })

    expect(wrapper.find('[data-testid="agent-welcome-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="collapsed-new-chat-button"]').exists()).toBe(true)

    await wrapper.get('[data-testid="collapsed-new-chat-button"]').trigger('click')

    expect(sessionStore.startNewConversation).toHaveBeenCalledWith({ refresh: true })
  })

  it('shows the collapsed new chat button on the selected-agent new thread page', async () => {
    const { wrapper } = await setup({
      collapsed: true,
      currentRoute: 'newThread',
      selectedAgentId: 'acp-a',
      newConversationTargetAgentId: 'acp-a'
    })

    expect(wrapper.find('[data-testid="new-thread-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="collapsed-new-chat-button"]').exists()).toBe(true)
  })

  it('shows the collapsed new chat button on the chat page', async () => {
    const { wrapper } = await setup({
      collapsed: true,
      currentRoute: 'chat',
      selectedAgentId: 'acp-a',
      chatSessionId: 'session-42',
      newConversationTargetAgentId: 'acp-a'
    })

    expect(wrapper.find('[data-testid="chat-page"]').text()).toContain('session-42')
    expect(wrapper.find('[data-testid="collapsed-new-chat-button"]').exists()).toBe(true)
  })
})
