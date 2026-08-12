import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { EnvironmentSummary } from '../../../src/shared/types/agent-interface'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

type SetupOptions = {
  groupMode?: 'time' | 'project'
  selectedAgentId?: string | null
  enabledAgents?: Array<{ id: string; name: string; type?: 'deepchat' | 'acp'; enabled?: boolean }>
  activeSession?: { id: string; agentId: string } | null
  hasActiveSession?: boolean
  hasLoadedInitialPage?: boolean
  sessions?: Array<{ id: string }>
  hasMore?: boolean
  loading?: boolean
  loadingMore?: boolean
  error?: string | null
  nextPages?: Array<{ items: Array<{ id: string }>; hasMore: boolean }>
  onLoadNextPage?: (sessionStore: {
    loadingMore: boolean
    sessions: Array<{ id: string }>
    hasMore: boolean
  }) => Promise<void>
  pinnedSessions?: Array<{ id: string; title: string; status: string; isPinned?: boolean }>
  groups?: Array<{
    id: string
    label: string
    labelKey?: string
    sessions: Array<{
      id: string
      title: string
      status: string
      isPinned?: boolean
      projectDir?: string
      updatedAt?: number
    }>
  }>
  remoteStatus?: {
    enabled: boolean
    state: 'disabled' | 'stopped' | 'starting' | 'running' | 'backoff' | 'error'
  }
  collapsed?: boolean
  platform?: 'darwin' | 'win32' | 'linux'
  projectEnvironments?: Array<Partial<EnvironmentSummary> & Pick<EnvironmentSummary, 'path'>>
  projects?: Array<{ path: string }>
  archivedProjectEnvironments?: Array<
    Partial<EnvironmentSummary> & Pick<EnvironmentSummary, 'path'>
  >
  removedProjectEnvironments?: Array<Partial<EnvironmentSummary> & Pick<EnvironmentSummary, 'path'>>
  openFolderPickerResult?: string | null
  openFolderPickerError?: Error
  setGroupModeError?: Error
  defaultChatWorkspacePath?: string | null
  projectSnapshotReady?: boolean
  currentRouteName?: string
}

const createEnvironment = (
  environment: Partial<EnvironmentSummary> & Pick<EnvironmentSummary, 'path'>,
  fallbackStatus: EnvironmentSummary['status'] = 'active'
): EnvironmentSummary => {
  const status = environment.status ?? fallbackStatus
  return {
    path: environment.path,
    name: environment.name ?? environment.path.split(/[\\/]/).pop() ?? environment.path,
    sessionCount: environment.sessionCount ?? 1,
    lastUsedAt: environment.lastUsedAt ?? 0,
    isTemp: environment.isTemp ?? false,
    exists: environment.exists ?? true,
    status,
    sortOrder: environment.sortOrder ?? 0,
    archivedAt:
      environment.archivedAt !== undefined
        ? environment.archivedAt
        : status === 'archived'
          ? 100
          : null,
    removedAt:
      environment.removedAt !== undefined
        ? environment.removedAt
        : status === 'removed'
          ? 100
          : null
  }
}

const TEST_TIMEOUT_MS = 20000

const createDomRect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  }) as DOMRect

const dispatchWindowKeydown = (
  key: string,
  modifiers: Partial<
    Pick<KeyboardEventInit, 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat' | 'shiftKey'>
  > = {}
) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...modifiers
    })
  )

const dispatchWindowKeyup = (
  key: string,
  modifiers: Partial<
    Pick<KeyboardEventInit, 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat' | 'shiftKey'>
  > = {}
) =>
  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key,
      bubbles: true,
      cancelable: true,
      ...modifiers
    })
  )

const flushSidebarFillFrame = async () => {
  vi.advanceTimersByTime(16)
  await flushPromises()
}

const setSidebarListSize = (
  wrapper: { get: (selector: string) => { element: Element } },
  sizes: {
    scrollHeight: number
    clientHeight: number
  }
) => {
  const listElement = wrapper.get('.session-list').element
  Object.defineProperty(listElement, 'scrollHeight', {
    configurable: true,
    value: sizes.scrollHeight
  })
  Object.defineProperty(listElement, 'clientHeight', {
    configurable: true,
    value: sizes.clientHeight
  })
}

const mountedWrappers: Array<{ unmount: () => void }> = []

const trackMountedWrapper = <T extends { unmount: () => void }>(wrapper: T): T => {
  let mounted = true
  const originalUnmount = wrapper.unmount.bind(wrapper)

  wrapper.unmount = () => {
    if (!mounted) {
      return
    }

    mounted = false
    const wrapperIndex = mountedWrappers.indexOf(wrapper)
    if (wrapperIndex !== -1) {
      mountedWrappers.splice(wrapperIndex, 1)
    }
    originalUnmount()
  }

  mountedWrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()
  vi.useFakeTimers()

  const operations: string[] = []
  const filteredGroups = reactive(options.groups ?? [])
  const remoteStatus = options.remoteStatus ?? {
    enabled: false,
    state: 'disabled' as const
  }
  const agentStore = reactive({
    selectedAgentId: (options.selectedAgentId ?? 'deepchat') as string | null,
    selectedAgentName: 'DeepChat',
    enabledAgents: (options.enabledAgents ?? [
      { id: 'acp-a', name: 'ACP A', type: 'acp' as const, enabled: true }
    ]) as Array<{ id: string; name: string; type: 'deepchat' | 'acp'; enabled: boolean }>,
    setSelectedAgent: vi.fn((id: string | null) => {
      operations.push(`set:${id ?? 'all'}`)
      agentStore.selectedAgentId = id
    })
  })

  const sessionStore = reactive({
    groupMode: (options.groupMode ?? 'time') as 'time' | 'project',
    activeSessionId: (options.activeSession?.id ?? 'session-1') as string | null,
    activeSession: options.activeSession ?? null,
    hasActiveSession: options.hasActiveSession ?? true,
    hasLoadedInitialPage: options.hasLoadedInitialPage ?? true,
    sessions: (options.sessions ?? []) as Array<{ id: string }>,
    hasMore: options.hasMore ?? false,
    loading: options.loading ?? false,
    loadingMore: options.loadingMore ?? false,
    error: options.error ?? null,
    loadNextPage: vi.fn(async () => {
      if (options.onLoadNextPage) {
        await options.onLoadNextPage(sessionStore)
        return
      }

      const nextPage = (options.nextPages ?? []).shift()
      if (!nextPage) {
        sessionStore.hasMore = false
        return
      }
      sessionStore.sessions = [...sessionStore.sessions, ...nextPage.items]
      sessionStore.hasMore = nextPage.hasMore
    }),
    startNewConversation: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn(async (id: string) => {
      operations.push(`select:${id}`)
      sessionStore.activeSessionId = id
    }),
    closeSession: vi.fn(async () => {
      operations.push('close')
      sessionStore.hasActiveSession = false
      sessionStore.activeSessionId = null
    }),
    renameSession: vi.fn(async (id: string, title: string) => {
      operations.push(`rename:${id}:${title}`)
    }),
    clearSessionMessages: vi.fn(async (id: string) => {
      operations.push(`clear:${id}`)
    }),
    deleteSession: vi.fn(async (id: string) => {
      operations.push(`delete:${id}`)
    }),
    toggleSessionPinned: vi.fn(async (id: string, pinned: boolean) => {
      operations.push(`pin:${id}:${pinned}`)
    }),
    setGroupMode: vi.fn(async (mode: 'time' | 'project') => {
      if (options.setGroupModeError) {
        throw options.setGroupModeError
      }
      sessionStore.groupMode = mode
    }),
    toggleGroupMode: vi.fn(),
    getPinnedSessions: vi.fn(() => options.pinnedSessions ?? []),
    getFilteredGroups: vi.fn(() => filteredGroups)
  })

  const themeStore = reactive({
    isDark: false
  })
  const sidebarStore = reactive({
    collapsed: options.collapsed ?? false,
    toggleSidebar: vi.fn(() => {
      sidebarStore.collapsed = !sidebarStore.collapsed
    }),
    setCollapsed: vi.fn((value: boolean) => {
      sidebarStore.collapsed = value
    })
  })
  const pageRouterStore = reactive({
    goToNewThread: vi.fn()
  })
  const projectStore = reactive({
    projects: options.projects ?? [],
    environments: (options.projectEnvironments ?? []).map((environment) =>
      createEnvironment(environment)
    ),
    archivedEnvironments: (options.archivedProjectEnvironments ?? []).map((environment) =>
      createEnvironment(environment, 'archived')
    ),
    removedEnvironments: (options.removedProjectEnvironments ?? []).map((environment) =>
      createEnvironment(environment, 'removed')
    ),
    error: null as string | null,
    defaultChatWorkspacePath: options.defaultChatWorkspacePath ?? null,
    snapshotReady: options.projectSnapshotReady ?? true,
    fetchEnvironments: vi.fn().mockResolvedValue(undefined),
    reorderEnvironments: vi.fn().mockResolvedValue(undefined),
    archiveEnvironment: vi.fn().mockResolvedValue(undefined),
    openFolderPicker: vi.fn(async () => {
      if (options.openFolderPickerError) {
        throw options.openFolderPickerError
      }
      return options.openFolderPickerResult ?? null
    }),
    selectProject: vi.fn((path: string | null, source?: string) => {
      operations.push(`project:${path ?? 'none'}:${source ?? 'default'}`)
    })
  })
  const spotlightStore = reactive({
    open: false,
    toggleSpotlight: vi.fn(() => {
      spotlightStore.open = !spotlightStore.open
    })
  })
  const router = {
    currentRoute: ref({
      name: options.currentRouteName ?? 'chat',
      query: {},
      params: {}
    }),
    hasRoute: vi.fn((name: string) => ['chat', 'plugins', 'plugins-detail'].includes(String(name))),
    push: vi.fn(async (location: { name?: string }) => {
      router.currentRoute.value = {
        name: location.name ?? router.currentRoute.value.name,
        query: {},
        params: {}
      }
    }),
    replace: vi.fn(async (location: { name?: string }) => {
      router.currentRoute.value = {
        name: location.name ?? router.currentRoute.value.name,
        query: {},
        params: {}
      }
    })
  }
  const settingsClient = {
    openSettings: vi.fn().mockResolvedValue({ windowId: 99 })
  }
  const deviceClient = {
    getDeviceInfo: vi.fn().mockResolvedValue({
      platform: options.platform ?? 'darwin',
      osVersion: '',
      osVersionMetadata: []
    })
  }
  const remoteControlClient = {
    listRemoteChannels: vi.fn(async () => [
      {
        id: 'telegram' as const,
        titleKey: 'settings.remote.telegram.title',
        descriptionKey: 'settings.remote.telegram.description',
        supportsCronDelivery: true
      },
      {
        id: 'feishu' as const,
        titleKey: 'settings.remote.feishu.title',
        descriptionKey: 'settings.remote.feishu.description',
        supportsCronDelivery: true
      },
      {
        id: 'qqbot' as const,
        titleKey: 'settings.remote.qqbot.title',
        descriptionKey: 'settings.remote.qqbot.description',
        supportsCronDelivery: false
      },
      {
        id: 'discord' as const,
        titleKey: 'settings.remote.discord.title',
        descriptionKey: 'settings.remote.discord.description',
        supportsCronDelivery: true
      },
      {
        id: 'weixin-ilink' as const,
        titleKey: 'settings.remote.weixinIlink.title',
        descriptionKey: 'settings.remote.weixinIlink.description',
        supportsCronDelivery: true
      }
    ]),
    getChannelStatus: vi.fn(
      async (channel: 'telegram' | 'feishu' | 'qqbot' | 'discord' | 'weixin-ilink') =>
        channel === 'telegram'
          ? {
              channel: 'telegram' as const,
              enabled: remoteStatus.enabled,
              state: remoteStatus.state,
              pollOffset: 0,
              bindingCount: 0,
              allowedUserCount: 0,
              lastError: null,
              botUser: null
            }
          : {
              channel:
                channel === 'weixin-ilink'
                  ? ('weixin-ilink' as const)
                  : channel === 'discord'
                    ? ('discord' as const)
                    : channel === 'qqbot'
                      ? ('qqbot' as const)
                      : ('feishu' as const),
              enabled: false,
              state: 'disabled' as const,
              ...(channel === 'discord'
                ? {
                    bindingCount: 0,
                    pairedChannelCount: 0,
                    lastError: null,
                    botUser: null
                  }
                : channel === 'qqbot'
                  ? {
                      bindingCount: 0,
                      pairedUserCount: 0,
                      lastError: null,
                      botUser: null
                    }
                  : channel === 'weixin-ilink'
                    ? {
                        bindingCount: 0,
                        accountCount: 0,
                        connectedAccountCount: 0,
                        lastError: null,
                        accounts: []
                      }
                    : {
                        bindingCount: 0,
                        pairedUserCount: 0,
                        lastError: null,
                        botUser: null
                      })
            }
    ),
    getTelegramStatus: vi.fn().mockResolvedValue({
      enabled: remoteStatus.enabled,
      state: remoteStatus.state,
      pollOffset: 0,
      bindingCount: 0,
      allowedUserCount: 0,
      lastError: null,
      botUser: null
    })
  }

  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/sidebar', () => ({
    useSidebarStore: () => sidebarStore
  }))
  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => themeStore
  }))
  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => pageRouterStore
  }))
  vi.doMock('@/stores/ui/project', () => ({
    useProjectStore: () => projectStore
  }))
  vi.doMock('@/stores/ui/spotlight', () => ({
    useSpotlightStore: () => spotlightStore
  }))
  vi.doMock('@api/SettingsClient', () => ({
    createSettingsClient: vi.fn(() => settingsClient)
  }))
  vi.doMock('@api/DeviceClient', () => ({
    createDeviceClient: vi.fn(() => deviceClient)
  }))
  vi.doMock('@api/RemoteControlClient', () => ({
    createRemoteControlClient: vi.fn(() => remoteControlClient)
  }))
  const notifyRenderer = vi.fn()
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('vue-router', () => ({
    useRouter: () => router
  }))

  const passthrough = defineComponent({
    template: '<div><slot /></div>'
  })

  // Mirrors reka-ui renderless roots / as-child triggers, which add no DOM wrapper.
  const slotOnlyStub = defineComponent({
    template: '<slot />'
  })

  const dialogStub = defineComponent({
    props: {
      open: {
        type: Boolean,
        default: false
      }
    },
    template: '<div v-if="open"><slot /></div>'
  })

  const buttonStub = defineComponent({
    props: {
      icon: {
        type: String,
        default: ''
      }
    },
    emits: ['click'],
    template:
      '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><span v-if="icon">{{ icon }}</span><slot /></button>'
  })

  const inputStub = defineComponent({
    props: {
      modelValue: {
        type: String,
        default: ''
      }
    },
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  })

  const contextMenuItemStub = defineComponent({
    emits: ['select'],
    template: '<button type="button" @click="$emit(\'select\')"><slot /></button>'
  })

  const draggableStub = defineComponent({
    name: 'draggable',
    props: {
      modelValue: {
        type: Array,
        default: () => []
      },
      disabled: {
        type: Boolean,
        default: false
      }
    },
    emits: ['start', 'end', 'update:modelValue'],
    template:
      '<div data-testid="project-group-draggable" :data-disabled="String(disabled)"><slot v-for="item in modelValue" name="item" :element="item" /></div>'
  })

  const dropdownMenuItemStub = defineComponent({
    props: {
      disabled: {
        type: Boolean,
        default: false
      }
    },
    emits: ['select'],
    template:
      '<button type="button" :disabled="disabled" @click="$emit(\'select\')"><slot /></button>'
  })

  vi.doMock('vuedraggable', () => ({
    default: draggableStub
  }))
  vi.doMock('@shadcn/components/ui/dropdown-menu', () => ({
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: dropdownMenuItemStub,
    DropdownMenuSeparator: passthrough
  }))

  const WindowSideBar = (await import('@/components/WindowSideBar.vue')).default
  const wrapper = trackMountedWrapper(
    mount(WindowSideBar, {
      global: {
        plugins: [createPinia()],
        stubs: {
          TooltipProvider: passthrough,
          Tooltip: slotOnlyStub,
          TooltipContent: passthrough,
          TooltipTrigger: slotOnlyStub,
          ContextMenu: passthrough,
          ContextMenuTrigger: passthrough,
          ContextMenuContent: passthrough,
          ContextMenuSeparator: passthrough,
          ContextMenuItem: contextMenuItemStub,
          draggable: draggableStub,
          Dialog: dialogStub,
          DialogContent: passthrough,
          DialogDescription: passthrough,
          DialogFooter: passthrough,
          DialogHeader: passthrough,
          DialogTitle: passthrough,
          DcButton: buttonStub,
          Input: inputStub,
          AgentAvatar: true,
          Icon: true,
          ModelIcon: true
        }
      }
    })
  )

  await flushPromises()

  return {
    wrapper,
    operations,
    agentStore,
    sessionStore,
    settingsClient,
    deviceClient,
    remoteControlClient,
    spotlightStore,
    router,
    pageRouterStore,
    sidebarStore,
    projectStore,
    notifyRenderer,
    filteredGroups
  }
}

describe('WindowSideBar agent switch', () => {
  it(
    'closes active session before applying selected agent',
    async () => {
      const { wrapper, operations, agentStore, sessionStore } = await setup()

      await (wrapper.vm as any).handleAgentSelect('acp-a')

      expect(sessionStore.closeSession).toHaveBeenCalledTimes(1)
      expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('acp-a')
      expect(operations).toEqual(['close', 'set:acp-a'])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'expands the collapsed sidebar before applying selected agent',
    async () => {
      const { wrapper, operations, agentStore, sidebarStore } = await setup({
        collapsed: true,
        activeSession: {
          id: 'session-deepchat',
          agentId: 'deepchat'
        },
        enabledAgents: [
          { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
          { id: 'acp-a', name: 'ACP A', type: 'acp', enabled: true }
        ]
      })

      const sidebar = wrapper.get('[data-testid="window-sidebar"]')
      expect(sidebar.classes()).toContain('w-12')

      await wrapper
        .get('[data-testid="sidebar-agent-button"][data-agent-id="acp-a"]')
        .trigger('click')
      await flushPromises()

      expect(sidebarStore.setCollapsed).toHaveBeenCalledWith(false)
      expect(wrapper.get('[data-testid="window-sidebar"]').classes()).toContain('w-[288px]')
      expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('acp-a')
      expect(operations).toEqual(['close', 'set:acp-a'])
    },
    TEST_TIMEOUT_MS
  )

  it('routes to chat before delegating sidebar new chat clicks to the unified session action', async () => {
    const { wrapper, sessionStore, router } = await setup({
      currentRouteName: 'plugins'
    })

    await (wrapper.vm as any).handleNewChat()

    expect(router.push).toHaveBeenCalledWith({ name: 'chat' })
    expect(sessionStore.startNewConversation).toHaveBeenCalledWith({ refresh: true })
  })

  it(
    'prefers the active session agent for selection state and filtering',
    async () => {
      const { wrapper, sessionStore } = await setup({
        selectedAgentId: 'deepchat',
        activeSession: {
          id: 'session-acp',
          agentId: 'acp-a'
        },
        enabledAgents: [
          { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
          { id: 'acp-a', name: 'ACP A', type: 'acp', enabled: true }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('ACP A')
      expect(sessionStore.getPinnedSessions).toHaveBeenCalledWith('acp-a')
      expect(sessionStore.getFilteredGroups).toHaveBeenCalledWith('acp-a')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'renders pinned sessions outside grouped sections',
    async () => {
      const { wrapper } = await setup({
        pinnedSessions: [
          {
            id: 'pinned-1',
            title: 'Pinned Session',
            status: 'none'
          }
        ],
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'normal-1',
                title: 'Normal Session',
                status: 'none',
                projectDir: '/work/today'
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('Pinned Session')
      expect(wrapper.text()).toContain('chat.sidebar.pinned')
      expect(wrapper.text()).toContain('common.time.today')
      expect(wrapper.text()).toContain('Normal Session')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'collapses and expands pinned sessions from the pinned folder header',
    async () => {
      const { wrapper } = await setup({
        pinnedSessions: [
          {
            id: 'pinned-1',
            title: 'Pinned Session',
            status: 'none'
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('chat.sidebar.pinned')
      expect(wrapper.text()).toContain('Pinned Session')

      await wrapper.find('[data-group-id="__pinned__"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.get('[data-group-id="__pinned__"]').attributes('aria-expanded')).toBe('false')

      await wrapper.find('[data-group-id="__pinned__"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.get('[data-group-id="__pinned__"]').attributes('aria-expanded')).toBe('true')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'collapses and expands chat sessions from the chat header',
    async () => {
      const { wrapper, router, sessionStore, projectStore } = await setup({
        currentRouteName: 'plugins',
        defaultChatWorkspacePath: '/Users/test/Documents/DeepChat',
        groupMode: 'project',
        groups: [
          {
            id: '/Users/test/Documents/DeepChat',
            label: 'DeepChat',
            sessions: [
              {
                id: 'chat-1',
                title: 'Chat Session',
                status: 'none'
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('chat.sidebar.chatSection')
      expect(wrapper.find('[data-testid="window-sidebar-chat-icon"]').exists()).toBe(false)
      expect(wrapper.get('[data-session-id="chat-1"]').isVisible()).toBe(true)

      await wrapper.get('[data-testid="window-sidebar-chat-new-button"]').trigger('click')
      await flushPromises()

      expect(projectStore.selectProject).toHaveBeenCalledWith(
        '/Users/test/Documents/DeepChat',
        'manual'
      )
      expect(router.push).toHaveBeenCalledWith({ name: 'chat' })
      expect(sessionStore.startNewConversation).toHaveBeenCalledWith({
        refresh: true,
        projectDir: '/Users/test/Documents/DeepChat'
      })
      expect(wrapper.get('[data-group-id="__chat__"]').attributes('aria-expanded')).toBe('true')

      await wrapper.find('[data-group-id="__chat__"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.get('[data-group-id="__chat__"]').attributes('aria-expanded')).toBe('false')
      expect(
        (
          wrapper.get('[data-group-id="__chat__"]').element.parentElement
            ?.nextElementSibling as HTMLElement
        ).style.display
      ).toBe('none')

      await wrapper.find('[data-group-id="__chat__"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.get('[data-group-id="__chat__"]').attributes('aria-expanded')).toBe('true')
      expect(wrapper.get('[data-session-id="chat-1"]').isVisible()).toBe(true)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'starts new conversations from project folder headers only in project grouping',
    async () => {
      const { wrapper, projectStore, router, sessionStore } = await setup({
        currentRouteName: 'plugins',
        groupMode: 'project',
        projectEnvironments: [{ path: '/work/design' }],
        groups: [
          {
            id: '/work/design',
            label: 'design',
            sessions: [
              {
                id: 'project-design',
                title: 'Design Session',
                status: 'none',
                projectDir: '/work/design'
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      await wrapper.get('[data-testid="window-sidebar-project-new-button"]').trigger('click')
      await flushPromises()

      expect(projectStore.selectProject).toHaveBeenCalledWith('/work/design', 'manual')
      expect(router.push).toHaveBeenCalledWith({ name: 'chat' })
      expect(sessionStore.startNewConversation).toHaveBeenCalledWith({
        refresh: true,
        projectDir: '/work/design'
      })

      const { wrapper: timeWrapper } = await setup({
        groupMode: 'time',
        groups: [
          {
            id: 'today',
            label: 'Today',
            sessions: [
              {
                id: 'time-project',
                title: 'Time Project Session',
                status: 'none',
                projectDir: '/work/design'
              }
            ]
          }
        ]
      })

      await timeWrapper.vm.$nextTick()

      expect(timeWrapper.find('[data-testid="window-sidebar-project-new-button"]').exists()).toBe(
        false
      )
    },
    TEST_TIMEOUT_MS
  )

  it(
    'renders and activates a registered workspace before its first session exists',
    async () => {
      const { wrapper, projectStore, sessionStore } = await setup({
        groupMode: 'project',
        projectEnvironments: [
          {
            path: '/work/new',
            name: 'new',
            sessionCount: 0
          }
        ]
      })

      const group = wrapper.get('[data-group-id="/work/new"]')
      expect(group.attributes('aria-expanded')).toBeUndefined()
      expect(wrapper.text()).toContain('chat.sidebar.emptyWorkspace')
      expect(wrapper.get('[data-testid="window-sidebar-project-new-button"]').classes()).toContain(
        'opacity-100'
      )

      await group.trigger('click')
      await flushPromises()

      expect(projectStore.selectProject).toHaveBeenCalledWith('/work/new', 'manual')
      expect(sessionStore.startNewConversation).toHaveBeenCalledWith({
        refresh: true,
        projectDir: '/work/new'
      })
    },
    TEST_TIMEOUT_MS
  )

  it('converts an empty workspace into one populated path-keyed row', async () => {
    const { wrapper, projectStore, filteredGroups } = await setup({
      groupMode: 'project',
      projectEnvironments: [
        {
          path: '/work/new',
          name: 'new',
          sessionCount: 0
        }
      ]
    })
    const initialGroupElement = wrapper.get('[data-group-id="/work/new"]').element

    filteredGroups.push({
      id: '/work/new',
      label: 'new',
      sessions: [
        {
          id: 'new-session',
          title: 'First Session',
          status: 'none',
          projectDir: '/work/new',
          updatedAt: 100
        }
      ]
    })
    await flushPromises()

    expect(wrapper.findAll('[data-group-id="/work/new"]')).toHaveLength(1)
    expect(wrapper.get('[data-group-id="/work/new"]').element).toBe(initialGroupElement)
    expect(wrapper.find('[data-testid="window-sidebar-empty-workspace-label"]').exists()).toBe(
      false
    )
    expect(wrapper.text()).toContain('First Session')

    projectStore.environments[0].sessionCount = 1
    await flushPromises()

    expect(wrapper.findAll('[data-group-id="/work/new"]')).toHaveLength(1)
  })

  it('disambiguates duplicate workspace labels with minimal parent context', async () => {
    const { wrapper, projectStore } = await setup({
      groupMode: 'project',
      groups: [
        {
          id: '/work/team-a/app',
          label: 'app',
          sessions: [
            {
              id: 'session-a',
              title: 'Session A',
              status: 'none',
              projectDir: '/work/team-a/app',
              updatedAt: 100
            }
          ]
        },
        {
          id: '/work/design',
          label: 'design',
          sessions: [
            {
              id: 'session-d',
              title: 'Session D',
              status: 'none',
              projectDir: '/work/design',
              updatedAt: 90
            }
          ]
        }
      ],
      projectEnvironments: [
        { path: '/work/team-a/app', sessionCount: 1 },
        { path: '/work/archive/app', sessionCount: 0 },
        { path: '/work/design', sessionCount: 1 }
      ]
    })

    const teamGroup = wrapper.get('[data-group-id="/work/team-a/app"]')
    const archiveGroup = wrapper.get('[data-group-id="/work/archive/app"]')
    const designGroup = wrapper.get('[data-group-id="/work/design"]')
    expect(teamGroup.text()).toContain('app · team-a')
    expect(archiveGroup.text()).toContain('app · archive')
    expect(designGroup.text()).not.toContain('design ·')

    // The full path lives in the focus/hover tooltip, not in title or the accessible name.
    expect(teamGroup.attributes('title')).toBeUndefined()
    expect(teamGroup.text()).not.toContain('/work/team-a/app')
    const pathTooltips = wrapper
      .findAll('[data-testid="workspace-path-tooltip"]')
      .map((tooltip) => tooltip.text())
    expect(pathTooltips).toContain('/work/team-a/app')
    expect(pathTooltips).toContain('/work/archive/app')

    projectStore.environments.splice(1, 1)
    await flushPromises()

    expect(wrapper.find('[data-group-id="/work/archive/app"]').exists()).toBe(false)
    expect(wrapper.get('[data-group-id="/work/team-a/app"]').text()).not.toContain('app · team-a')
  })

  it('merges a project snapshot into an earlier session-derived row without duplication', async () => {
    const { wrapper, projectStore } = await setup({
      groupMode: 'project',
      groups: [
        {
          id: '/work/session-first',
          label: 'session-first',
          sessions: [
            {
              id: 'session-first',
              title: 'Session First',
              status: 'none',
              projectDir: '/work/session-first',
              updatedAt: 100
            }
          ]
        }
      ]
    })
    const initialGroupElement = wrapper.get('[data-group-id="/work/session-first"]').element

    projectStore.environments.push(
      createEnvironment({ path: '/work/session-first', sessionCount: 1 })
    )
    await flushPromises()

    expect(wrapper.findAll('[data-group-id="/work/session-first"]')).toHaveLength(1)
    expect(wrapper.get('[data-group-id="/work/session-first"]').element).toBe(initialGroupElement)
    expect(wrapper.text()).toContain('Session First')
  })

  it('uses Project-store readiness and recovers after a later snapshot commit', async () => {
    const { wrapper, projectStore } = await setup({
      groupMode: 'project',
      projectSnapshotReady: false,
      projectEnvironments: [{ path: '/work/recovered', sessionCount: 0 }]
    })

    expect(wrapper.find('[data-group-id="/work/recovered"]').exists()).toBe(false)

    projectStore.snapshotReady = true
    await flushPromises()

    expect(wrapper.find('[data-group-id="/work/recovered"]').exists()).toBe(true)
  })

  it('merges trailing-separator identities while preserving the managed action path', async () => {
    const { wrapper, projectStore, sessionStore } = await setup({
      groupMode: 'project',
      projectEnvironments: [{ path: '/work/design/', sessionCount: 1 }],
      groups: [
        {
          id: '/work/design',
          label: 'design',
          sessions: [
            {
              id: 'design-session',
              title: 'Design Session',
              status: 'none',
              projectDir: '/work/design'
            }
          ]
        }
      ]
    })

    expect(wrapper.findAll('[data-group-id="/work/design"]')).toHaveLength(1)

    await wrapper.get('[data-testid="window-sidebar-project-new-button"]').trigger('click')
    await flushPromises()

    expect(projectStore.selectProject).toHaveBeenCalledWith('/work/design/', 'manual')
    expect(sessionStore.startNewConversation).toHaveBeenCalledWith({
      refresh: true,
      projectDir: '/work/design/'
    })
  })

  it('uses durable counts for empty semantics and hides synthesized rows during search', async () => {
    const { wrapper, sessionStore } = await setup({
      groupMode: 'project',
      projects: [{ path: '/tmp/selected' }],
      projectEnvironments: [
        { path: '/work/empty', sessionCount: 0 },
        { path: '/work/filtered', sessionCount: 3 },
        { path: '/tmp/internal', sessionCount: 0, isTemp: true },
        { path: '/tmp/selected', sessionCount: 0, isTemp: true }
      ]
    })

    expect(wrapper.find('[data-group-id="/work/empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-group-id="/work/filtered"]').exists()).toBe(true)
    expect(wrapper.find('[data-group-id="/tmp/internal"]').exists()).toBe(false)
    expect(wrapper.find('[data-group-id="/tmp/selected"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="window-sidebar-empty-workspace-label"]')).toHaveLength(2)

    await wrapper.get('[data-group-id="/work/filtered"]').trigger('click')
    await flushPromises()
    expect(sessionStore.startNewConversation).not.toHaveBeenCalled()

    ;(wrapper.vm as any).sessionSearchQuery = 'no matching session'
    await flushPromises()

    expect(wrapper.find('[data-group-id="/work/empty"]').exists()).toBe(false)
    expect(wrapper.find('[data-group-id="/work/filtered"]').exists()).toBe(false)
    expect(wrapper.find('[data-group-id="/tmp/selected"]').exists()).toBe(false)
  })

  it(
    'adds a workspace first from date grouping, clears search, and focuses the registered row',
    async () => {
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
      const { wrapper, projectStore, sessionStore } = await setup({
        groupMode: 'time',
        openFolderPickerResult: '/work/new',
        projectEnvironments: [{ path: '/work/existing', sessionCount: 0 }]
      })
      ;(wrapper.vm as any).sessionSearchQuery = 'filtered title'
      projectStore.openFolderPicker.mockImplementation(async () => {
        projectStore.environments.unshift(
          createEnvironment({ path: '/work/new', name: 'new', sessionCount: 0 })
        )
        return '/work/new'
      })

      await wrapper.get('[data-testid="window-sidebar-add-workspace-button"]').trigger('click')
      await flushPromises()

      expect(projectStore.openFolderPicker).toHaveBeenCalledWith({ select: false })
      expect(projectStore.selectProject).not.toHaveBeenCalled()
      expect(sessionStore.setGroupMode).toHaveBeenCalledWith('project')
      expect(sessionStore.groupMode).toBe('project')
      expect((wrapper.vm as any).sessionSearchQuery).toBe('')
      expect(wrapper.find('[data-group-id="/work/new"]').exists()).toBe(true)
      expect(
        wrapper.findAll('[data-group-id]').map((group) => group.attributes('data-group-id'))
      ).toEqual(['/work/new', '/work/existing'])
      expect(focusSpy.mock.instances).toContain(wrapper.get('[data-group-id="/work/new"]').element)
    },
    TEST_TIMEOUT_MS
  )

  it('reveals the built-in Chat action without duplicating it as a workspace', async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    const chatWorkspacePath = '/Users/test/Documents/DeepChat'
    const { wrapper, projectStore, sessionStore } = await setup({
      groupMode: 'time',
      defaultChatWorkspacePath: chatWorkspacePath,
      openFolderPickerResult: chatWorkspacePath,
      projectEnvironments: [{ path: chatWorkspacePath, sessionCount: 0 }]
    })

    await wrapper.get('[data-testid="window-sidebar-add-workspace-button"]').trigger('click')
    await flushPromises()

    expect(sessionStore.setGroupMode).toHaveBeenCalledWith('project')
    expect(projectStore.selectProject).not.toHaveBeenCalled()
    expect(wrapper.find(`[data-group-id="${chatWorkspacePath}"]`).exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-new-chat-button"]').exists()).toBe(true)
    expect(focusSpy.mock.instances).toContain(
      wrapper.get('[data-testid="app-new-chat-button"]').element
    )
  })

  it('keeps cancellation side-effect free and guards concurrent folder pickers', async () => {
    const { wrapper, projectStore, sessionStore } = await setup({ groupMode: 'time' })
    ;(wrapper.vm as any).sessionSearchQuery = 'keep me'
    let finishPicker!: (path: string | null) => void
    projectStore.openFolderPicker.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finishPicker = resolve
        })
    )

    const addWorkspaceButton = wrapper.get('[data-testid="window-sidebar-add-workspace-button"]')
    await addWorkspaceButton.trigger('click')
    await addWorkspaceButton.trigger('click')

    expect(projectStore.openFolderPicker).toHaveBeenCalledTimes(1)
    expect(
      (
        wrapper.get('[data-testid="window-sidebar-add-workspace-button"]')
          .element as HTMLButtonElement
      ).disabled
    ).toBe(true)

    finishPicker(null)
    await flushPromises()

    expect(sessionStore.setGroupMode).not.toHaveBeenCalled()
    expect(sessionStore.groupMode).toBe('time')
    expect((wrapper.vm as any).sessionSearchQuery).toBe('keep me')
  })

  it('reports registration failures without fabricating a workspace row', async () => {
    const { wrapper, notifyRenderer, sessionStore } = await setup({
      groupMode: 'time',
      openFolderPickerError: new Error('picker failed')
    })

    await wrapper.get('[data-testid="window-sidebar-add-workspace-button"]').trigger('click')
    await flushPromises()

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.workspace.registrationFailed',
      title: 'common.error.operationFailed',
      description: 'chat.sidebar.addWorkspaceFailed'
    })
    expect(sessionStore.setGroupMode).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="window-sidebar-empty-workspace-label"]').exists()).toBe(
      false
    )
  })

  it('shows missing active workspaces without a new-conversation action', async () => {
    const { wrapper, sessionStore } = await setup({
      groupMode: 'project',
      projectEnvironments: [
        {
          path: '/work/missing',
          name: 'missing',
          sessionCount: 0,
          exists: false
        }
      ]
    })

    const unavailableIcon = wrapper.get('[data-testid="window-sidebar-workspace-unavailable"]')
    expect(unavailableIcon.element.parentElement?.getAttribute('title')).toBe(
      'chat.input.workspaceUnavailableTooltip'
    )
    expect(unavailableIcon.element.parentElement?.classList.contains('ms-auto')).toBe(true)
    expect(wrapper.find('[data-testid="window-sidebar-project-new-button"]').exists()).toBe(false)

    await wrapper.get('[data-group-id="/work/missing"]').trigger('click')
    await flushPromises()

    expect(sessionStore.startNewConversation).not.toHaveBeenCalled()
  })

  it(
    'toggles pinned state from a session item action',
    async () => {
      const session = {
        id: 'normal-1',
        title: 'Normal Session',
        status: 'none',
        isPinned: false
      }
      const { wrapper, sessionStore } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [session]
          }
        ]
      })

      const item = wrapper.findComponent({ name: 'WindowSideBarSessionItem' })
      item.vm.$emit('toggle-pin', session)
      await flushPromises()

      expect(sessionStore.toggleSessionPinned).toHaveBeenCalledWith('normal-1', true)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'serializes overlapping pin toggles across two sessions',
    async () => {
      const sessionA = { id: 'pin-a', title: 'Pin A', status: 'none', isPinned: false }
      const sessionB = { id: 'pin-b', title: 'Pin B', status: 'none', isPinned: false }
      const { wrapper, sessionStore } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [sessionA, sessionB]
          }
        ]
      })

      let resolveFirstToggle: (() => void) | undefined
      sessionStore.toggleSessionPinned.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstToggle = () => resolve()
          })
      )

      const items = wrapper.findAllComponents({ name: 'WindowSideBarSessionItem' })
      items[0].vm.$emit('toggle-pin', sessionA)
      items[1].vm.$emit('toggle-pin', sessionB)
      await flushPromises()

      // The second toggle must wait until the first flight fully settles.
      expect(sessionStore.toggleSessionPinned).toHaveBeenCalledTimes(1)
      expect(sessionStore.toggleSessionPinned).toHaveBeenCalledWith('pin-a', true)

      resolveFirstToggle?.()
      await flushPromises()

      expect(sessionStore.toggleSessionPinned).toHaveBeenCalledTimes(2)
      expect(sessionStore.toggleSessionPinned).toHaveBeenLastCalledWith('pin-b', true)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'toggles spotlight from the expanded sidebar search command',
    async () => {
      const { wrapper, spotlightStore } = await setup()

      await wrapper.get('[data-testid="app-search-command-button"]').trigger('click')
      await flushPromises()

      expect(spotlightStore.toggleSpotlight).toHaveBeenCalledTimes(1)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'selects visible sidebar sessions with macOS number shortcuts',
    async () => {
      const groupedSessions = Array.from({ length: 9 }, (_, index) => ({
        id: `group-${index + 1}`,
        title: `Group Session ${index + 1}`,
        status: 'none'
      }))
      const { sessionStore } = await setup({
        pinnedSessions: [
          {
            id: 'pinned-1',
            title: 'Pinned Session',
            status: 'none'
          }
        ],
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: groupedSessions
          }
        ]
      })

      dispatchWindowKeydown('2', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).toHaveBeenLastCalledWith('group-1')

      dispatchWindowKeydown('0', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).toHaveBeenLastCalledWith('group-9')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'uses Alt as the sidebar number shortcut modifier on Windows and Linux',
    async () => {
      const { sessionStore } = await setup({
        platform: 'win32',
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none'
              },
              {
                id: 'group-2',
                title: 'Group Session 2',
                status: 'none'
              }
            ]
          }
        ]
      })

      dispatchWindowKeydown('2', { altKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).toHaveBeenLastCalledWith('group-2')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'ignores repeated sidebar number shortcut keydown events',
    async () => {
      const { sessionStore } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none',
                projectDir: '/work/today'
              }
            ]
          }
        ]
      })

      dispatchWindowKeydown('1', { metaKey: true, repeat: true })
      await flushPromises()

      expect(sessionStore.selectSession).not.toHaveBeenCalled()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'excludes collapsed groups from sidebar shortcut mapping',
    async () => {
      const { wrapper, sessionStore } = await setup({
        pinnedSessions: [
          {
            id: 'pinned-1',
            title: 'Pinned Session',
            status: 'none'
          }
        ],
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none',
                projectDir: '/work/today'
              }
            ]
          }
        ]
      })

      await wrapper.find('[data-group-id="common.time.today"]').trigger('click')
      await wrapper.vm.$nextTick()
      sessionStore.selectSession.mockClear()

      dispatchWindowKeydown('2', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).not.toHaveBeenCalled()

      dispatchWindowKeydown('1', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).toHaveBeenLastCalledWith('pinned-1')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'excludes collapsed pinned sessions from sidebar shortcut mapping',
    async () => {
      const { wrapper, sessionStore } = await setup({
        pinnedSessions: [
          {
            id: 'pinned-1',
            title: 'Pinned Session',
            status: 'none'
          }
        ],
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none'
              }
            ]
          }
        ]
      })

      await wrapper.find('[data-group-id="__pinned__"]').trigger('click')
      await wrapper.vm.$nextTick()
      sessionStore.selectSession.mockClear()

      dispatchWindowKeydown('1', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).toHaveBeenLastCalledWith('group-1')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'disables sidebar number shortcuts while the sidebar is collapsed',
    async () => {
      const { wrapper, sessionStore } = await setup({
        collapsed: true,
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none'
              }
            ]
          }
        ]
      })

      dispatchWindowKeydown('1', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).not.toHaveBeenCalled()

      dispatchWindowKeydown('Meta', { metaKey: true })
      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="sidebar-session-shortcut-badge"]').exists()).toBe(false)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'suppresses sidebar number shortcuts for editable targets',
    async () => {
      const { wrapper, sessionStore } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none'
              }
            ]
          }
        ]
      })

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '1',
          metaKey: true,
          bubbles: true,
          cancelable: true
        })
      )
      await flushPromises()
      input.remove()

      expect(sessionStore.selectSession).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="sidebar-session-shortcut-badge"]').exists()).toBe(false)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'suppresses sidebar number shortcuts while keyboard-owning overlays are open',
    async () => {
      const { wrapper, sessionStore, spotlightStore } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none'
              }
            ]
          }
        ]
      })

      spotlightStore.open = true

      dispatchWindowKeydown('1', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).not.toHaveBeenCalled()

      dispatchWindowKeydown('Meta', { metaKey: true })
      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="sidebar-session-shortcut-badge"]').exists()).toBe(false)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'shows shortcut badges only after a modifier long press and hides them on release',
    async () => {
      const { wrapper } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none'
              },
              {
                id: 'group-2',
                title: 'Group Session 2',
                status: 'none'
              }
            ]
          }
        ]
      })

      dispatchWindowKeydown('Meta', { metaKey: true })
      vi.advanceTimersByTime(499)
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="sidebar-session-shortcut-badge"]').exists()).toBe(false)

      vi.advanceTimersByTime(1)
      await wrapper.vm.$nextTick()

      const badges = wrapper.findAll('[data-testid="sidebar-session-shortcut-badge"]')
      expect(badges.map((badge) => badge.text())).toEqual(['⌘1', '⌘2'])
      expect(wrapper.find('[aria-label="thread.actions.delete"]').exists()).toBe(false)

      dispatchWindowKeyup('Meta')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="sidebar-session-shortcut-badge"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="thread.actions.delete"]').exists()).toBe(true)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'does not show shortcut badges after a number shortcut cancels the pending hold',
    async () => {
      const { wrapper, sessionStore } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none'
              }
            ]
          }
        ]
      })

      dispatchWindowKeydown('Meta', { metaKey: true })
      dispatchWindowKeydown('1', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).toHaveBeenLastCalledWith('group-1')

      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="sidebar-session-shortcut-badge"]').exists()).toBe(false)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'removes sidebar shortcut listeners when the component unmounts',
    async () => {
      const { wrapper, sessionStore } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'group-1',
                title: 'Group Session 1',
                status: 'none'
              }
            ]
          }
        ]
      })

      wrapper.unmount()
      dispatchWindowKeydown('1', { metaKey: true })
      await flushPromises()

      expect(sessionStore.selectSession).not.toHaveBeenCalled()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'keeps the expanded sidebar command region interactive outside the drag area',
    async () => {
      const { wrapper } = await setup()

      expect(wrapper.get('[data-testid="window-sidebar-session-column"]').classes()).toContain(
        'window-no-drag-region'
      )
      expect(wrapper.get('[data-testid="app-search-command-button"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="app-plugins-button"]').exists()).toBe(true)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'toggles spotlight from the rail search button',
    async () => {
      const { wrapper, spotlightStore } = await setup()

      const buttons = wrapper.findAll('button')
      const spotlightButton = buttons.find((button) =>
        button.attributes('title')?.includes('chat.spotlight.placeholder')
      )

      expect(spotlightButton).toBeTruthy()

      await spotlightButton!.trigger('click')

      expect(spotlightStore.toggleSpotlight).toHaveBeenCalledTimes(1)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'toggles the shared sidebar store from the collapse button',
    async () => {
      const { wrapper, sidebarStore } = await setup()

      expect(wrapper.get('[data-testid=\"window-sidebar\"]').classes()).toContain('w-[288px]')

      await wrapper.get('[data-testid=\"window-sidebar-toggle\"]').trigger('click')
      await flushPromises()

      expect(sidebarStore.toggleSidebar).toHaveBeenCalledTimes(1)
      expect(wrapper.get('[data-testid=\"window-sidebar\"]').classes()).toContain('w-12')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'collapses and expands time groups from the folder header',
    async () => {
      const { wrapper } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'time-1',
                title: 'Today Session',
                status: 'none',
                projectDir: '/work/today'
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('common.time.today')
      expect(wrapper.text()).toContain('Today Session')

      await wrapper.find('[data-group-id="common.time.today"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.get('[data-group-id="common.time.today"]').attributes('aria-expanded')).toBe(
        'false'
      )

      await wrapper.find('[data-group-id="common.time.today"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.get('[data-group-id="common.time.today"]').attributes('aria-expanded')).toBe(
        'true'
      )
    },
    TEST_TIMEOUT_MS
  )

  it(
    'collapses and expands project groups from the folder header',
    async () => {
      const { wrapper } = await setup({
        groupMode: 'project',
        groups: [
          {
            id: 'project:/tmp/deepchat',
            label: 'DeepChat',
            sessions: [
              {
                id: 'project-1',
                title: 'Project Session',
                status: 'none'
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('DeepChat')
      expect(wrapper.text()).toContain('Project Session')

      await wrapper.find('[data-group-id="project:/tmp/deepchat"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(
        wrapper.get('[data-group-id="project:/tmp/deepchat"]').attributes('aria-expanded')
      ).toBe('false')

      await wrapper.find('[data-group-id="project:/tmp/deepchat"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(
        wrapper.get('[data-group-id="project:/tmp/deepchat"]').attributes('aria-expanded')
      ).toBe('true')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'tracks same-named project groups independently by id',
    async () => {
      const { wrapper } = await setup({
        groupMode: 'project',
        groups: [
          {
            id: '/tmp/workspaces/company-a/deepchat',
            label: 'deepchat',
            sessions: [
              {
                id: 'project-a',
                title: 'Company A Session',
                status: 'none'
              }
            ]
          },
          {
            id: '/tmp/workspaces/company-b/deepchat',
            label: 'deepchat',
            sessions: [
              {
                id: 'project-b',
                title: 'Company B Session',
                status: 'none'
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('Company A Session')
      expect(wrapper.text()).toContain('Company B Session')

      await wrapper.find('[data-group-id="/tmp/workspaces/company-a/deepchat"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(
        wrapper
          .get('[data-group-id="/tmp/workspaces/company-a/deepchat"]')
          .attributes('aria-expanded')
      ).toBe('false')
      expect(
        wrapper
          .get('[data-group-id="/tmp/workspaces/company-b/deepchat"]')
          .attributes('aria-expanded')
      ).toBe('true')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'reorders every registered project group, including groups without visible sessions',
    async () => {
      const alphaGroup = {
        id: '/work/alpha',
        label: 'alpha',
        sessions: [
          {
            id: 'project-alpha',
            title: 'Alpha Session',
            status: 'none'
          }
        ]
      }
      const betaGroup = {
        id: '/work/beta',
        label: 'beta',
        sessions: [
          {
            id: 'project-beta',
            title: 'Beta Session',
            status: 'none'
          }
        ]
      }
      const { wrapper, projectStore } = await setup({
        groupMode: 'project',
        projectEnvironments: [
          { path: '/work/alpha' },
          { path: '/work/hidden' },
          { path: '/work/beta' }
        ],
        groups: [alphaGroup, betaGroup]
      })

      await wrapper.vm.$nextTick()
      const draggable = wrapper.getComponent({ name: 'draggable' })
      expect(draggable.attributes('data-disabled')).toBe('false')
      const renderedGroups = draggable.props('modelValue') as Array<{ id: string }>
      expect(renderedGroups.map((group) => group.id)).toEqual([
        '/work/alpha',
        '/work/hidden',
        '/work/beta'
      ])

      draggable.vm.$emit('update:modelValue', [
        renderedGroups[2],
        renderedGroups[0],
        renderedGroups[1]
      ])
      await flushPromises()

      expect(projectStore.reorderEnvironments).toHaveBeenCalledWith([
        '/work/beta',
        '/work/alpha',
        '/work/hidden'
      ])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'archives the only active workspace after confirmation while move actions stay disabled',
    async () => {
      const { wrapper, projectStore } = await setup({
        groupMode: 'project',
        projectEnvironments: [{ path: '/work/only', name: 'only', sessionCount: 0 }]
      })
      let resolveArchive!: () => void
      projectStore.archiveEnvironment.mockImplementation(async (projectPath: string) => {
        await new Promise<void>((resolve) => {
          resolveArchive = resolve
        })
        const index = projectStore.environments.findIndex(
          (environment) => environment.path === projectPath
        )
        const [environment] = projectStore.environments.splice(index, 1)
        projectStore.archivedEnvironments.push({
          ...environment,
          status: 'archived',
          archivedAt: 100
        })
      })

      expect(wrapper.findAll('[aria-label="chat.sidebar.projectGroupActions"]')).toHaveLength(1)
      const moveActions = wrapper
        .findAll('button')
        .filter((button) => button.text().startsWith('chat.sidebar.moveProjectGroup'))
      expect(moveActions).toHaveLength(4)
      expect(moveActions.every((button) => button.attributes('disabled') !== undefined)).toBe(true)

      await wrapper
        .get('[data-testid="window-sidebar-archive-workspace-menu-item"]')
        .trigger('click')
      await flushPromises()

      expect(
        wrapper.find('[data-testid="window-sidebar-archive-workspace-confirm"]').exists()
      ).toBe(true)

      await wrapper.get('[data-testid="window-sidebar-archive-workspace-confirm"]').trigger('click')

      expect(projectStore.archiveEnvironment).toHaveBeenCalledTimes(1)
      expect(
        wrapper
          .get('[data-testid="window-sidebar-archive-workspace-confirm"]')
          .attributes('disabled')
      ).toBeDefined()
      expect(
        wrapper
          .get('[data-testid="window-sidebar-archive-workspace-cancel"]')
          .attributes('disabled')
      ).toBeDefined()

      await wrapper.get('[data-testid="window-sidebar-archive-workspace-confirm"]').trigger('click')
      expect(projectStore.archiveEnvironment).toHaveBeenCalledTimes(1)

      resolveArchive()
      await flushPromises()

      expect(projectStore.archiveEnvironment).toHaveBeenCalledWith('/work/only')
      expect(wrapper.find('[data-group-id="/work/only"]').exists()).toBe(false)
      expect(
        wrapper.find('[data-testid="window-sidebar-archive-workspace-confirm"]').exists()
      ).toBe(false)
    },
    TEST_TIMEOUT_MS
  )

  it('keeps the workspace and confirmation visible when archive fails', async () => {
    const { wrapper, projectStore, notifyRenderer } = await setup({
      groupMode: 'project',
      projectEnvironments: [{ path: '/work/active', name: 'active', sessionCount: 0 }]
    })
    projectStore.archiveEnvironment.mockRejectedValueOnce(new Error('/private/project.db'))
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await wrapper.get('[data-testid="window-sidebar-archive-workspace-menu-item"]').trigger('click')
    await wrapper.get('[data-testid="window-sidebar-archive-workspace-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-group-id="/work/active"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="window-sidebar-archive-workspace-confirm"]').exists()).toBe(
      true
    )
    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.workspace.archive.failed',
      title: 'settings.environments.errors.archiveTitle'
    })
    expect(wrapper.text()).not.toContain('/private/project.db')
    consoleWarn.mockRestore()
  })

  it(
    'labels the built-in chat workspace separately from reorderable project groups',
    async () => {
      const chatGroup = {
        id: '/Users/test/Documents/DeepChat',
        label: 'DeepChat',
        sessions: [
          {
            id: 'chat-default',
            title: 'Default Chat Session',
            status: 'none'
          }
        ]
      }
      const alphaGroup = {
        id: '/work/alpha',
        label: 'alpha',
        sessions: [
          {
            id: 'project-alpha',
            title: 'Alpha Session',
            status: 'none'
          }
        ]
      }
      const betaGroup = {
        id: '/work/beta',
        label: 'beta',
        sessions: [
          {
            id: 'project-beta',
            title: 'Beta Session',
            status: 'none'
          }
        ]
      }
      const { wrapper, projectStore } = await setup({
        groupMode: 'project',
        pinnedSessions: [
          {
            id: 'pinned-chat',
            title: 'Pinned Session',
            status: 'none',
            isPinned: true
          }
        ],
        defaultChatWorkspacePath: '/Users/test/Documents/DeepChat',
        projectEnvironments: [
          { path: '/Users/test/Documents/DeepChat' },
          { path: '/work/alpha' },
          { path: '/work/beta' }
        ],
        groups: [chatGroup, alphaGroup, betaGroup]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('chat.sidebar.chatSection')
      expect(wrapper.text()).toContain('chat.sidebar.workspace')
      expect(wrapper.text()).toContain('Default Chat Session')
      expect(
        wrapper.findAll('button[data-group-id]').map((button) => button.attributes('data-group-id'))
      ).toEqual(['__pinned__', '__chat__', '/work/alpha', '/work/beta'])
      expect(wrapper.findAll('[aria-label="chat.sidebar.projectGroupActions"]')).toHaveLength(2)

      const draggable = wrapper.getComponent({ name: 'draggable' })
      const renderedGroups = draggable.props('modelValue') as Array<{ id: string }>
      draggable.vm.$emit('update:modelValue', [...renderedGroups].reverse())
      await flushPromises()

      expect(projectStore.reorderEnvironments).toHaveBeenCalledWith([
        '/Users/test/Documents/DeepChat',
        '/work/beta',
        '/work/alpha'
      ])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'labels explicitly no-project sessions as chats outside project group reordering',
    async () => {
      const noProjectGroup = {
        id: '__no_project__',
        label: 'No Project',
        labelKey: 'common.project.none',
        sessions: [
          {
            id: 'chat-no-project',
            title: 'No Project Chat',
            status: 'none'
          }
        ]
      }
      const alphaGroup = {
        id: '/work/alpha',
        label: 'alpha',
        sessions: [
          {
            id: 'project-alpha',
            title: 'Alpha Session',
            status: 'none'
          }
        ]
      }
      const betaGroup = {
        id: '/work/beta',
        label: 'beta',
        sessions: [
          {
            id: 'project-beta',
            title: 'Beta Session',
            status: 'none'
          }
        ]
      }
      const { wrapper, projectStore } = await setup({
        groupMode: 'project',
        projectEnvironments: [{ path: '/work/alpha' }, { path: '/work/beta' }],
        groups: [noProjectGroup, alphaGroup, betaGroup]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('chat.sidebar.chatSection')
      expect(wrapper.text()).toContain('chat.sidebar.workspace')
      expect(wrapper.text()).not.toContain('common.project.none')
      expect(wrapper.find('[data-group-id="__no_project__"]').exists()).toBe(false)
      expect(wrapper.find('[data-group-id="__chat__"]').exists()).toBe(true)
      expect(wrapper.findAll('[aria-label="chat.sidebar.projectGroupActions"]')).toHaveLength(2)

      const draggable = wrapper.getComponent({ name: 'draggable' })
      const renderedGroups = draggable.props('modelValue') as Array<{ id: string }>
      draggable.vm.$emit('update:modelValue', [...renderedGroups].reverse())
      await flushPromises()

      expect(projectStore.reorderEnvironments).toHaveBeenCalledWith(['/work/beta', '/work/alpha'])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'keeps date grouping scoped to workspace sessions',
    async () => {
      const { wrapper } = await setup({
        groupMode: 'time',
        groups: [
          {
            id: 'common.time.lastWeek',
            label: 'common.time.lastWeek',
            labelKey: 'common.time.lastWeek',
            sessions: [
              {
                id: 'chat-1',
                title: 'Chat Session',
                status: 'none',
                projectDir: '',
                updatedAt: 200
              },
              {
                id: 'workspace-1',
                title: 'Workspace Session',
                status: 'none',
                projectDir: '/work/alpha',
                updatedAt: 100
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(
        wrapper.findAll('button[data-group-id]').map((button) => button.attributes('data-group-id'))
      ).toEqual(['__chat__', 'common.time.lastWeek'])
      expect(
        wrapper
          .findAll('[data-testid="sidebar-session-item"]')
          .map((item) => item.attributes('data-session-id'))
      ).toEqual(['chat-1', 'workspace-1'])

      const html = wrapper.html()
      expect(html.indexOf('data-group-id="__chat__"')).toBeLessThan(
        html.indexOf('data-session-id="chat-1"')
      )
      expect(html.indexOf('chat.sidebar.workspace')).toBeLessThan(
        html.indexOf('data-group-id="common.time.lastWeek"')
      )
    },
    TEST_TIMEOUT_MS
  )

  it(
    'sorts time workspace group sessions and chats by recency',
    async () => {
      const { wrapper } = await setup({
        groupMode: 'time',
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              {
                id: 'workspace-alpha',
                title: 'Alpha workspace',
                status: 'none',
                projectDir: '/work/alpha',
                updatedAt: 100
              },
              {
                id: 'chat-older',
                title: 'Older chat',
                status: 'none',
                projectDir: '',
                updatedAt: 200
              },
              {
                id: 'workspace-zulu',
                title: 'Zulu workspace',
                status: 'none',
                projectDir: '/work/alpha',
                updatedAt: 300
              }
            ]
          },
          {
            id: 'common.time.yesterday',
            label: 'common.time.yesterday',
            labelKey: 'common.time.yesterday',
            sessions: [
              {
                id: 'chat-newer',
                title: 'Newer chat',
                status: 'none',
                projectDir: '',
                updatedAt: 400
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(
        wrapper
          .findAll('[data-testid="sidebar-session-item"]')
          .map((item) => item.attributes('data-session-id'))
      ).toEqual(['chat-newer', 'chat-older', 'workspace-zulu', 'workspace-alpha'])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'keeps project sessions sorted by recency and project groups in environment order',
    async () => {
      const { wrapper } = await setup({
        groupMode: 'project',
        projectEnvironments: [{ path: '/work/alpha' }, { path: '/work/beta' }],
        groups: [
          {
            id: '/work/beta',
            label: 'beta',
            sessions: [
              {
                id: 'beta-older',
                title: 'Beta older',
                status: 'none',
                projectDir: '/work/beta',
                updatedAt: 100
              },
              {
                id: 'beta-newer',
                title: 'Beta newer',
                status: 'none',
                projectDir: '/work/beta',
                updatedAt: 300
              }
            ]
          },
          {
            id: '/work/alpha',
            label: 'alpha',
            sessions: [
              {
                id: 'alpha-older',
                title: 'Alpha older',
                status: 'none',
                projectDir: '/work/alpha',
                updatedAt: 200
              },
              {
                id: 'alpha-newer',
                title: 'Alpha newer',
                status: 'none',
                projectDir: '/work/alpha',
                updatedAt: 400
              }
            ]
          }
        ]
      })

      await wrapper.vm.$nextTick()

      expect(
        wrapper.findAll('button[data-group-id]').map((button) => button.attributes('data-group-id'))
      ).toEqual(['/work/alpha', '/work/beta'])
      expect(
        wrapper
          .findAll('[data-testid="sidebar-session-item"]')
          .map((item) => item.attributes('data-session-id'))
      ).toEqual(['alpha-newer', 'alpha-older', 'beta-newer', 'beta-older'])
    },
    TEST_TIMEOUT_MS
  )

  it('does not render the chats group when it has no sessions', async () => {
    const { wrapper } = await setup({
      groupMode: 'project',
      groups: [
        {
          id: '__no_project__',
          label: 'No Project',
          labelKey: 'common.project.none',
          sessions: []
        }
      ]
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-group-id="__no_project__"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('chat.sidebar.chatSection')
  })

  it(
    'disables project group reordering but keeps archive available during search',
    async () => {
      const alphaGroup = {
        id: '/work/alpha',
        label: 'alpha',
        sessions: [
          {
            id: 'project-alpha',
            title: 'Shared Session Alpha',
            status: 'none'
          }
        ]
      }
      const betaGroup = {
        id: '/work/beta',
        label: 'beta',
        sessions: [
          {
            id: 'project-beta',
            title: 'Shared Session Beta',
            status: 'none'
          }
        ]
      }
      const { wrapper, projectStore } = await setup({
        groupMode: 'project',
        projectEnvironments: [{ path: '/work/alpha' }, { path: '/work/beta' }],
        groups: [alphaGroup, betaGroup]
      })

      ;(wrapper.vm as any).sessionSearchQuery = 'shared'
      await flushPromises()

      const draggable = wrapper.getComponent({ name: 'draggable' })
      expect(draggable.attributes('data-disabled')).toBe('true')
      expect(wrapper.findAll('[aria-label="chat.sidebar.projectGroupActions"]')).toHaveLength(2)
      expect(
        wrapper
          .findAll('button')
          .filter((button) => button.text().startsWith('chat.sidebar.moveProjectGroup'))
          .every((button) => button.attributes('disabled') !== undefined)
      ).toBe(true)
      expect(
        wrapper.findAll('[data-testid="window-sidebar-archive-workspace-menu-item"]')
      ).toHaveLength(2)

      draggable.vm.$emit('update:modelValue', [betaGroup, alphaGroup])
      await flushPromises()

      expect(projectStore.reorderEnvironments).not.toHaveBeenCalled()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'keeps archived and removed project groups visible without active affordances',
    async () => {
      const activeGroup = {
        id: '/work/active',
        label: 'active',
        sessions: [
          {
            id: 'project-active',
            title: 'Active Session',
            status: 'none'
          }
        ]
      }
      const archivedGroup = {
        id: '/work/archived',
        label: 'archived',
        sessions: [
          {
            id: 'project-archived',
            title: 'Archived Session',
            status: 'none'
          }
        ]
      }
      const removedGroup = {
        id: '/work/removed',
        label: 'removed',
        sessions: [
          {
            id: 'project-removed',
            title: 'Removed Session',
            status: 'none'
          }
        ]
      }
      const { wrapper, projectStore } = await setup({
        groupMode: 'project',
        projectEnvironments: [{ path: '/work/active' }],
        archivedProjectEnvironments: [{ path: '/work/archived' }],
        removedProjectEnvironments: [{ path: '/work/removed' }],
        groups: [archivedGroup, removedGroup, activeGroup]
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('Active Session')
      expect(wrapper.text()).toContain('Archived Session')
      expect(wrapper.text()).toContain('Removed Session')
      expect(wrapper.findAll('[aria-label="chat.sidebar.projectGroupActions"]')).toHaveLength(1)
      expect(
        wrapper
          .get('[data-group-id="/work/archived"]')
          .element.parentElement?.querySelector('[data-testid="window-sidebar-project-new-button"]')
      ).toBeNull()
      expect(
        wrapper
          .get('[data-group-id="/work/removed"]')
          .element.parentElement?.querySelector('[data-testid="window-sidebar-project-new-button"]')
      ).toBeNull()

      wrapper
        .getComponent({ name: 'draggable' })
        .vm.$emit('update:modelValue', [removedGroup, archivedGroup, activeGroup])
      await flushPromises()

      expect(projectStore.reorderEnvironments).not.toHaveBeenCalled()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'opens the delete dialog and dispatches delete actions',
    async () => {
      const session = {
        id: 'normal-1',
        title: 'Normal Session',
        status: 'none',
        isPinned: false
      }
      const { wrapper, sessionStore } = await setup({
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [session]
          }
        ]
      })

      const item = wrapper.findComponent({ name: 'WindowSideBarSessionItem' })

      item.vm.$emit('delete', session)
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('dialog.delete.title')

      await (wrapper.vm as any).handleDeleteConfirm()
      expect(sessionStore.deleteSession).toHaveBeenCalledWith('normal-1')
    },
    TEST_TIMEOUT_MS
  )

  it('shows the remote control button only when remote control is enabled', async () => {
    const enabledSetup = await setup({
      remoteStatus: {
        enabled: true,
        state: 'starting'
      }
    })

    const button = enabledSetup.wrapper.find('[data-testid=\"remote-control-button\"]')

    expect(button.exists()).toBe(true)
    expect(button.classes().join(' ')).toContain('border-emerald-500/40')
    expect(button.attributes('title')).toContain('chat.sidebar.remoteControlStatus.starting')
    expect(enabledSetup.wrapper.html()).toContain('animate-pulse')

    enabledSetup.wrapper.unmount()

    const disabledSetup = await setup({
      remoteStatus: {
        enabled: false,
        state: 'disabled'
      }
    })

    expect(disabledSetup.wrapper.find('[data-testid=\"remote-control-button\"]').exists()).toBe(
      false
    )

    disabledSetup.wrapper.unmount()
  })

  it('keeps the previous remote display when a refresh fails', async () => {
    const { wrapper, remoteControlClient, router } = await setup({
      remoteStatus: {
        enabled: true,
        state: 'running'
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    remoteControlClient.listRemoteChannels.mockResolvedValueOnce([
      {
        id: 'qqbot',
        titleKey: 'settings.remote.qqbot.title',
        descriptionKey: 'settings.remote.qqbot.description',
        supportsCronDelivery: false
      }
    ])
    remoteControlClient.getChannelStatus.mockRejectedValueOnce(new Error('IPC unavailable'))

    // Advance to the next active poll tick so the failing refresh runs through the
    // real scheduling path instead of a direct internal call.
    vi.advanceTimersByTime(2_000)
    await flushPromises()

    await wrapper.find('[data-testid="remote-control-button"]').trigger('click')

    expect(router.push).toHaveBeenLastCalledWith({
      name: 'plugins-detail',
      params: { pluginId: 'remote:telegram' }
    })
    expect(warn).toHaveBeenCalledWith(
      '[WindowSideBar] Failed to refresh remote control status:',
      expect.any(Error)
    )

    warn.mockRestore()
    wrapper.unmount()
  })

  it('drops a stale overlapping refresh so it cannot overwrite newer status', async () => {
    const { wrapper, remoteControlClient } = await setup({
      remoteStatus: {
        enabled: true,
        state: 'running'
      }
    })

    let resolveStaleTelegramStatus: (() => void) | undefined
    remoteControlClient.getChannelStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleTelegramStatus = () =>
            resolve({
              channel: 'telegram' as const,
              enabled: true,
              state: 'stopped' as const,
              pollOffset: 0,
              bindingCount: 0,
              allowedUserCount: 0,
              lastError: null,
              botUser: null
            })
        })
    )

    // Poll tick starts a refresh whose telegram status request hangs.
    vi.advanceTimersByTime(2_000)
    await flushPromises()

    const setDocumentVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    try {
      // Hiding and showing the document starts a second refresh while the first is pending.
      setDocumentVisibility('hidden')
      await flushPromises()
      setDocumentVisibility('visible')
      await flushPromises()

      expect(wrapper.find('[data-testid="remote-control-button"]').attributes('title')).toContain(
        'chat.sidebar.remoteControlStatus.running'
      )

      // The first refresh resolves last with stale data; its snapshot must be discarded.
      resolveStaleTelegramStatus?.()
      await flushPromises()

      expect(wrapper.find('[data-testid="remote-control-button"]').attributes('title')).toContain(
        'chat.sidebar.remoteControlStatus.running'
      )
    } finally {
      Reflect.deleteProperty(document, 'visibilityState')
    }

    wrapper.unmount()
  })

  it('routes to the first enabled remote plugin when remote button is clicked', async () => {
    const { wrapper, settingsClient, router } = await setup({
      remoteStatus: {
        enabled: true,
        state: 'running'
      }
    })

    await wrapper.find('[data-testid=\"remote-control-button\"]').trigger('click')
    await flushPromises()
    expect(router.push).toHaveBeenCalledWith({
      name: 'plugins-detail',
      params: { pluginId: 'remote:telegram' }
    })
    expect(settingsClient.openSettings).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})

describe('WindowSideBar session row transitions', () => {
  it(
    'renders rows loaded during pagination',
    async () => {
      let resolvePage: (() => void) | undefined
      const pageLoaded = new Promise<void>((resolve) => {
        resolvePage = resolve
      })
      const groups = reactive([
        {
          id: 'common.time.today',
          label: 'common.time.today',
          labelKey: 'common.time.today',
          sessions: [{ id: 'session-1', title: 'Existing', status: 'none' }]
        }
      ])
      const { wrapper } = await setup({
        sessions: [{ id: 'session-1' }],
        hasMore: true,
        groups,
        onLoadNextPage: async (sessionStore) => {
          sessionStore.loadingMore = true
          await pageLoaded
          sessionStore.sessions = [...sessionStore.sessions, { id: 'session-2' }]
          groups[0].sessions.push({ id: 'session-2', title: 'Loaded', status: 'none' })
          sessionStore.loadingMore = false
          sessionStore.hasMore = false
        }
      })
      setSidebarListSize(wrapper, { scrollHeight: 0, clientHeight: 0 })

      await flushSidebarFillFrame()
      await wrapper.vm.$nextTick()

      resolvePage?.()
      await flushPromises()
      await nextTick()

      expect(wrapper.text()).toContain('Loaded')

      wrapper.unmount()
    },
    TEST_TIMEOUT_MS
  )
})

describe('WindowSideBar viewport auto-fill', () => {
  it(
    'keeps loading pages until the session list viewport is filled',
    async () => {
      const { wrapper, sessionStore } = await setup({
        sessions: [{ id: 'session-1' }],
        hasMore: true,
        nextPages: [
          { items: [{ id: 'session-2' }], hasMore: true },
          { items: [{ id: 'session-3' }], hasMore: false }
        ]
      })

      await flushSidebarFillFrame()

      // jsdom 下 scrollHeight/clientHeight 均为 0（未填满视口），
      // 自动填充应持续翻页直到 hasMore 收敛为 false。
      expect(sessionStore.loadNextPage).toHaveBeenCalledTimes(2)
      expect(sessionStore.hasMore).toBe(false)
      expect(sessionStore.sessions.map((session) => session.id)).toEqual([
        'session-1',
        'session-2',
        'session-3'
      ])

      wrapper.unmount()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'does not auto-load additional pages when there is nothing more to fetch',
    async () => {
      const { wrapper, sessionStore } = await setup({
        sessions: [{ id: 'session-1' }],
        hasMore: false
      })

      await flushSidebarFillFrame()

      expect(sessionStore.loadNextPage).not.toHaveBeenCalled()

      wrapper.unmount()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'does not auto-load after a group collapse makes the visible list too short',
    async () => {
      const { wrapper, sessionStore } = await setup({
        hasMore: true,
        sessions: [{ id: 'session-1' }, { id: 'session-2' }],
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [
              { id: 'session-1', title: 'Alpha', status: 'none', projectDir: '/work/today' },
              { id: 'session-2', title: 'Bravo', status: 'none', projectDir: '/work/today' }
            ]
          }
        ],
        nextPages: [{ items: [{ id: 'session-3' }], hasMore: false }]
      })
      setSidebarListSize(wrapper, { scrollHeight: 240, clientHeight: 120 })
      await flushSidebarFillFrame()
      expect(sessionStore.loadNextPage).not.toHaveBeenCalled()

      await wrapper.get('[data-group-id="common.time.today"]').trigger('click')
      setSidebarListSize(wrapper, { scrollHeight: 80, clientHeight: 120 })
      await flushSidebarFillFrame()

      expect(sessionStore.loadNextPage).not.toHaveBeenCalled()
      expect(sessionStore.sessions.map((session) => session.id)).toEqual(['session-1', 'session-2'])

      wrapper.unmount()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'does not auto-load after the pinned section is collapsed',
    async () => {
      const { wrapper, sessionStore } = await setup({
        hasMore: true,
        sessions: [{ id: 'session-1' }],
        pinnedSessions: [{ id: 'session-1', title: 'Pinned', status: 'none', isPinned: true }],
        nextPages: [{ items: [{ id: 'session-2' }], hasMore: false }]
      })
      setSidebarListSize(wrapper, { scrollHeight: 240, clientHeight: 120 })
      await flushSidebarFillFrame()
      expect(sessionStore.loadNextPage).not.toHaveBeenCalled()

      await wrapper.get('[data-group-id="__pinned__"]').trigger('click')
      setSidebarListSize(wrapper, { scrollHeight: 80, clientHeight: 120 })
      await flushSidebarFillFrame()

      expect(sessionStore.loadNextPage).not.toHaveBeenCalled()

      wrapper.unmount()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'cancels a mount-time auto-fill frame when a search starts before it runs',
    async () => {
      const { wrapper, sessionStore } = await setup({
        hasMore: true,
        sessions: [{ id: 'session-1' }],
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [{ id: 'session-1', title: 'Alpha', status: 'none' }]
          }
        ],
        nextPages: [{ items: [{ id: 'session-2' }], hasMore: false }]
      })
      setSidebarListSize(wrapper, { scrollHeight: 80, clientHeight: 120 })

      await wrapper.get('[data-testid="sidebar-session-search-input"]').setValue('alpha')
      await flushSidebarFillFrame()

      expect(sessionStore.loadNextPage).not.toHaveBeenCalled()
      expect(wrapper.get('[data-testid="sidebar-session-search-loaded-range"]').exists()).toBe(true)

      wrapper.unmount()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'stops an in-flight auto-fill loop when a search starts',
    async () => {
      const { wrapper, sessionStore } = await setup({
        hasMore: true,
        sessions: [{ id: 'session-1' }],
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [{ id: 'session-1', title: 'Alpha', status: 'none' }]
          }
        ]
      })
      setSidebarListSize(wrapper, { scrollHeight: 80, clientHeight: 120 })

      let resolveFirstPage: (() => void) | undefined
      sessionStore.loadNextPage.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstPage = () => {
              sessionStore.sessions = [...sessionStore.sessions, { id: 'session-2' }]
              resolve()
            }
          })
      )

      await flushSidebarFillFrame()
      expect(sessionStore.loadNextPage).toHaveBeenCalledTimes(1)

      await wrapper.get('[data-testid="sidebar-session-search-input"]').setValue('alpha')
      resolveFirstPage?.()
      await flushPromises()

      expect(sessionStore.loadNextPage).toHaveBeenCalledTimes(1)
      expect(wrapper.get('[data-testid="sidebar-session-search-loaded-range"]').exists()).toBe(true)

      wrapper.unmount()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'filters the loaded session range without auto-loading the remaining pages',
    async () => {
      const { wrapper, sessionStore } = await setup({
        hasMore: true,
        sessions: [{ id: 'session-1' }],
        groups: [
          {
            id: 'common.time.today',
            label: 'common.time.today',
            labelKey: 'common.time.today',
            sessions: [{ id: 'session-1', title: 'Alpha', status: 'none' }]
          }
        ],
        nextPages: [{ items: [{ id: 'session-2' }], hasMore: false }]
      })
      setSidebarListSize(wrapper, { scrollHeight: 80, clientHeight: 120 })

      const input = wrapper.get('[data-testid="sidebar-session-search-input"]')
      await input.setValue('alpha')
      await flushSidebarFillFrame()

      expect(sessionStore.loadNextPage).not.toHaveBeenCalled()
      expect(wrapper.get('[data-testid="sidebar-session-search-loaded-range"]').exists()).toBe(true)

      await input.trigger('keydown', { key: 'Escape' })
      expect((input.element as HTMLInputElement).value).toBe('')

      wrapper.unmount()
    },
    TEST_TIMEOUT_MS
  )

  it('does not treat a whitespace-only query as an active search', async () => {
    const { wrapper } = await setup({
      hasMore: true,
      sessions: [{ id: 'session-1' }],
      groups: [
        {
          id: 'common.time.today',
          label: 'common.time.today',
          labelKey: 'common.time.today',
          sessions: [{ id: 'session-1', title: 'Alpha', status: 'none' }]
        }
      ]
    })

    await wrapper.get('[data-testid="sidebar-session-search-input"]').setValue('   ')

    expect(wrapper.find('[data-testid="sidebar-session-search-loaded-range"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('loads the next page after a searched list reaches the bottom', async () => {
    const { wrapper, sessionStore } = await setup({
      hasMore: true,
      sessions: [{ id: 'session-1' }],
      groups: [
        {
          id: 'common.time.today',
          label: 'common.time.today',
          labelKey: 'common.time.today',
          sessions: [{ id: 'session-1', title: 'Alpha', status: 'none' }]
        }
      ],
      nextPages: [{ items: [{ id: 'session-2' }], hasMore: false }]
    })
    const list = wrapper.get('.session-list')
    setSidebarListSize(wrapper, { scrollHeight: 120, clientHeight: 120 })
    await wrapper.get('[data-testid="sidebar-session-search-input"]').setValue('alpha')
    await list.trigger('scroll')
    await flushSidebarFillFrame()

    expect(sessionStore.loadNextPage).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('keeps loaded results and offers retry after pagination fails', async () => {
    const { wrapper, sessionStore } = await setup({
      hasMore: true,
      error: 'Failed to load more sessions',
      sessions: [{ id: 'session-1' }],
      groups: [
        {
          id: 'common.time.today',
          label: 'common.time.today',
          labelKey: 'common.time.today',
          sessions: [{ id: 'session-1', title: 'Alpha', status: 'none' }]
        }
      ]
    })

    expect(wrapper.get('[data-testid="sidebar-session-pagination-error"]').text()).toContain(
      'Failed to load more sessions'
    )
    await wrapper.get('[data-testid="sidebar-session-pagination-retry"]').trigger('click')
    expect(sessionStore.loadNextPage).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Alpha')

    wrapper.unmount()
  })
})
