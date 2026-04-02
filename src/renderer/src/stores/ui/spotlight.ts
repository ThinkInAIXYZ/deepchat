import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import { usePresenter } from '@/composables/usePresenter'
import { useProviderStore } from '@/stores/providerStore'
import { useAgentStore } from './agent'
import { usePageRouterStore } from './pageRouter'
import { useSessionStore } from './session'
import { SETTINGS_NAVIGATION_ITEMS, type SettingsNavigationItem } from '@shared/settingsNavigation'
import type { HistorySearchHit } from '@shared/presenter'

type SpotlightItemKind = 'session' | 'message' | 'agent' | 'setting' | 'action'
type SpotlightActionId =
  | 'new-chat'
  | 'open-settings'
  | 'open-providers'
  | 'open-agents'
  | 'open-mcp'
  | 'open-shortcuts'
  | 'open-remote'

export interface SpotlightItem {
  id: string
  kind: SpotlightItemKind
  icon: string
  title?: string
  titleKey?: string
  subtitle?: string
  snippet?: string
  score: number
  updatedAt?: number
  sessionId?: string
  messageId?: string
  routeName?: SettingsNavigationItem['routeName']
  routeParams?: Record<string, string>
  actionId?: SpotlightActionId
  agentId?: string | null
  keywords?: string[]
}

// Keep the list compact enough to fit the overlay without scrolling in most window sizes.
const MAX_RESULTS = 12
// Debounce just enough to avoid spamming IPC while keeping the palette responsive.
const SEARCH_DEBOUNCE_DELAY = 80
const normalizeQuery = (value: string): string => value.trim().toLowerCase()

const scoreTextMatch = (query: string, ...parts: Array<string | null | undefined>): number => {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return 0
  }

  const values = parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.toLowerCase())

  for (const value of values) {
    if (value.startsWith(normalizedQuery)) {
      return 320
    }
  }

  for (const value of values) {
    if (value.includes(normalizedQuery)) {
      return 220
    }
  }

  return 0
}

const actionItems: Array<{
  id: SpotlightActionId
  titleKey: string
  routeName?: SettingsNavigationItem['routeName']
  icon: string
  keywords: string[]
}> = [
  {
    id: 'new-chat',
    titleKey: 'common.newChat',
    icon: 'lucide:square-pen',
    keywords: ['new', 'chat', 'conversation', '新建', '会话']
  },
  {
    id: 'open-settings',
    titleKey: 'routes.settings',
    icon: 'lucide:settings-2',
    keywords: ['settings', 'preferences', '设置']
  },
  {
    id: 'open-providers',
    titleKey: 'routes.settings-provider',
    routeName: 'settings-provider',
    icon: 'lucide:cloud-cog',
    keywords: ['providers', 'models', 'llm', '服务商', '模型']
  },
  {
    id: 'open-agents',
    titleKey: 'routes.settings-deepchat-agents',
    routeName: 'settings-deepchat-agents',
    icon: 'lucide:bot',
    keywords: ['agents', 'deepchat', '智能体', 'agent']
  },
  {
    id: 'open-mcp',
    titleKey: 'routes.settings-mcp',
    routeName: 'settings-mcp',
    icon: 'lucide:server',
    keywords: ['mcp', 'tools', 'server', '工具']
  },
  {
    id: 'open-shortcuts',
    titleKey: 'routes.settings-shortcut',
    routeName: 'settings-shortcut',
    icon: 'lucide:keyboard',
    keywords: ['shortcut', 'hotkey', 'keybinding', '快捷键']
  },
  {
    id: 'open-remote',
    titleKey: 'routes.settings-remote',
    routeName: 'settings-remote',
    icon: 'lucide:smartphone',
    keywords: ['remote', 'telegram', 'feishu', '远程']
  }
]

export const useSpotlightStore = defineStore('spotlight', () => {
  const newAgentPresenter = usePresenter('newAgentPresenter')
  const windowPresenter = usePresenter('windowPresenter')
  const providerStore = useProviderStore()
  const sessionStore = useSessionStore()
  const agentStore = useAgentStore()
  const pageRouterStore = usePageRouterStore()

  const open = ref(false)
  const activationKey = ref(0)
  const query = ref('')
  const results = ref<SpotlightItem[]>([])
  const activeIndex = ref(0)
  const loading = ref(false)
  const requestSeq = ref(0)
  const pendingMessageJump = ref<{ sessionId: string; messageId: string } | null>(null)

  const hasResults = computed(() => results.value.length > 0)

  const buildRecentSessionItems = (): SpotlightItem[] =>
    [...sessionStore.sessions]
      .filter((session) => session.sessionKind !== 'subagent')
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 5)
      .map((session) => ({
        id: `session:${session.id}`,
        kind: 'session' as const,
        icon: 'lucide:message-square',
        title: session.title,
        subtitle: session.projectDir || '',
        sessionId: session.id,
        score: 0,
        updatedAt: session.updatedAt
      }))

  const buildAgentItems = (): SpotlightItem[] =>
    agentStore.enabledAgents.map((agent) => ({
      id: `agent:${agent.id}`,
      kind: 'agent' as const,
      icon: 'lucide:bot',
      title: agent.name,
      agentId: agent.id,
      score: 0,
      keywords: [agent.type, agent.agentType, agent.description].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    }))

  const buildActionItems = (): SpotlightItem[] =>
    actionItems.map((action) => ({
      id: `action:${action.id}`,
      kind: 'action' as const,
      icon: action.icon,
      titleKey: action.titleKey,
      actionId: action.id,
      routeName: action.routeName,
      score: 0,
      keywords: action.keywords
    }))

  const buildDefaultResults = (): SpotlightItem[] =>
    [...buildRecentSessionItems(), ...buildAgentItems().slice(0, 3), ...buildActionItems()]
      .slice(0, MAX_RESULTS)
      .map((item, index) => ({
        ...item,
        score: MAX_RESULTS - index
      }))

  const toHistoryItem = (hit: HistorySearchHit, normalizedQuery: string): SpotlightItem => {
    if (hit.kind === 'session') {
      return {
        id: `session:${hit.sessionId}`,
        kind: 'session',
        icon: 'lucide:message-square',
        title: hit.title,
        subtitle: hit.projectDir || '',
        sessionId: hit.sessionId,
        updatedAt: hit.updatedAt,
        score: scoreTextMatch(normalizedQuery, hit.title) + 40
      }
    }

    const titleScore = scoreTextMatch(normalizedQuery, hit.title)
    const snippetScore = scoreTextMatch(normalizedQuery, hit.snippet)

    return {
      id: `message:${hit.messageId}`,
      kind: 'message',
      icon: 'lucide:align-left',
      title: hit.title,
      snippet: hit.snippet,
      sessionId: hit.sessionId,
      messageId: hit.messageId,
      updatedAt: hit.updatedAt,
      score: Math.max(titleScore, snippetScore) + 10
    }
  }

  const buildProviderMatches = (normalizedQuery: string): SpotlightItem[] =>
    providerStore.sortedProviders
      .filter((provider) => provider.id !== 'acp')
      .map((provider) => ({
        id: `setting:provider:${provider.id}`,
        kind: 'setting' as const,
        icon: 'lucide:cloud-cog',
        title: provider.name,
        subtitle: provider.apiType,
        routeName: 'settings-provider' as const,
        routeParams: {
          providerId: provider.id
        },
        keywords: [provider.id, provider.apiType, provider.baseUrl].filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        ),
        score: scoreTextMatch(
          normalizedQuery,
          provider.name,
          provider.id,
          provider.apiType,
          provider.baseUrl
        )
      }))
      .filter((item) => item.score > 0)

  const buildSettingMatches = (normalizedQuery: string): SpotlightItem[] =>
    SETTINGS_NAVIGATION_ITEMS.filter((item) => item.routeName !== 'settings-provider')
      .map((item) => ({
        id: `setting:${item.routeName}`,
        kind: 'setting' as const,
        icon: item.icon,
        titleKey: item.titleKey,
        routeName: item.routeName,
        keywords: item.keywords,
        score: scoreTextMatch(normalizedQuery, item.routeName, item.path, ...item.keywords)
      }))
      .filter((item) => item.score > 0)

  const buildAgentMatches = (normalizedQuery: string): SpotlightItem[] =>
    buildAgentItems()
      .map((item) => ({
        ...item,
        score: scoreTextMatch(normalizedQuery, item.title, ...(item.keywords ?? []))
      }))
      .filter((item) => item.score > 0)

  const buildActionMatches = (normalizedQuery: string): SpotlightItem[] =>
    buildActionItems()
      .map((item) => ({
        ...item,
        score: scoreTextMatch(normalizedQuery, item.titleKey, ...(item.keywords ?? []))
      }))
      .filter((item) => item.score > 0)

  const sortResults = (items: SpotlightItem[]) =>
    [...items]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      })
      .slice(0, MAX_RESULTS)

  const resetActiveIndex = () => {
    activeIndex.value = results.value.length > 0 ? 0 : -1
  }

  const runSearch = useDebounceFn(async (rawQuery: string, seq: number) => {
    const normalizedQuery = normalizeQuery(rawQuery)
    if (!normalizedQuery) {
      loading.value = false
      results.value = buildDefaultResults()
      resetActiveIndex()
      return
    }

    const historyHits = await newAgentPresenter.searchHistory(normalizedQuery, {
      limit: MAX_RESULTS
    })

    if (seq !== requestSeq.value) {
      return
    }

    results.value = sortResults([
      ...historyHits
        .filter((hit) => hit.kind === 'session')
        .map((hit) => toHistoryItem(hit, normalizedQuery)),
      ...buildAgentMatches(normalizedQuery),
      ...buildProviderMatches(normalizedQuery),
      ...buildSettingMatches(normalizedQuery),
      ...buildActionMatches(normalizedQuery)
    ])
    loading.value = false
    resetActiveIndex()
  }, SEARCH_DEBOUNCE_DELAY)

  const navigateToSettings = async (
    routeName?: SettingsNavigationItem['routeName'],
    routeParams?: Record<string, string>
  ) => {
    if (!routeName) {
      return
    }

    await windowPresenter.createSettingsWindow(
      routeParams ? { routeName, params: routeParams } : { routeName }
    )
  }

  const setQuery = (value: string) => {
    query.value = value

    if (!open.value) {
      return
    }

    refreshOpenResults(value)
  }

  const refreshOpenResults = (currentQuery: string) => {
    const normalizedQuery = normalizeQuery(currentQuery)
    if (!normalizedQuery) {
      loading.value = false
      requestSeq.value += 1
      results.value = buildDefaultResults()
      resetActiveIndex()
      return
    }

    loading.value = true
    const seq = ++requestSeq.value
    void runSearch(currentQuery, seq)
  }

  const setOpen = (value: boolean) => {
    open.value = value
    if (value) {
      activationKey.value += 1
      setQuery(query.value)
      return
    }

    requestSeq.value += 1
    query.value = ''
    loading.value = false
    results.value = []
    activeIndex.value = 0
  }

  const openSpotlight = () => {
    setOpen(true)
  }

  const closeSpotlight = () => {
    setOpen(false)
  }

  const toggleSpotlight = () => {
    if (open.value) {
      closeSpotlight()
      return
    }
    openSpotlight()
  }

  const setActiveItem = (index: number) => {
    if (results.value.length === 0) {
      activeIndex.value = -1
      return
    }

    activeIndex.value = Math.min(Math.max(index, 0), results.value.length - 1)
  }

  const moveActiveItem = (delta: number) => {
    if (results.value.length === 0) {
      activeIndex.value = -1
      return
    }

    const currentIndex = activeIndex.value < 0 ? 0 : activeIndex.value
    const nextIndex =
      (((currentIndex + delta) % results.value.length) + results.value.length) %
      results.value.length
    activeIndex.value = nextIndex
  }

  const executeItem = async (item: SpotlightItem | undefined) => {
    if (!item) {
      return
    }

    closeSpotlight()

    if (item.kind === 'session' && item.sessionId) {
      await sessionStore.selectSession(item.sessionId)
      return
    }

    if (item.kind === 'message' && item.sessionId && item.messageId) {
      pendingMessageJump.value = {
        sessionId: item.sessionId,
        messageId: item.messageId
      }
      await sessionStore.selectSession(item.sessionId)
      return
    }

    if (item.kind === 'agent') {
      if (sessionStore.hasActiveSession) {
        await sessionStore.closeSession()
      } else {
        pageRouterStore.goToNewThread()
      }
      agentStore.setSelectedAgent(item.agentId ?? null)
      return
    }

    if (item.kind === 'setting') {
      await navigateToSettings(item.routeName, item.routeParams)
      return
    }

    switch (item.actionId) {
      case 'new-chat':
        if (sessionStore.hasActiveSession) {
          await sessionStore.closeSession()
        } else {
          pageRouterStore.goToNewThread({ refresh: true })
        }
        return
      case 'open-settings':
        await windowPresenter.openOrFocusSettingsWindow()
        return
      case 'open-providers':
      case 'open-agents':
      case 'open-mcp':
      case 'open-shortcuts':
      case 'open-remote':
        await navigateToSettings(item.routeName)
        return
      default:
        return
    }
  }

  const executeActiveItem = async () => {
    if (activeIndex.value < 0) {
      return
    }
    await executeItem(results.value[activeIndex.value])
  }

  const clearPendingMessageJump = () => {
    pendingMessageJump.value = null
  }

  watch(
    () =>
      [
        sessionStore.sessions.map(
          (session) => `${session.id}:${session.updatedAt}:${session.title}`
        ),
        providerStore.sortedProviders.map(
          (provider) =>
            `${provider.id}:${provider.name}:${provider.apiType}:${provider.baseUrl}:${provider.enable}`
        ),
        agentStore.enabledAgents.map(
          (agent) =>
            `${agent.id}:${agent.name}:${agent.description ?? ''}:${agent.type}:${agent.agentType ?? ''}`
        )
      ] as const,
    () => {
      if (!open.value) {
        return
      }

      refreshOpenResults(query.value)
    }
  )

  return {
    open,
    activationKey,
    query,
    results,
    activeIndex,
    loading,
    hasResults,
    pendingMessageJump,
    setOpen,
    setQuery,
    openSpotlight,
    closeSpotlight,
    toggleSpotlight,
    setActiveItem,
    moveActiveItem,
    executeItem,
    executeActiveItem,
    clearPendingMessageJump
  }
})
