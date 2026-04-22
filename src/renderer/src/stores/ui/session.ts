import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose, getCurrentScope } from 'vue'
import { createChatClient } from '../../../api/ChatClient'
import { createConfigClient } from '../../../api/ConfigClient'
import { createSessionClient } from '../../../api/SessionClient'
import { createTabClient } from '@api/TabClient'
import { getRuntimeWebContentsId } from '@api/runtime'
import type { ComputedRef } from 'vue'
import type {
  DeepChatSubagentMeta,
  SessionKind,
  SessionListItem,
  SessionWithState,
  CreateSessionInput,
  SendMessageInput
} from '@shared/types/agent-interface'
import { downloadBlob } from '@/lib/download'
import { useAgentStore } from './agent'
import { usePageRouterStore } from './pageRouter'
import { useMessageStore } from './message'
import { bindSessionStoreIpc } from './sessionIpc'

export type UISessionStatus = 'completed' | 'working' | 'error' | 'none'

export interface UISession {
  id: string
  title: string
  agentId: string
  status: UISessionStatus
  projectDir: string
  isPinned: boolean
  isDraft: boolean
  sessionKind: SessionKind
  parentSessionId: string | null
  subagentEnabled: boolean
  subagentMeta: DeepChatSubagentMeta | null
  createdAt: number
  updatedAt: number
}

export interface UIActiveSessionSummary extends UISession {
  providerId: string
  modelId: string
}

export interface SessionGroup {
  id: string
  label: string
  labelKey?: string
  sessions: UISession[]
}

export type GroupMode = 'time' | 'project'
export type StartNewConversationOptions = {
  refresh?: boolean
}
export type CloseSessionOptions = {
  refresh?: boolean
}

const SIDEBAR_GROUP_MODE_KEY = 'sidebar_group_mode'
const DEFAULT_GROUP_MODE: GroupMode = 'project'
const DEFAULT_SESSION_PAGE_SIZE = 30
const NO_PROJECT_GROUP_ID = '__no_project__'

function mapSessionStatus(status: string): UISessionStatus {
  switch (status) {
    case 'generating':
      return 'working'
    case 'error':
      return 'error'
    case 'idle':
      return 'none'
    default:
      return 'none'
  }
}

function mapToUISession(session: SessionListItem | SessionWithState): UISession {
  return {
    id: session.id,
    title: session.title,
    agentId: session.agentId,
    status: mapSessionStatus(session.status),
    projectDir: session.projectDir ?? '',
    isPinned: Boolean(session.isPinned),
    isDraft: Boolean(session.isDraft),
    sessionKind: session.sessionKind,
    parentSessionId: session.parentSessionId ?? null,
    subagentEnabled: session.subagentEnabled,
    subagentMeta: session.subagentMeta ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }
}

function mapToUIActiveSessionSummary(session: SessionWithState): UIActiveSessionSummary {
  return {
    ...mapToUISession(session),
    providerId: session.providerId,
    modelId: session.modelId
  }
}

function createFallbackActiveSession(session: UISession): UIActiveSessionSummary {
  return {
    ...session,
    providerId: '',
    modelId: ''
  }
}

function isRegularSession(session: Pick<UISession, 'sessionKind'>): boolean {
  return (session.sessionKind ?? 'regular') === 'regular'
}

function getCurrentWebContentsId(): number {
  return getRuntimeWebContentsId() ?? -1
}

function registerStoreCleanup(cleanup: () => void): void {
  if (getCurrentScope()) {
    onScopeDispose(cleanup)
  }
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function groupByTime(sessions: UISession[]): SessionGroup[] {
  const now = Date.now()
  const today = startOfDay(now)
  const yesterday = startOfDay(now - 86400000)
  const lastWeek = startOfDay(now - 7 * 86400000)

  const groups: Record<string, UISession[]> = {
    'common.time.today': [],
    'common.time.yesterday': [],
    'common.time.lastWeek': [],
    'common.time.older': []
  }

  for (const session of sessions) {
    if (session.updatedAt >= today) groups['common.time.today'].push(session)
    else if (session.updatedAt >= yesterday) groups['common.time.yesterday'].push(session)
    else if (session.updatedAt >= lastWeek) groups['common.time.lastWeek'].push(session)
    else groups['common.time.older'].push(session)
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([labelKey, items]) => ({ id: labelKey, label: labelKey, labelKey, sessions: items }))
}

function normalizeProjectGroupId(projectDir: string): string {
  const normalizedDir = projectDir.trim().replace(/[\\/]+$/, '')
  return normalizedDir || NO_PROJECT_GROUP_ID
}

function getProjectGroupLabel(projectGroupId: string): { label: string; labelKey?: string } {
  if (projectGroupId === NO_PROJECT_GROUP_ID) {
    return {
      label: 'common.project.none',
      labelKey: 'common.project.none'
    }
  }

  const label = projectGroupId.split(/[\\/]/).pop() ?? projectGroupId
  return { label }
}

function groupByProject(sessions: UISession[]): SessionGroup[] {
  const projectMap = new Map<string, UISession[]>()
  for (const session of sessions) {
    const projectGroupId = normalizeProjectGroupId(session.projectDir)
    if (!projectMap.has(projectGroupId)) {
      projectMap.set(projectGroupId, [])
    }
    projectMap.get(projectGroupId)!.push(session)
  }

  return Array.from(projectMap.entries()).map(([projectGroupId, groupedSessions]) => ({
    id: projectGroupId,
    ...getProjectGroupLabel(projectGroupId),
    sessions: groupedSessions
  }))
}

function getContentType(format: 'markdown' | 'html' | 'txt' | 'nowledge-mem'): string {
  switch (format) {
    case 'markdown':
      return 'text/markdown;charset=utf-8'
    case 'html':
      return 'text/html;charset=utf-8'
    case 'txt':
      return 'text/plain;charset=utf-8'
    case 'nowledge-mem':
      return 'application/json;charset=utf-8'
    default:
      return 'text/plain;charset=utf-8'
  }
}

function sortSessions(items: UISession[]): UISession[] {
  return [...items].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt
    }
    return right.id.localeCompare(left.id)
  })
}

function mergeSessions(current: UISession[], updates: UISession[]): UISession[] {
  const next = new Map(current.map((session) => [session.id, session]))

  for (const update of updates) {
    const existing = next.get(update.id)
    next.set(update.id, existing ? { ...existing, ...update } : update)
  }

  return sortSessions(Array.from(next.values()))
}

export const useSessionStore = defineStore('session', () => {
  const sessionClient = createSessionClient()
  const chatClient = createChatClient()
  const configClient = createConfigClient()
  const tabClient = createTabClient()
  const agentStore = useAgentStore()
  const pageRouter = usePageRouterStore()
  const messageStore = useMessageStore()
  const myWebContentsId = getCurrentWebContentsId()
  let rendererReadyNotified = false
  let groupModeLoadPromise: Promise<void> | null = null
  let groupModeWritePromise: Promise<void> = Promise.resolve()
  let hasLoadedGroupMode = false
  let groupModeUpdateVersion = 0
  let initialPageRequestId = 0
  let nextPageRequestId = 0

  const sessions = ref<UISession[]>([])
  const bootstrapActiveSession = ref<UISession | null>(null)
  const activeSessionSummary = ref<UIActiveSessionSummary | null>(null)
  const activeSessionId = ref<string | null>(null)
  const groupMode = ref<GroupMode>(DEFAULT_GROUP_MODE)
  const loading = ref(false)
  const loadingMore = ref(false)
  const hasLoadedInitialPage = ref(false)
  const hasMore = ref(false)
  const nextCursor = ref<{ updatedAt: number; id: string } | null>(null)
  const error = ref<string | null>(null)

  const setActiveSessionId = (sessionId: string | null): void => {
    activeSessionId.value = sessionId
    messageStore.setCurrentSessionId(sessionId)
  }

  const notifyRendererReady = (): void => {
    if (rendererReadyNotified) return
    rendererReadyNotified = true
    void tabClient.notifyRendererReady()
  }

  notifyRendererReady()

  const normalizeGroupMode = (value: unknown): GroupMode =>
    value === 'time' || value === 'project' ? value : DEFAULT_GROUP_MODE

  const loadGroupModePreference = async (): Promise<void> => {
    const loadVersion = groupModeUpdateVersion

    try {
      const savedGroupMode = await configClient.getSetting(SIDEBAR_GROUP_MODE_KEY)
      if (groupModeUpdateVersion === loadVersion) {
        groupMode.value = normalizeGroupMode(savedGroupMode)
      }
    } catch (loadError) {
      if (groupModeUpdateVersion === loadVersion) {
        groupMode.value = DEFAULT_GROUP_MODE
      }
      console.warn('[sessionStore] Failed to load sidebar group mode:', loadError)
    } finally {
      hasLoadedGroupMode = true
    }
  }

  const ensureGroupModeLoaded = async (): Promise<void> => {
    if (hasLoadedGroupMode) {
      return
    }

    if (!groupModeLoadPromise) {
      groupModeLoadPromise = loadGroupModePreference().finally(() => {
        groupModeLoadPromise = null
      })
    }

    await groupModeLoadPromise
  }

  const clearActiveSessionSummary = () => {
    activeSessionSummary.value = null
  }

  const updateBootstrapActiveSession = (session: UISession | null) => {
    bootstrapActiveSession.value = session
  }

  const upsertSessions = (updates: UISession[]): void => {
    sessions.value = mergeSessions(sessions.value, updates)
  }

  const removeSessions = (sessionIds: string[]): void => {
    const targetIds = new Set(sessionIds)
    sessions.value = sessions.value.filter((session) => !targetIds.has(session.id))

    if (bootstrapActiveSession.value && targetIds.has(bootstrapActiveSession.value.id)) {
      bootstrapActiveSession.value = null
    }

    if (activeSessionSummary.value && targetIds.has(activeSessionSummary.value.id)) {
      activeSessionSummary.value = null
    }

    if (activeSessionId.value && targetIds.has(activeSessionId.value)) {
      messageStore.clearStreamingState()
      setActiveSessionId(null)
      pageRouter.goToNewThread()
    }
  }

  const activeSession: ComputedRef<UIActiveSessionSummary | undefined> = computed(() => {
    const sessionId = activeSessionId.value
    if (!sessionId) {
      return undefined
    }

    if (activeSessionSummary.value?.id === sessionId) {
      return activeSessionSummary.value
    }

    const lightweightSession =
      sessions.value.find((session) => session.id === sessionId) ??
      (bootstrapActiveSession.value?.id === sessionId ? bootstrapActiveSession.value : null)

    return lightweightSession ? createFallbackActiveSession(lightweightSession) : undefined
  })

  const hasActiveSession: ComputedRef<boolean> = computed(() => activeSessionId.value !== null)

  const newConversationTargetAgentId = computed(() => {
    const selectedAgentId =
      typeof agentStore.selectedAgentId === 'string' ? agentStore.selectedAgentId.trim() : ''
    if (selectedAgentId) {
      return selectedAgentId
    }

    const activeSessionAgentId =
      typeof activeSession.value?.agentId === 'string' ? activeSession.value.agentId.trim() : ''
    if (activeSessionAgentId) {
      return activeSessionAgentId
    }

    const fallbackAgentId =
      typeof agentStore.enabledAgents[0]?.id === 'string'
        ? agentStore.enabledAgents[0].id.trim()
        : ''
    return fallbackAgentId || null
  })

  const sessionGroups: ComputedRef<SessionGroup[]> = computed(() => getFilteredGroups(null))

  const syncSelectedAgentToSession = (
    sessionId: string | null,
    availableSessions: UISession[] = sessions.value
  ): void => {
    if (!sessionId) {
      return
    }

    const targetSession =
      availableSessions.find((session) => session.id === sessionId) ??
      (bootstrapActiveSession.value?.id === sessionId ? bootstrapActiveSession.value : null)
    const targetAgentId = targetSession?.agentId?.trim()
    if (!targetAgentId || agentStore.selectedAgentId === targetAgentId) {
      return
    }

    agentStore.setSelectedAgent(targetAgentId)
  }

  const applySessionStatus = (sessionId: string, status: string): void => {
    const nextStatus = mapSessionStatus(status)
    const index = sessions.value.findIndex((session) => session.id === sessionId)
    if (index >= 0 && sessions.value[index].status !== nextStatus) {
      sessions.value[index] = {
        ...sessions.value[index],
        status: nextStatus
      }
    }

    if (
      bootstrapActiveSession.value?.id === sessionId &&
      bootstrapActiveSession.value.status !== nextStatus
    ) {
      bootstrapActiveSession.value = {
        ...bootstrapActiveSession.value,
        status: nextStatus
      }
    }

    if (
      activeSessionSummary.value?.id === sessionId &&
      activeSessionSummary.value.status !== nextStatus
    ) {
      activeSessionSummary.value = {
        ...activeSessionSummary.value,
        status: nextStatus
      }
    }
  }

  const applyRestoredSession = (session: SessionWithState | null): void => {
    if (!session) {
      if (activeSessionId.value === null) {
        activeSessionSummary.value = null
      }
      return
    }

    activeSessionSummary.value = mapToUIActiveSessionSummary(session)
    const lightweightSession = mapToUISession(session)
    upsertSessions([lightweightSession])
    if (activeSessionId.value === session.id) {
      bootstrapActiveSession.value = lightweightSession
      syncSelectedAgentToSession(session.id)
    }
  }

  const applyBootstrapShell = async (input: {
    activeSessionId: string | null
    activeSession?: SessionListItem | null
  }): Promise<void> => {
    await ensureGroupModeLoaded()

    const previousActiveSessionId = activeSessionId.value
    const nextActiveSessionId = input.activeSessionId ?? null

    if (previousActiveSessionId && previousActiveSessionId !== nextActiveSessionId) {
      messageStore.clearStreamingState()
    }

    setActiveSessionId(nextActiveSessionId)
    clearActiveSessionSummary()
    updateBootstrapActiveSession(input.activeSession ? mapToUISession(input.activeSession) : null)
    syncSelectedAgentToSession(nextActiveSessionId)
  }

  const loadSessionPage = async (options: {
    reset: boolean
    preserveExisting?: boolean
    prioritizeSessionId?: string | null
  }): Promise<void> => {
    if (options.reset) {
      const requestId = ++initialPageRequestId
      loading.value = true
      error.value = null

      try {
        await ensureGroupModeLoaded()
        const result = await sessionClient.listLightweight({
          limit: DEFAULT_SESSION_PAGE_SIZE,
          cursor: null,
          includeSubagents: true,
          prioritizeSessionId: options.prioritizeSessionId ?? undefined
        })

        if (requestId !== initialPageRequestId) {
          return
        }

        const nextSessions = result.items.map(mapToUISession)
        sessions.value = options.preserveExisting
          ? mergeSessions(sessions.value, nextSessions)
          : sortSessions(nextSessions)
        hasLoadedInitialPage.value = true
        hasMore.value = result.hasMore
        nextCursor.value = result.nextCursor
        syncSelectedAgentToSession(activeSessionId.value)
      } catch (loadError) {
        error.value = `Failed to load sessions: ${loadError}`
      } finally {
        if (requestId === initialPageRequestId) {
          loading.value = false
        }
      }

      return
    }

    if (loadingMore.value || !hasMore.value || !nextCursor.value) {
      return
    }

    const requestId = ++nextPageRequestId
    loadingMore.value = true
    error.value = null

    try {
      const result = await sessionClient.listLightweight({
        limit: DEFAULT_SESSION_PAGE_SIZE,
        cursor: nextCursor.value,
        includeSubagents: true
      })

      if (requestId !== nextPageRequestId) {
        return
      }

      upsertSessions(result.items.map(mapToUISession))
      hasMore.value = result.hasMore
      nextCursor.value = result.nextCursor
      console.info(
        `[Startup][Renderer] startup.session.page.appended count=${result.items.length} total=${sessions.value.length}`
      )
    } catch (loadError) {
      error.value = `Failed to load more sessions: ${loadError}`
    } finally {
      if (requestId === nextPageRequestId) {
        loadingMore.value = false
      }
    }
  }

  async function fetchSessions(): Promise<void> {
    await loadSessionPage({
      reset: true,
      prioritizeSessionId: activeSessionId.value ?? bootstrapActiveSession.value?.id ?? null
    })
  }

  async function loadNextPage(): Promise<void> {
    await loadSessionPage({ reset: false })
  }

  async function refreshSessionsByIds(sessionIds: string[]): Promise<void> {
    const normalizedIds = Array.from(
      new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))
    )
    if (normalizedIds.length === 0) {
      await loadSessionPage({
        reset: true,
        preserveExisting: true,
        prioritizeSessionId: activeSessionId.value ?? bootstrapActiveSession.value?.id ?? null
      })
      return
    }

    error.value = null
    try {
      const items = await sessionClient.getLightweightByIds(normalizedIds)
      upsertSessions(items.map(mapToUISession))

      const activeId = activeSessionId.value
      if (activeId) {
        const activeItem = items.find((item) => item.id === activeId)
        if (activeItem) {
          updateBootstrapActiveSession(mapToUISession(activeItem))
          syncSelectedAgentToSession(activeId)
        }
      }
    } catch (refreshError) {
      error.value = `Failed to refresh sessions: ${refreshError}`
    }
  }

  async function createSession(input: CreateSessionInput): Promise<void> {
    error.value = null
    try {
      const result = await sessionClient.create(input)
      const session = result.session
      const lightweightSession = mapToUISession(session)
      upsertSessions([lightweightSession])
      setActiveSessionId(session.id)
      bootstrapActiveSession.value = lightweightSession
      activeSessionSummary.value = mapToUIActiveSessionSummary(session)
      syncSelectedAgentToSession(session.id)
      pageRouter.goToChat(session.id)
    } catch (createError) {
      error.value = `Failed to create session: ${createError}`
    }
  }

  async function selectSession(sessionId: string): Promise<void> {
    error.value = null
    try {
      if (activeSessionId.value && activeSessionId.value !== sessionId) {
        messageStore.clearStreamingState()
      }
      await sessionClient.activate(sessionId)
      clearActiveSessionSummary()
      syncSelectedAgentToSession(sessionId)
      setActiveSessionId(sessionId)
      pageRouter.goToChat(sessionId)
    } catch (selectError) {
      error.value = `Failed to select session: ${selectError}`
    }
  }

  async function closeSession(options: CloseSessionOptions = {}): Promise<void> {
    error.value = null
    try {
      messageStore.clearStreamingState()
      await sessionClient.deactivate()
      clearActiveSessionSummary()
      setActiveSessionId(null)
      pageRouter.goToNewThread(options.refresh ? { refresh: true } : {})
    } catch (closeError) {
      error.value = `Failed to close session: ${closeError}`
    }
  }

  async function startNewConversation(options: StartNewConversationOptions = {}): Promise<void> {
    error.value = null

    const targetAgentId = newConversationTargetAgentId.value
    if (!targetAgentId) {
      return
    }

    if (agentStore.selectedAgentId !== targetAgentId) {
      agentStore.setSelectedAgent(targetAgentId)
    }

    if (hasActiveSession.value) {
      await closeSession({ refresh: options.refresh ?? true })
      return
    }

    pageRouter.goToNewThread({ refresh: options.refresh ?? true })
  }

  async function sendMessage(sessionId: string, content: string | SendMessageInput): Promise<void> {
    error.value = null
    try {
      await chatClient.sendMessage(sessionId, content)
    } catch (sendError) {
      error.value = `Failed to send message: ${sendError}`
    }
  }

  async function setSessionModel(
    sessionId: string,
    providerId: string,
    modelId: string
  ): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.setSessionModel(sessionId, providerId, modelId)
      upsertSessions([mapToUISession(updated)])
      if (activeSessionId.value === sessionId) {
        applyRestoredSession(updated)
      }
    } catch (updateError) {
      error.value = `Failed to set session model: ${updateError}`
      throw updateError
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    error.value = null
    try {
      await sessionClient.deleteSession(sessionId)
      removeSessions([sessionId])
      if (activeSessionId.value === sessionId) {
        messageStore.clearStreamingState()
        setActiveSessionId(null)
        pageRouter.goToNewThread()
      }
    } catch (deleteError) {
      error.value = `Failed to delete session: ${deleteError}`
    }
  }

  async function setSessionSubagentEnabled(sessionId: string, enabled: boolean): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.setSessionSubagentEnabled(sessionId, enabled)
      upsertSessions([mapToUISession(updated)])
      if (activeSessionId.value === sessionId) {
        applyRestoredSession(updated)
      }
    } catch (updateError) {
      error.value = `Failed to update subagent state: ${updateError}`
      throw updateError
    }
  }

  async function setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.setSessionProjectDir(sessionId, projectDir)
      upsertSessions([mapToUISession(updated)])
      if (activeSessionId.value === sessionId) {
        applyRestoredSession(updated)
      }
    } catch (updateError) {
      error.value = `Failed to set session project directory: ${updateError}`
      throw updateError
    }
  }

  async function renameSession(sessionId: string, title: string): Promise<void> {
    error.value = null
    try {
      const normalized = title.trim()
      if (!normalized) {
        return
      }
      await sessionClient.renameSession(sessionId, normalized)
      const target = sessions.value.find((session) => session.id === sessionId)
      if (target) {
        target.title = normalized
      }
      if (bootstrapActiveSession.value?.id === sessionId) {
        bootstrapActiveSession.value = {
          ...bootstrapActiveSession.value,
          title: normalized
        }
      }
      if (activeSessionSummary.value?.id === sessionId) {
        activeSessionSummary.value = {
          ...activeSessionSummary.value,
          title: normalized
        }
      }
    } catch (renameError) {
      error.value = `Failed to rename session: ${renameError}`
      throw renameError
    }
  }

  async function toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    error.value = null
    try {
      await sessionClient.toggleSessionPinned(sessionId, pinned)
      const target = sessions.value.find((session) => session.id === sessionId)
      if (target) {
        target.isPinned = pinned
      }
      if (bootstrapActiveSession.value?.id === sessionId) {
        bootstrapActiveSession.value = {
          ...bootstrapActiveSession.value,
          isPinned: pinned
        }
      }
      if (activeSessionSummary.value?.id === sessionId) {
        activeSessionSummary.value = {
          ...activeSessionSummary.value,
          isPinned: pinned
        }
      }
      sessions.value = sortSessions(sessions.value)
    } catch (pinError) {
      error.value = `Failed to toggle pinned state: ${pinError}`
      throw pinError
    }
  }

  async function clearSessionMessages(sessionId: string): Promise<void> {
    error.value = null
    try {
      await sessionClient.clearSessionMessages(sessionId)
      if (activeSessionId.value === sessionId) {
        messageStore.clearStreamingState()
        const restored = await messageStore.loadMessages(sessionId)
        applyRestoredSession(restored)
      }
    } catch (clearError) {
      error.value = `Failed to clear session messages: ${clearError}`
      throw clearError
    }
  }

  async function exportSession(
    sessionId: string,
    format: 'markdown' | 'html' | 'txt' | 'nowledge-mem'
  ): Promise<{ filename: string; content: string }> {
    error.value = null
    try {
      const result = await sessionClient.exportSession(sessionId, format)
      const blob = new Blob([result.content], {
        type: getContentType(format)
      })
      downloadBlob(blob, result.filename)
      return result
    } catch (exportError) {
      error.value = `Failed to export session: ${exportError}`
      throw exportError
    }
  }

  async function toggleGroupMode(): Promise<void> {
    const previousMode = groupMode.value
    groupMode.value = previousMode === 'time' ? 'project' : 'time'
    const localVersion = ++groupModeUpdateVersion

    groupModeWritePromise = groupModeWritePromise.then(async () => {
      try {
        await configClient.setSetting(SIDEBAR_GROUP_MODE_KEY, groupMode.value)
        if (localVersion !== groupModeUpdateVersion) {
          return
        }
      } catch (persistError) {
        if (localVersion === groupModeUpdateVersion) {
          groupMode.value = previousMode
        }
        console.warn('[sessionStore] Failed to persist sidebar group mode:', persistError)
      }
    })

    await groupModeWritePromise
  }

  function getPinnedSessions(agentId: string | null): UISession[] {
    const pinned = sessions.value
      .filter((session) => isRegularSession(session) && session.isPinned && !session.isDraft)
      .sort((left, right) => {
        if (right.updatedAt !== left.updatedAt) {
          return right.updatedAt - left.updatedAt
        }
        return right.id.localeCompare(left.id)
      })

    if (agentId === null) return pinned

    return pinned.filter((session) => session.agentId === agentId)
  }

  function getFilteredGroups(agentId: string | null): SessionGroup[] {
    const visibleSessions = sessions.value.filter(
      (session) => isRegularSession(session) && !session.isDraft && !session.isPinned
    )
    const grouped =
      groupMode.value === 'time' ? groupByTime(visibleSessions) : groupByProject(visibleSessions)

    if (agentId === null) return grouped

    return grouped
      .map((group) => ({
        id: group.id,
        label: group.label,
        labelKey: group.labelKey,
        sessions: group.sessions.filter((session) => session.agentId === agentId)
      }))
      .filter((group) => group.sessions.length > 0)
  }

  const cleanupIpcBindings = bindSessionStoreIpc({
    webContentsId: myWebContentsId,
    fetchSessions,
    refreshSessionsByIds,
    removeSessions,
    onActivated: (sessionId) => {
      if (activeSessionId.value && activeSessionId.value !== sessionId) {
        messageStore.clearStreamingState()
      }
      clearActiveSessionSummary()
      syncSelectedAgentToSession(sessionId)
      setActiveSessionId(sessionId)
      pageRouter.goToChat(sessionId)
      void tabClient.notifyRendererActivated(sessionId)
    },
    onDeactivated: () => {
      messageStore.clearStreamingState()
      clearActiveSessionSummary()
      setActiveSessionId(null)
      pageRouter.goToNewThread()
    },
    onStatusChanged: (sessionId, status) => {
      applySessionStatus(sessionId, status)
    }
  })
  registerStoreCleanup(cleanupIpcBindings)
  void ensureGroupModeLoaded()

  return {
    sessions,
    activeSessionId,
    groupMode,
    loading,
    loadingMore,
    hasLoadedInitialPage,
    hasMore,
    error,
    activeSession,
    sessionGroups,
    hasActiveSession,
    newConversationTargetAgentId,
    applyBootstrapShell,
    applyRestoredSession,
    fetchSessions,
    loadNextPage,
    refreshSessionsByIds,
    createSession,
    sendMessage,
    setSessionModel,
    selectSession,
    closeSession,
    startNewConversation,
    renameSession,
    toggleSessionPinned,
    clearSessionMessages,
    exportSession,
    deleteSession,
    setSessionSubagentEnabled,
    setSessionProjectDir,
    toggleGroupMode,
    getPinnedSessions,
    getFilteredGroups
  }
})
