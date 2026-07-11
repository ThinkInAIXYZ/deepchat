import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose, getCurrentScope } from 'vue'
import { createChatClient } from '../../../api/ChatClient'
import { createConfigClient } from '../../../api/ConfigClient'
import { createOnboardingClient } from '../../../api/OnboardingClient'
import { createSessionClient } from '../../../api/SessionClient'
import { createTabClient } from '@api/TabClient'
import { getRuntimeWebContentsId } from '@api/runtime'
import type { ComputedRef } from 'vue'
import type {
  CreateSessionOperationSummary,
  GuidedOnboardingStepId,
  PublicSessionResolution,
  SessionCreateOutput
} from '@shared/contracts/routes'
import type {
  DeepChatSubagentMeta,
  SessionKind,
  SessionMetadata,
  SessionListItem,
  SessionWithState,
  CreateSessionInput,
  SendMessageInput
} from '@shared/types/agent-interface'
import { downloadBlob } from '@/lib/download'
import {
  readGuidedOnboardingResumeIntent,
  requestGuidedOnboardingResume
} from '@/lib/onboardingResume'
import { useAgentStore } from './agent'
import { usePageRouterStore } from './pageRouter'
import { useMessageStore, type MessageRestoreOutcome } from './message'
import { useAgentPlanStore } from './agentPlan'
import { bindSessionStoreIpc } from './sessionIpc'

export type UISessionStatus = 'completed' | 'working' | 'error' | 'none'

export type UISessionAvailability = {
  availability: PublicSessionResolution['availability']
  sessionId: string
  source: 'main' | 'legacy' | 'renderer'
}

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
  metadata?: SessionMetadata | null
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

export type CreateSessionIntentStatus =
  | 'creating'
  | 'pending'
  | 'failed'
  | 'unknown'
  | 'query_error'
  | 'missing'
  | 'existing'
  | 'conflict'
  | 'activation_failed'
  | 'unavailable'

export type CurrentCreateSessionIntent = {
  token: number
  requestedOperationId: string
  status: CreateSessionIntentStatus
  operation: CreateSessionOperationSummary | null
}

const SIDEBAR_GROUP_MODE_KEY = 'sidebar_group_mode'
const DEFAULT_GROUP_MODE: GroupMode = 'project'
const DEFAULT_SESSION_PAGE_SIZE = 30
const DEFAULT_CREATE_OPERATION_PAGE_SIZE = 20
const NO_PROJECT_GROUP_ID = '__no_project__'
const SESSION_TITLE_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})

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
  const metadata = session.metadata ?? null
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
    ...(metadata ? { metadata } : {}),
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

async function getCurrentWebContentsId(): Promise<number | null> {
  return await getRuntimeWebContentsId()
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

function sortProjectGroupSessions(items: UISession[]): UISession[] {
  return [...items].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt
    }

    return compareSessions(left, right)
  })
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
    sessions: sortProjectGroupSessions(groupedSessions)
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

function compareSessions(left: UISession, right: UISession): number {
  const titleCompare = SESSION_TITLE_COLLATOR.compare(left.title.trim(), right.title.trim())
  if (titleCompare !== 0) {
    return titleCompare
  }

  return left.id.localeCompare(right.id)
}

function sortSessions(items: UISession[]): UISession[] {
  return [...items].sort((left, right) => {
    return compareSessions(left, right)
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

function cloneSessionPageCursor(
  cursor: { updatedAt: number; id: string } | null
): { updatedAt: number; id: string } | null {
  return cursor ? { updatedAt: cursor.updatedAt, id: cursor.id } : null
}

function mergeCreateOperations(
  current: CreateSessionOperationSummary[],
  updates: CreateSessionOperationSummary[]
): CreateSessionOperationSummary[] {
  const next = new Map(current.map((operation) => [operation.operationId, operation]))
  for (const operation of updates) {
    next.set(operation.operationId, operation)
  }
  return Array.from(next.values()).sort((left, right) => {
    if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt
    return left.operationId.localeCompare(right.operationId)
  })
}

export const useSessionStore = defineStore('session', () => {
  const sessionClient = createSessionClient()
  const chatClient = createChatClient()
  const configClient = createConfigClient()
  const onboardingClient = createOnboardingClient()
  const tabClient = createTabClient()
  const agentStore = useAgentStore()
  const pageRouter = usePageRouterStore()
  const messageStore = useMessageStore()
  const agentPlanStore = useAgentPlanStore()
  const myWebContentsId = ref<number | null>(null)
  let rendererReadyNotified = false
  let groupModeLoadPromise: Promise<void> | null = null
  let groupModeWritePromise: Promise<void> = Promise.resolve()
  let hasLoadedGroupMode = false
  let groupModeUpdateVersion = 0
  let initialPageRequestId = 0
  let nextPageRequestId = 0
  let activationNavigationRequestId = 0
  let createIntentVersion = 0
  let createOperationHistoryRequestId = 0
  let sessionFetchPromise: Promise<void> | null = null
  let createOperationHistoryFetchPromise: Promise<void> | null = null
  let localActivationRequest: { requestId: number; sessionId: string } | null = null

  const sessions = ref<UISession[]>([])
  const bootstrapActiveSession = ref<UISession | null>(null)
  const activeSessionSummary = ref<UIActiveSessionSummary | null>(null)
  const activeSessionId = ref<string | null>(null)
  const availabilityBySessionId = ref<Record<string, UISessionAvailability>>({})
  const missingSessionNoticeSequence = ref(0)
  const groupMode = ref<GroupMode>(DEFAULT_GROUP_MODE)
  const loading = ref(false)
  const loadingMore = ref(false)
  const hasLoadedInitialPage = ref(false)
  const hasMore = ref(false)
  const nextCursor = ref<{ updatedAt: number; id: string } | null>(null)
  const currentCreateIntent = ref<CurrentCreateSessionIntent | null>(null)
  const createOperationHistory = ref<CreateSessionOperationSummary[]>([])
  const createOperationHistoryLoading = ref(false)
  const createOperationHistoryLoadingMore = ref(false)
  const createOperationHistoryHasMore = ref(false)
  const createOperationHistoryNextCursor = ref<{
    createdAt: number
    operationId: string
  } | null>(null)
  const createOperationHistoryError = ref<string | null>(null)
  const error = ref<string | null>(null)

  void getCurrentWebContentsId()
    .then((webContentsId) => {
      myWebContentsId.value = webContentsId
    })
    .catch((identityError) => {
      console.warn('[sessionStore] Failed to resolve runtime webContents id:', identityError)
    })

  const pruneSessionAvailability = (): void => {
    const retainedSessionIds = new Set(sessions.value.map((session) => session.id))
    if (activeSessionId.value) {
      retainedSessionIds.add(activeSessionId.value)
    }

    const entries = Object.entries(availabilityBySessionId.value).filter(([sessionId]) =>
      retainedSessionIds.has(sessionId)
    )
    if (entries.length === Object.keys(availabilityBySessionId.value).length) {
      return
    }

    availabilityBySessionId.value = Object.fromEntries(entries)
  }

  const setActiveSessionId = (sessionId: string | null): void => {
    activeSessionId.value = sessionId
    messageStore.setCurrentSessionId(sessionId)
    pruneSessionAvailability()
  }

  const createActivationNavigationRequest = (): number => {
    activationNavigationRequestId += 1
    return activationNavigationRequestId
  }

  const isCurrentActivationNavigation = (requestId: number, sessionId: string): boolean =>
    activationNavigationRequestId === requestId && activeSessionId.value === sessionId

  const invalidateCurrentCreateIntent = (token?: number): void => {
    if (token !== undefined && currentCreateIntent.value?.token !== token) return
    createIntentVersion += 1
    currentCreateIntent.value = null
  }

  const isCurrentCreateIntent = (token: number): boolean =>
    currentCreateIntent.value?.token === token && createIntentVersion === token

  const upsertCreateOperations = (operations: CreateSessionOperationSummary[]): void => {
    createOperationHistory.value = mergeCreateOperations(createOperationHistory.value, operations)
  }

  const setCurrentCreateIntent = (
    token: number,
    patch: Omit<Partial<CurrentCreateSessionIntent>, 'token' | 'requestedOperationId'>
  ): boolean => {
    const current = currentCreateIntent.value
    if (!current || current.token !== token || createIntentVersion !== token) return false
    currentCreateIntent.value = { ...current, ...patch }
    return true
  }

  const beginLocalActivation = (requestId: number, sessionId: string): void => {
    localActivationRequest = { requestId, sessionId }
  }

  const endLocalActivation = (requestId: number, sessionId: string): void => {
    if (
      localActivationRequest?.requestId === requestId &&
      localActivationRequest.sessionId === sessionId
    ) {
      localActivationRequest = null
    }
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
    pruneSessionAvailability()
  }

  const removeSessions = (sessionIds: string[]): void => {
    const targetIds = new Set(sessionIds)
    sessions.value = sessions.value.filter((session) => !targetIds.has(session.id))
    const remainingAvailability = { ...availabilityBySessionId.value }
    for (const sessionId of targetIds) {
      agentPlanStore.purge(sessionId)
      delete remainingAvailability[sessionId]
    }
    availabilityBySessionId.value = remainingAvailability

    if (bootstrapActiveSession.value && targetIds.has(bootstrapActiveSession.value.id)) {
      bootstrapActiveSession.value = null
    }

    if (activeSessionSummary.value && targetIds.has(activeSessionSummary.value.id)) {
      activeSessionSummary.value = null
    }

    if (activeSessionId.value && targetIds.has(activeSessionId.value)) {
      createActivationNavigationRequest()
      messageStore.clearStreamingState()
      setActiveSessionId(null)
      pageRouter.goToNewThread()
    }
    pruneSessionAvailability()
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
  const activeSessionAvailability = computed(() => {
    const sessionId = activeSessionId.value
    return sessionId ? (availabilityBySessionId.value[sessionId] ?? null) : null
  })

  const setSessionAvailability = (
    sessionId: string,
    availability: UISessionAvailability['availability'],
    source: UISessionAvailability['source']
  ): void => {
    if (
      activeSessionId.value !== sessionId &&
      !sessions.value.some((session) => session.id === sessionId)
    ) {
      return
    }
    availabilityBySessionId.value = {
      ...availabilityBySessionId.value,
      [sessionId]: { availability, sessionId, source }
    }
  }

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
    setSessionAvailability(session.id, 'available', 'main')
    if (activeSessionId.value === session.id) {
      bootstrapActiveSession.value = lightweightSession
      syncSelectedAgentToSession(session.id)
    }
  }

  const applySessionRestoreOutcome = (outcome: MessageRestoreOutcome): void => {
    if (outcome.rendererTransient) {
      setSessionAvailability(outcome.sessionId, 'transient_error', 'renderer')
      return
    }

    const resolution = outcome.resolution
    if (resolution === null) {
      if (activeSessionId.value !== outcome.sessionId) {
        return
      }

      createActivationNavigationRequest()
      messageStore.clear()
      clearActiveSessionSummary()
      setActiveSessionId(null)
      pageRouter.goToNewThread()
      return
    }

    if (!resolution) {
      if (outcome.session) {
        applyRestoredSession(outcome.session)
        setSessionAvailability(outcome.sessionId, 'available', 'legacy')
      } else {
        setSessionAvailability(outcome.sessionId, 'transient_error', 'legacy')
      }
      return
    }

    setSessionAvailability(outcome.sessionId, resolution.availability, 'main')
    if (resolution.availability === 'available') {
      applyRestoredSession(resolution.session)
      return
    }

    if (resolution.availability !== 'missing' || activeSessionId.value !== outcome.sessionId) {
      return
    }

    createActivationNavigationRequest()
    messageStore.clear()
    clearActiveSessionSummary()
    setActiveSessionId(null)
    missingSessionNoticeSequence.value += 1
    pageRouter.goToNewThread()
  }

  const hydrateActiveSessionSummary = async (sessionId: string): Promise<MessageRestoreOutcome> => {
    try {
      const active = await sessionClient.getActive()
      const resolvedSessionId = active.resolution
        ? active.resolution.availability === 'available'
          ? active.resolution.session.id
          : active.resolution.sessionId
        : active.session?.id
      return {
        sessionId: resolvedSessionId ?? sessionId,
        session: active.session,
        resolution: active.resolution
      }
    } catch (restoreError) {
      console.warn('[sessionStore] Failed to hydrate selected session:', restoreError)
      return {
        sessionId,
        session: null,
        rendererTransient: true
      }
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
          // 侧边栏只展示 regular 会话；携带子代理会话会占用分页名额，
          // 导致一页 30 条里的可见 regular 会话被显示层过滤后所剩无几。
          includeSubagents: false,
          prioritizeSessionId: options.prioritizeSessionId ?? undefined
        })

        if (requestId !== initialPageRequestId) {
          return
        }

        const nextSessions = result.items.map(mapToUISession)
        sessions.value = options.preserveExisting
          ? mergeSessions(sessions.value, nextSessions)
          : sortSessions(nextSessions)
        pruneSessionAvailability()
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
        cursor: cloneSessionPageCursor(nextCursor.value),
        // 与首屏一致：仅分页 regular 会话，避免子代理会话占用页槽。
        includeSubagents: false
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

  function fetchSessions(): Promise<void> {
    if (sessionFetchPromise) {
      return sessionFetchPromise
    }

    const loadPromise = loadSessionPage({
      reset: true,
      prioritizeSessionId: activeSessionId.value ?? bootstrapActiveSession.value?.id ?? null
    })
    const currentFetchPromise = loadPromise.finally(() => {
      if (sessionFetchPromise === currentFetchPromise) {
        sessionFetchPromise = null
      }
    })

    sessionFetchPromise = currentFetchPromise
    return currentFetchPromise
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

  const refreshSucceededCreateOperation = (operation: CreateSessionOperationSummary): void => {
    if (operation.state === 'succeeded') {
      void refreshSessionsByIds([operation.sessionId])
    }
  }

  const applyStaleCreateOutput = (result: SessionCreateOutput): void => {
    upsertCreateOperations([result.operation])
    if (result.kind === 'operation' && result.session) {
      upsertSessions([mapToUISession(result.session)])
      return
    }
    refreshSucceededCreateOperation(result.operation)
  }

  const activateCreatedSession = async (
    token: number,
    session: SessionWithState
  ): Promise<boolean> => {
    const lightweightSession = mapToUISession(session)
    upsertSessions([lightweightSession])
    if (!isCurrentCreateIntent(token)) return false

    const requestId = createActivationNavigationRequest()
    beginLocalActivation(requestId, session.id)
    try {
      let activationConfirmed = false
      try {
        await sessionClient.activate(session.id)
        activationConfirmed = true
      } catch {
        try {
          const active = await sessionClient.getActive()
          const confirmedSessionId =
            active.session?.id ??
            (active.resolution?.availability === 'available'
              ? active.resolution.session.id
              : active.resolution && active.resolution.availability !== 'missing'
                ? active.resolution.sessionId
                : null)
          activationConfirmed = confirmedSessionId === session.id
        } catch {
          activationConfirmed = false
        }
        if (!activationConfirmed) {
          if (isCurrentCreateIntent(token)) {
            setCurrentCreateIntent(token, { status: 'activation_failed' })
            error.value = 'Failed to activate created session'
          }
          return false
        }
      }

      if (!isCurrentCreateIntent(token) || activationNavigationRequestId !== requestId) {
        return false
      }

      if (activeSessionId.value && activeSessionId.value !== session.id) {
        messageStore.clearStreamingState()
      }
      setActiveSessionId(session.id)
      bootstrapActiveSession.value = lightweightSession
      activeSessionSummary.value = mapToUIActiveSessionSummary(session)
      setSessionAvailability(session.id, 'available', 'main')
      syncSelectedAgentToSession(session.id)
      currentCreateIntent.value = null
      pageRouter.goToChat(session.id)
      await completeOnboardingStep('first-chat')
      return true
    } finally {
      endLocalActivation(requestId, session.id)
    }
  }

  const applyCreateOperationResult = async (
    token: number,
    result: {
      operation: CreateSessionOperationSummary | null
      session: SessionWithState | null
    }
  ): Promise<boolean> => {
    const { operation, session } = result
    if (operation) upsertCreateOperations([operation])

    if (!isCurrentCreateIntent(token)) {
      if (session) upsertSessions([mapToUISession(session)])
      if (operation) refreshSucceededCreateOperation(operation)
      return false
    }

    if (!operation) {
      setCurrentCreateIntent(token, { status: 'missing', operation: null })
      return false
    }

    setCurrentCreateIntent(token, { operation })
    switch (operation.state) {
      case 'pending':
        setCurrentCreateIntent(token, { status: 'pending' })
        return false
      case 'failed':
        setCurrentCreateIntent(token, { status: 'failed' })
        return false
      case 'unknown':
        setCurrentCreateIntent(token, { status: 'unknown' })
        return false
      case 'succeeded':
        if (!session) {
          setCurrentCreateIntent(token, { status: 'unavailable' })
          refreshSucceededCreateOperation(operation)
          return false
        }
        return await activateCreatedSession(token, session)
    }
  }

  const applyCreateOutput = async (
    token: number,
    result: SessionCreateOutput
  ): Promise<boolean> => {
    if (!isCurrentCreateIntent(token)) {
      applyStaleCreateOutput(result)
      return false
    }

    upsertCreateOperations([result.operation])
    if (result.kind === 'existing' || result.kind === 'conflict') {
      setCurrentCreateIntent(token, {
        status: result.kind,
        operation: result.operation
      })
      return false
    }
    return await applyCreateOperationResult(token, result)
  }

  async function createSession(input: CreateSessionInput): Promise<boolean> {
    error.value = null
    createActivationNavigationRequest()
    const token = ++createIntentVersion
    const operationId = sessionClient.createOperationId()
    currentCreateIntent.value = {
      token,
      requestedOperationId: operationId,
      status: 'creating',
      operation: null
    }

    try {
      const result = await sessionClient.create(input, operationId)
      return await applyCreateOutput(token, result)
    } catch {
      if (!isCurrentCreateIntent(token)) return false
      error.value = 'Failed to create session'
      try {
        const result = await sessionClient.getCreateOperation(operationId)
        return await applyCreateOperationResult(token, result)
      } catch {
        if (isCurrentCreateIntent(token)) {
          setCurrentCreateIntent(token, { status: 'query_error' })
          error.value = 'Failed to check session creation'
        }
        return false
      }
    }
  }

  async function reconcileCurrentCreateIntent(token: number): Promise<boolean> {
    const intent = currentCreateIntent.value
    if (!intent || intent.token !== token || createIntentVersion !== token) return false
    if ((intent.status === 'existing' || intent.status === 'conflict') && intent.operation) {
      try {
        const result = await sessionClient.getCreateOperation(intent.operation.operationId)
        if (result.operation) {
          upsertCreateOperations([result.operation])
          setCurrentCreateIntent(token, { operation: result.operation })
        }
        if (result.session) {
          upsertSessions([mapToUISession(result.session)])
        } else if (result.operation) {
          refreshSucceededCreateOperation(result.operation)
        }
      } catch {
        if (isCurrentCreateIntent(token)) {
          error.value = 'Failed to check session creation'
        }
      }
      return false
    }
    try {
      const result = await sessionClient.getCreateOperation(intent.requestedOperationId)
      return await applyCreateOperationResult(token, result)
    } catch {
      if (isCurrentCreateIntent(token)) {
        setCurrentCreateIntent(token, { status: 'query_error' })
        error.value = 'Failed to check session creation'
      }
      return false
    }
  }

  async function checkCreateOperation(operationId: string): Promise<void> {
    createOperationHistoryError.value = null
    try {
      const result = await sessionClient.getCreateOperation(operationId)
      if (result.operation) upsertCreateOperations([result.operation])
      if (result.session) {
        upsertSessions([mapToUISession(result.session)])
      } else if (result.operation) {
        refreshSucceededCreateOperation(result.operation)
      }
    } catch {
      createOperationHistoryError.value = 'Failed to check session creation'
    }
  }

  async function dismissCreateOperation(operationId: string): Promise<void> {
    createOperationHistoryError.value = null
    try {
      const result = await sessionClient.dismissCreateOperation(operationId)
      if (result.operation) upsertCreateOperations([result.operation])
    } catch {
      createOperationHistoryError.value = 'Failed to dismiss session creation'
    }
  }

  const loadCreateOperationHistoryPage = async (reset: boolean): Promise<void> => {
    if (
      !reset &&
      (!createOperationHistoryHasMore.value || !createOperationHistoryNextCursor.value)
    ) {
      return
    }

    const requestId = ++createOperationHistoryRequestId
    if (reset) createOperationHistoryLoading.value = true
    else createOperationHistoryLoadingMore.value = true
    createOperationHistoryError.value = null
    try {
      const result = await sessionClient.listCreateOperations({
        limit: DEFAULT_CREATE_OPERATION_PAGE_SIZE,
        cursor: reset ? null : createOperationHistoryNextCursor.value
      })
      if (requestId !== createOperationHistoryRequestId) return
      createOperationHistory.value = mergeCreateOperations(
        createOperationHistory.value,
        result.items
      )
      createOperationHistoryHasMore.value = result.hasMore
      createOperationHistoryNextCursor.value = result.nextCursor
    } catch {
      createOperationHistoryError.value = 'Failed to load session creation history'
    } finally {
      if (requestId === createOperationHistoryRequestId) {
        if (reset) createOperationHistoryLoading.value = false
        else createOperationHistoryLoadingMore.value = false
      }
    }
  }

  function loadCreateOperationHistory(): Promise<void> {
    if (createOperationHistoryFetchPromise) return createOperationHistoryFetchPromise
    const task = loadCreateOperationHistoryPage(true).finally(() => {
      if (createOperationHistoryFetchPromise === task) {
        createOperationHistoryFetchPromise = null
      }
    })
    createOperationHistoryFetchPromise = task
    return task
  }

  async function loadNextCreateOperationHistoryPage(): Promise<void> {
    if (createOperationHistoryLoadingMore.value) return
    await loadCreateOperationHistoryPage(false)
  }

  async function selectSession(sessionId: string): Promise<void> {
    error.value = null
    invalidateCurrentCreateIntent()
    const requestId = createActivationNavigationRequest()
    beginLocalActivation(requestId, sessionId)
    try {
      if (activeSessionId.value && activeSessionId.value !== sessionId) {
        messageStore.clearStreamingState()
      }
      await sessionClient.activate(sessionId)
      if (activationNavigationRequestId !== requestId) {
        return
      }
      clearActiveSessionSummary()
      syncSelectedAgentToSession(sessionId)
      setActiveSessionId(sessionId)
      if (!isCurrentActivationNavigation(requestId, sessionId)) {
        return
      }
      const outcome = await hydrateActiveSessionSummary(sessionId)
      if (!isCurrentActivationNavigation(requestId, sessionId) || outcome.sessionId !== sessionId) {
        return
      }
      applySessionRestoreOutcome(outcome)
      if (!isCurrentActivationNavigation(requestId, sessionId)) {
        return
      }
      pageRouter.goToChat(sessionId)
    } catch (selectError) {
      if (activationNavigationRequestId !== requestId) {
        return
      }
      error.value = `Failed to select session: ${selectError}`
    } finally {
      endLocalActivation(requestId, sessionId)
    }
  }

  async function closeSession(options: CloseSessionOptions = {}): Promise<void> {
    error.value = null
    invalidateCurrentCreateIntent()
    createActivationNavigationRequest()
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
    invalidateCurrentCreateIntent()

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
    createActivationNavigationRequest()
  }

  async function completeOnboardingStep(stepId: GuidedOnboardingStepId): Promise<void> {
    try {
      const state = await onboardingClient.getState()

      if (state.status !== 'active') {
        return
      }

      const step = state.steps.find((candidate) => candidate.id === stepId)

      if (!step || step.status === 'completed' || step.status === 'skipped') {
        return
      }

      const nextState = await onboardingClient.setStepStatus({
        stepId,
        status: 'completed'
      })

      if (nextState.status === 'active' && nextState.currentStepId === null) {
        await onboardingClient.complete()
      }

      const resumeIntent = readGuidedOnboardingResumeIntent()
      if (resumeIntent?.trigger === 'step-completed' && resumeIntent.stepId === stepId) {
        requestGuidedOnboardingResume('step-completed')
      }
    } catch (completionError) {
      console.warn(`[SessionStore] Failed to complete onboarding step ${stepId}:`, completionError)
    }
  }

  async function sendMessage(sessionId: string, content: string | SendMessageInput): Promise<void> {
    error.value = null
    try {
      await chatClient.sendMessage(sessionId, content)
      await completeOnboardingStep('first-chat')
    } catch (sendError) {
      error.value = `Failed to send message: ${sendError}`
      throw sendError
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
      await completeOnboardingStep('switch-model')
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

  async function moveSessionToAgent(sessionId: string, toAgentId: string): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.moveSessionToAgent(sessionId, toAgentId)
      upsertSessions([mapToUISession(updated)])
      if (activeSessionId.value === sessionId) {
        applyRestoredSession(updated)
        syncSelectedAgentToSession(sessionId)
      }
    } catch (updateError) {
      error.value = `Failed to move session: ${updateError}`
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
        if (restored) {
          applySessionRestoreOutcome(restored)
        }
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
    const pinned = sortSessions(
      sessions.value.filter(
        (session) => isRegularSession(session) && session.isPinned && !session.isDraft
      )
    )

    if (agentId === null) return pinned

    return pinned.filter((session) => session.agentId === agentId)
  }

  function getFilteredGroups(agentId: string | null): SessionGroup[] {
    const visibleSessions = sortSessions(
      sessions.value.filter(
        (session) => isRegularSession(session) && !session.isDraft && !session.isPinned
      )
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
    webContentsId: () => myWebContentsId.value,
    fetchSessions,
    refreshSessionsByIds,
    removeSessions,
    onActivated: async (sessionId) => {
      if (localActivationRequest?.sessionId === sessionId) {
        return
      }
      if (
        activeSessionId.value === sessionId &&
        pageRouter.currentRoute === 'chat' &&
        pageRouter.chatSessionId === sessionId
      ) {
        return
      }
      invalidateCurrentCreateIntent()
      const requestId = createActivationNavigationRequest()
      if (activeSessionId.value && activeSessionId.value !== sessionId) {
        messageStore.clearStreamingState()
      }
      if (activeSessionSummary.value?.id !== sessionId) {
        clearActiveSessionSummary()
      }
      syncSelectedAgentToSession(sessionId)
      setActiveSessionId(sessionId)
      const outcome = await hydrateActiveSessionSummary(sessionId)
      if (!isCurrentActivationNavigation(requestId, sessionId) || outcome.sessionId !== sessionId) {
        return
      }
      applySessionRestoreOutcome(outcome)
      if (!isCurrentActivationNavigation(requestId, sessionId)) {
        return
      }
      pageRouter.goToChat(sessionId)
      void tabClient.notifyRendererActivated(sessionId)
    },
    onDeactivated: () => {
      invalidateCurrentCreateIntent()
      createActivationNavigationRequest()
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
    availabilityBySessionId,
    activeSessionAvailability,
    missingSessionNoticeSequence,
    groupMode,
    loading,
    loadingMore,
    hasLoadedInitialPage,
    hasMore,
    currentCreateIntent,
    createOperationHistory,
    createOperationHistoryLoading,
    createOperationHistoryLoadingMore,
    createOperationHistoryHasMore,
    createOperationHistoryError,
    error,
    activeSession,
    sessionGroups,
    hasActiveSession,
    newConversationTargetAgentId,
    applyBootstrapShell,
    applyRestoredSession,
    applySessionRestoreOutcome,
    fetchSessions,
    loadNextPage,
    refreshSessionsByIds,
    createSession,
    reconcileCurrentCreateIntent,
    invalidateCurrentCreateIntent,
    checkCreateOperation,
    dismissCreateOperation,
    loadCreateOperationHistory,
    loadNextCreateOperationHistoryPage,
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
    moveSessionToAgent,
    toggleGroupMode,
    getPinnedSessions,
    getFilteredGroups
  }
})
