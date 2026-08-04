import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose, getCurrentScope } from 'vue'
import { createChatClient } from '../../../api/ChatClient'
import { createConfigClient } from '../../../api/ConfigClient'
import { createOnboardingClient } from '../../../api/OnboardingClient'
import { createSessionClient } from '../../../api/SessionClient'
import { getRuntimeWebContentsId } from '@api/runtime'
import type { ComputedRef } from 'vue'
import type { GuidedOnboardingStepId } from '@shared/contracts/routes'
import type {
  DeepChatSubagentMeta,
  SessionKind,
  SessionMetadata,
  SessionListItem,
  SessionWithState,
  CreateSessionInput,
  SendMessageInput
} from '@shared/types/agent-interface'
import {
  normalizeOrchestrationPolicy,
  type OrchestrationPolicy
} from '@shared/orchestration/policy'
import { downloadBlob } from '@/lib/download'
import {
  readGuidedOnboardingResumeIntent,
  requestGuidedOnboardingResume
} from '@/lib/onboardingResume'
import { useAgentStore } from './agent'
import { usePageRouterStore } from './pageRouter'
import { useMessageStore } from './message'
import { useAgentPlanStore } from './agentPlan'
import { useAttachmentPreparationStore } from './attachmentPreparation'
import { useLiveDelegationStore } from './liveDelegation'
import { isAbortError } from '@/lib/errors'
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
  subagentMeta: DeepChatSubagentMeta | null
  orchestrationPolicy: OrchestrationPolicy
  metadata?: SessionMetadata | null
  createdAt: number
  updatedAt: number
  revision?: number
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
export interface NewConversationProjectDirIntent {
  id: number
  projectDir: string | null
  consumed: boolean
}
export type StartNewConversationOptions = {
  refresh?: boolean
  projectDir?: string | null
}
export type CloseSessionOptions = {
  refresh?: boolean
}
type SubmissionRequestOptions = {
  submissionId?: string
  isCancellationRequested?: () => boolean
}

const SIDEBAR_GROUP_MODE_KEY = 'sidebar_group_mode'
const DEFAULT_GROUP_MODE: GroupMode = 'project'
const DEFAULT_SESSION_PAGE_SIZE = 30
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
    subagentMeta: session.subagentMeta ?? null,
    orchestrationPolicy: normalizeOrchestrationPolicy(session.orchestrationPolicy),
    ...(metadata ? { metadata } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    revision: session.revision
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

function isStaleOrSameSessionUpdate(existing: UISession, update: UISession): boolean {
  const existingRevision = existing.revision
  const updateRevision = update.revision
  const hasExistingRevision = Number.isFinite(existingRevision)
  const hasUpdateRevision = Number.isFinite(updateRevision)

  // A durable revision is authoritative. A legacy/unversioned read must never
  // replace a row that has already been ordered by a revision, even if its wall
  // clock happens to be later.
  if (hasExistingRevision || hasUpdateRevision) {
    if (!hasUpdateRevision) return true
    if (!hasExistingRevision) return false
    return updateRevision! <= existingRevision!
  }

  const existingUpdatedAt = existing.updatedAt
  const updateUpdatedAt = update.updatedAt
  // During migration, snapshots without a durable revision retain the former
  // timestamp guard until a revisioned row is observed.
  return (
    Number.isFinite(existingUpdatedAt) &&
    Number.isFinite(updateUpdatedAt) &&
    updateUpdatedAt <= existingUpdatedAt
  )
}

function mergeSessions(current: UISession[], updates: UISession[]): UISession[] {
  const next = new Map(current.map((session) => [session.id, session]))

  for (const update of updates) {
    const existing = next.get(update.id)
    if (existing && isStaleOrSameSessionUpdate(existing, update)) {
      continue
    }
    next.set(update.id, existing ? { ...existing, ...update } : update)
  }

  return sortSessions(Array.from(next.values()))
}

function cloneSessionPageCursor(
  cursor: { updatedAt: number; id: string } | null
): { updatedAt: number; id: string } | null {
  return cursor ? { updatedAt: cursor.updatedAt, id: cursor.id } : null
}

export const useSessionStore = defineStore('session', () => {
  const sessionClient = createSessionClient()
  const chatClient = createChatClient()
  const configClient = createConfigClient()
  const onboardingClient = createOnboardingClient()
  const agentStore = useAgentStore()
  const pageRouter = usePageRouterStore()
  const messageStore = useMessageStore()
  const agentPlanStore = useAgentPlanStore()
  const attachmentPreparationStore = useAttachmentPreparationStore()
  const liveDelegationStore = useLiveDelegationStore()
  const myWebContentsId = ref<number | null>(null)
  let groupModeLoadPromise: Promise<void> | null = null
  let groupModeWritePromise: Promise<void> = Promise.resolve()
  let hasLoadedGroupMode = false
  let groupModeUpdateVersion = 0
  let initialPageRequestId = 0
  let nextPageRequestId = 0
  // A list epoch protects the first-page/pagination cursor chain. Targeted updates
  // only merge individual rows, so they must not invalidate an in-flight next page.
  let sessionListEpoch = 0
  let sessionByIdsRefreshRevision = 0
  const sessionByIdRefreshRevisions = new Map<string, number>()
  let targetedSessionCommitRevision = 0
  const targetedSessionCommitRevisions = new Map<string, number>()
  const observedSessionStatuses = new Map<string, { version: number; status: UISessionStatus }>()
  // Deleted sessions must stay absent while requests started before their deletion settle.
  // IDs are stable database identifiers, so they are safe tombstones for this store lifetime.
  const removedSessionIds = new Set<string>()
  let sessionByIdsErrorRevision: number | null = null
  let activationNavigationRequestId = 0
  let newConversationProjectDirIntentId = 0
  let sessionFetchPromise: Promise<void> | null = null

  const sessions = ref<UISession[]>([])
  const bootstrapActiveSession = ref<UISession | null>(null)
  const activeSessionSummary = ref<UIActiveSessionSummary | null>(null)
  const activeSessionId = ref<string | null>(null)
  const newConversationProjectDirIntent = ref<NewConversationProjectDirIntent | null>(null)
  const groupMode = ref<GroupMode>(DEFAULT_GROUP_MODE)
  const loading = ref(false)
  const loadingMore = ref(false)
  const hasLoadedInitialPage = ref(false)
  const hasMore = ref(false)
  const nextCursor = ref<{ updatedAt: number; id: string } | null>(null)
  const error = ref<string | null>(null)
  let sessionIpcBinding: ReturnType<typeof bindSessionStoreIpc> | null = null

  void getCurrentWebContentsId()
    .then((webContentsId) => {
      myWebContentsId.value = webContentsId
      sessionIpcBinding?.flushPendingTargetedUpdate()
    })
    .catch((identityError) => {
      console.warn('[sessionStore] Failed to resolve runtime webContents id:', identityError)
    })

  const setActiveSessionId = (sessionId: string | null): void => {
    activeSessionId.value = sessionId
    messageStore.setCurrentSessionId(sessionId)
  }

  const createActivationNavigationRequest = (): number => {
    activationNavigationRequestId += 1
    return activationNavigationRequestId
  }

  const isCurrentActivationNavigation = (requestId: number, sessionId: string): boolean =>
    activationNavigationRequestId === requestId && activeSessionId.value === sessionId

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

  const mergeObservedSessionStatus = <T extends UISession>(session: T): T => {
    const observed = observedSessionStatuses.get(session.id)
    if (!observed || session.status === observed.status) {
      return session
    }

    return {
      ...session,
      status: observed.status
    }
  }

  const mapSessionSnapshot = (session: SessionListItem | SessionWithState): UISession =>
    mergeObservedSessionStatus(mapToUISession(session))

  const mapActiveSessionSnapshot = (session: SessionWithState): UIActiveSessionSummary =>
    mergeObservedSessionStatus(mapToUIActiveSessionSummary(session))

  const commitSessionSnapshot = (snapshot: SessionListItem | SessionWithState): boolean => {
    const session = mapSessionSnapshot(snapshot)
    if (removedSessionIds.has(session.id)) {
      return false
    }

    const existing = sessions.value.find((candidate) => candidate.id === session.id)
    if (existing && isStaleOrSameSessionUpdate(existing, session)) {
      return false
    }

    sessions.value = mergeSessions(sessions.value, [session])
    if (bootstrapActiveSession.value?.id === session.id) {
      bootstrapActiveSession.value = session
    }
    if (activeSessionSummary.value?.id === session.id) {
      activeSessionSummary.value =
        'providerId' in snapshot
          ? mapActiveSessionSnapshot(snapshot)
          : {
              ...session,
              providerId: activeSessionSummary.value.providerId,
              modelId: activeSessionSummary.value.modelId
            }
    }
    return true
  }

  const commitSessionSnapshots = (snapshots: Array<SessionListItem | SessionWithState>): void => {
    for (const snapshot of snapshots) {
      commitSessionSnapshot(snapshot)
    }
  }

  const replaceSessionSnapshot = (
    snapshot: UISession[],
    targetedCommitRevisionAtStart: number
  ): UISession[] => {
    const next = new Map(snapshot.map((session) => [session.id, session]))

    for (const session of sessions.value) {
      const incoming = next.get(session.id)
      if (
        (incoming && isStaleOrSameSessionUpdate(session, incoming)) ||
        (targetedSessionCommitRevisions.get(session.id) ?? 0) > targetedCommitRevisionAtStart
      ) {
        next.set(session.id, session)
      }
    }

    return sortSessions(Array.from(next.values()))
  }

  const removeSessions = (sessionIds: string[]): void => {
    const targetIds = new Set(sessionIds)
    // A dropped in-flight first page must be re-requested, or the sidebar sits
    // with no skeleton, no rows, and no error until an unrelated event fires.
    const hadPendingInitialFetch = sessionFetchPromise !== null || loading.value
    // Invalidate every in-flight list response and per-ID refresh for deleted rows.
    // This also lets their finally blocks retire loading state without changing it.
    sessionListEpoch += 1
    initialPageRequestId += 1
    nextPageRequestId += 1
    loading.value = false
    loadingMore.value = false
    // A deleted row should not keep a superseded first-page request deduplicated.
    sessionFetchPromise = null
    for (const sessionId of targetIds) {
      removedSessionIds.add(sessionId)
      observedSessionStatuses.delete(sessionId)
      sessionByIdRefreshRevisions.set(sessionId, ++sessionByIdsRefreshRevision)
    }
    sessions.value = sessions.value.filter((session) => !targetIds.has(session.id))
    for (const sessionId of targetIds) {
      agentPlanStore.purge(sessionId)
      liveDelegationStore.purge(sessionId)
      messageStore.invalidateRecentSessionView(sessionId)
      messageStore.purgeSessionTracking(sessionId)
    }

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

    if (hadPendingInitialFetch && !hasLoadedInitialPage.value) {
      void fetchSessions()
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

  const applySessionStatus = (sessionId: string, status: string, version?: number): void => {
    if (version !== undefined) {
      const observed = observedSessionStatuses.get(sessionId)
      if (observed && version < observed.version) {
        return
      }
      observedSessionStatuses.set(sessionId, {
        version,
        status: mapSessionStatus(status)
      })
    }

    messageStore.invalidateRecentSessionView(sessionId)
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

  const applyConfirmedOrchestrationPolicy = (
    sessionId: string,
    policy: OrchestrationPolicy
  ): void => {
    const orchestrationPolicy = normalizeOrchestrationPolicy(policy)
    sessions.value = sessions.value.map((session) =>
      session.id === sessionId ? { ...session, orchestrationPolicy } : session
    )
    if (bootstrapActiveSession.value?.id === sessionId) {
      bootstrapActiveSession.value = {
        ...bootstrapActiveSession.value,
        orchestrationPolicy
      }
    }
    if (activeSessionSummary.value?.id === sessionId) {
      activeSessionSummary.value = {
        ...activeSessionSummary.value,
        orchestrationPolicy
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

    const committed = commitSessionSnapshot(session)
    if (activeSessionId.value !== session.id) return

    const canonical = sessions.value.find((candidate) => candidate.id === session.id)
    const incoming = mapSessionSnapshot(session)
    const isSameDurableSnapshot =
      canonical &&
      ((Number.isFinite(canonical.revision) && canonical.revision === incoming.revision) ||
        (!Number.isFinite(canonical.revision) && canonical.updatedAt === incoming.updatedAt))
    if (!canonical || (!committed && !isSameDurableSnapshot)) {
      return
    }

    // A same-revision full hydrate may enrich only runtime provider/model data. Its
    // durable fields always come from the canonical committed row, so a late read
    // cannot split the active shell from the sidebar.
    activeSessionSummary.value = {
      ...canonical,
      // Session execution state is runtime-only and can be refreshed without a
      // durable row mutation. Preserve it (with the observed event guard) while
      // keeping every durable projection on the canonical list row.
      status: mapActiveSessionSnapshot(session).status,
      providerId: session.providerId,
      modelId: session.modelId
    }
    bootstrapActiveSession.value = canonical
    syncSelectedAgentToSession(session.id)
  }

  const hydrateActiveSessionSummary = async (
    sessionId: string,
    activationRequestId: number
  ): Promise<void> => {
    try {
      const active = await sessionClient.getActive()
      if (
        isCurrentActivationNavigation(activationRequestId, sessionId) &&
        active.session?.id === sessionId
      ) {
        applyRestoredSession(active.session)
      }
    } catch (restoreError) {
      console.warn('[sessionStore] Failed to hydrate selected session:', restoreError)
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
    // A repeated bootstrap shell for the same selected session must not discard
    // an already hydrated runtime summary before its durable revision guard runs.
    if (activeSessionSummary.value?.id !== nextActiveSessionId) {
      clearActiveSessionSummary()
    }

    if (input.activeSession?.id === nextActiveSessionId) {
      commitSessionSnapshot(input.activeSession)
      // Startup shell data is only a hint. Prefer the canonical list row after
      // its revision guard so a delayed bootstrap response cannot move any of
      // the three active-session projections back in time.
      bootstrapActiveSession.value =
        sessions.value.find((session) => session.id === nextActiveSessionId) ?? null
    } else {
      bootstrapActiveSession.value = null
    }

    syncSelectedAgentToSession(nextActiveSessionId)
  }

  const loadSessionPage = async (options: {
    reset: boolean
    preserveExisting?: boolean
    prioritizeSessionId?: string | null
  }): Promise<void> => {
    if (options.reset) {
      const requestId = ++initialPageRequestId
      const listEpoch = ++sessionListEpoch
      const targetedCommitRevisionAtStart = targetedSessionCommitRevision
      loadingMore.value = false
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

        if (requestId !== initialPageRequestId || listEpoch !== sessionListEpoch) {
          return
        }

        // Commit incoming entity snapshots before the first-page replacement so an
        // active shell receives the same authoritative revision as the sidebar.
        commitSessionSnapshots(result.items)
        const nextSessions = result.items
          .map(mapSessionSnapshot)
          .filter((session) => !removedSessionIds.has(session.id))
        sessions.value = options.preserveExisting
          ? mergeSessions(sessions.value, nextSessions)
          : replaceSessionSnapshot(nextSessions, targetedCommitRevisionAtStart)
        hasLoadedInitialPage.value = true
        hasMore.value = result.hasMore
        nextCursor.value = result.nextCursor
        syncSelectedAgentToSession(activeSessionId.value)
      } catch (loadError) {
        if (requestId === initialPageRequestId && listEpoch === sessionListEpoch) {
          error.value = `Failed to load sessions: ${loadError}`
        }
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
    const listEpoch = sessionListEpoch
    loadingMore.value = true
    error.value = null

    try {
      const result = await sessionClient.listLightweight({
        limit: DEFAULT_SESSION_PAGE_SIZE,
        cursor: cloneSessionPageCursor(nextCursor.value),
        // 与首屏一致：仅分页 regular 会话，避免子代理会话占用页槽。
        includeSubagents: false
      })

      if (requestId !== nextPageRequestId || listEpoch !== sessionListEpoch) {
        return
      }

      commitSessionSnapshots(result.items)
      hasMore.value = result.hasMore
      nextCursor.value = result.nextCursor
      console.info(
        `[Startup][Renderer] startup.session.page.appended count=${result.items.length} total=${sessions.value.length}`
      )
    } catch (loadError) {
      if (requestId === nextPageRequestId && listEpoch === sessionListEpoch) {
        error.value = `Failed to load more sessions: ${loadError}`
      }
    } finally {
      if (requestId === nextPageRequestId && listEpoch === sessionListEpoch) {
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

    const refreshRevision = ++sessionByIdsRefreshRevision
    const requestedRevisions = new Map<string, number>()
    for (const sessionId of normalizedIds) {
      sessionByIdRefreshRevisions.set(sessionId, refreshRevision)
      requestedRevisions.set(sessionId, refreshRevision)
      messageStore.invalidateRecentSessionView(sessionId)
    }
    const listEpoch = sessionListEpoch
    const hasCurrentRequestedId = (): boolean =>
      listEpoch === sessionListEpoch &&
      normalizedIds.some(
        (sessionId) =>
          sessionByIdRefreshRevisions.get(sessionId) === requestedRevisions.get(sessionId)
      )

    try {
      const items = await sessionClient.getLightweightByIds(normalizedIds)
      if (listEpoch !== sessionListEpoch) {
        return
      }

      // A newer request for the same ID wins, but disjoint IDs from concurrent
      // targeted refreshes may safely merge independently.
      const acceptedItems = items.filter(
        (item) =>
          requestedRevisions.has(item.id) &&
          sessionByIdRefreshRevisions.get(item.id) === requestedRevisions.get(item.id)
      )
      if (!hasCurrentRequestedId()) {
        return
      }

      const acceptedSessions = acceptedItems
        .map(mapSessionSnapshot)
        .filter((session) => !removedSessionIds.has(session.id))
      commitSessionSnapshots(acceptedItems)
      if (acceptedSessions.length > 0) {
        const commitRevision = ++targetedSessionCommitRevision
        for (const session of acceptedSessions) {
          targetedSessionCommitRevisions.set(session.id, commitRevision)
        }
      }

      // This background refresh may only clear an error it owns; first-page and
      // pagination errors remain visible until their own request resolves.
      if (
        sessionByIdsErrorRevision !== null &&
        sessionByIdsErrorRevision <= refreshRevision &&
        error.value?.startsWith('Failed to refresh sessions:')
      ) {
        error.value = null
        sessionByIdsErrorRevision = null
      }

      const activeId = activeSessionId.value
      if (activeId && acceptedItems.some((item) => item.id === activeId)) {
        syncSelectedAgentToSession(activeId)
      }
    } catch (refreshError) {
      if (hasCurrentRequestedId()) {
        const canReplaceError =
          error.value === null ||
          (sessionByIdsErrorRevision !== null &&
            sessionByIdsErrorRevision <= refreshRevision &&
            error.value.startsWith('Failed to refresh sessions:'))
        if (canReplaceError) {
          error.value = `Failed to refresh sessions: ${refreshError}`
          sessionByIdsErrorRevision = refreshRevision
        }
      }
    }
  }

  async function createSession(input: CreateSessionInput, options?: SubmissionRequestOptions) {
    error.value = null
    const requestId = createActivationNavigationRequest()
    try {
      const result = options?.submissionId
        ? await sessionClient.create(input, { submissionId: options.submissionId })
        : await sessionClient.create(input)
      const session = result.session
      const hasInitialTurn = input.message.trim().length > 0 || (input.files?.length ?? 0) > 0
      const attachmentPreparation = result.initialTurn?.attachmentPreparation
      const initialTurnNeedsUserAction = attachmentPreparation?.status === 'needs_user_action'
      const hasAcceptedInitialTurn = hasInitialTurn && !initialTurnNeedsUserAction
      if (initialTurnNeedsUserAction) {
        attachmentPreparationStore.stageInitialDraftRecovery({
          sessionId: session.id,
          input: {
            text: input.message,
            ...(input.files ? { files: input.files } : {}),
            ...(input.activeSkills ? { activeSkills: input.activeSkills } : {}),
            ...(input.inlineItems ? { inlineItems: input.inlineItems } : {})
          },
          summary: attachmentPreparation
        })
      }
      // Creation is durable even if the user has navigated elsewhere while it was pending.
      commitSessionSnapshot(session)
      if (activationNavigationRequestId !== requestId) {
        return result
      }

      setActiveSessionId(session.id)
      applyRestoredSession(session)
      if (hasAcceptedInitialTurn) {
        applySessionStatus(session.id, 'generating')
      }
      syncSelectedAgentToSession(session.id)
      pageRouter.goToChat(session.id)
      if (hasAcceptedInitialTurn) {
        await completeOnboardingStep('first-chat')
      }
      return result
    } catch (createError) {
      if (
        activationNavigationRequestId === requestId &&
        !(options?.isCancellationRequested?.() && isAbortError(createError))
      ) {
        error.value = `Failed to create session: ${createError}`
      }
      throw createError
    }
  }

  async function selectSession(sessionId: string): Promise<void> {
    error.value = null
    const requestId = createActivationNavigationRequest()
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
      await hydrateActiveSessionSummary(sessionId, requestId)
      if (!isCurrentActivationNavigation(requestId, sessionId)) {
        return
      }
      pageRouter.goToChat(sessionId)
    } catch (selectError) {
      if (activationNavigationRequestId === requestId) {
        error.value = `Failed to select session: ${selectError}`
      }
    }
  }

  async function closeSession(options: CloseSessionOptions = {}): Promise<void> {
    error.value = null
    const requestId = createActivationNavigationRequest()
    try {
      messageStore.clearStreamingState()
      await sessionClient.deactivate()
      if (activationNavigationRequestId !== requestId) {
        return
      }
      clearActiveSessionSummary()
      setActiveSessionId(null)
      pageRouter.goToNewThread(options.refresh ? { refresh: true } : {})
    } catch (closeError) {
      if (activationNavigationRequestId === requestId) {
        error.value = `Failed to close session: ${closeError}`
      }
    }
  }

  async function startNewConversation(options: StartNewConversationOptions = {}): Promise<void> {
    error.value = null

    const targetAgentId = newConversationTargetAgentId.value
    if (!targetAgentId) {
      return
    }

    newConversationProjectDirIntent.value = Object.prototype.hasOwnProperty.call(
      options,
      'projectDir'
    )
      ? {
          id: ++newConversationProjectDirIntentId,
          projectDir: options.projectDir?.trim() || null,
          consumed: false
        }
      : null

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

  function consumeNewConversationProjectDirIntent(intentId: number): void {
    const intent = newConversationProjectDirIntent.value
    if (!intent || intent.id !== intentId || intent.consumed) {
      return
    }

    newConversationProjectDirIntent.value = { ...intent, consumed: true }
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

  async function sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: SubmissionRequestOptions
  ): Promise<void> {
    error.value = null
    const previousStatus =
      sessions.value.find((session) => session.id === sessionId)?.status ??
      (activeSessionSummary.value?.id === sessionId ? activeSessionSummary.value.status : 'none')
    applySessionStatus(sessionId, 'generating')
    try {
      if (options?.submissionId) {
        await chatClient.sendMessage(sessionId, content, { submissionId: options.submissionId })
      } else {
        await chatClient.sendMessage(sessionId, content)
      }
      await completeOnboardingStep('first-chat')
    } catch (sendError) {
      if (options?.isCancellationRequested?.() && isAbortError(sendError)) {
        applySessionStatus(sessionId, previousStatus)
      } else {
        applySessionStatus(sessionId, 'error')
        error.value = `Failed to send message: ${sendError}`
      }
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
      commitSessionSnapshot(updated)
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

  async function setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.setSessionProjectDir(sessionId, projectDir)
      commitSessionSnapshot(updated)
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
      commitSessionSnapshot(updated)
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
      const updated = await sessionClient.renameSession(sessionId, normalized)
      commitSessionSnapshot(updated)
    } catch (renameError) {
      error.value = `Failed to rename session: ${renameError}`
      throw renameError
    }
  }

  async function toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.toggleSessionPinned(sessionId, pinned)
      commitSessionSnapshot(updated)
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
    return sortSessions(
      sessions.value.filter(
        (session) =>
          isRegularSession(session) &&
          session.isPinned &&
          !session.isDraft &&
          (agentId === null || session.agentId === agentId)
      )
    )
  }

  function getFilteredGroups(agentId: string | null): SessionGroup[] {
    const visibleSessions = sortSessions(
      sessions.value.filter(
        (session) =>
          isRegularSession(session) &&
          !session.isDraft &&
          !session.isPinned &&
          (agentId === null || session.agentId === agentId)
      )
    )

    return groupMode.value === 'time'
      ? groupByTime(visibleSessions)
      : groupByProject(visibleSessions)
  }

  sessionIpcBinding = bindSessionStoreIpc({
    webContentsId: () => myWebContentsId.value,
    fetchSessions,
    refreshSessionsByIds,
    removeSessions,
    onActivated: async (sessionId) => {
      const requestId = createActivationNavigationRequest()
      if (activeSessionId.value && activeSessionId.value !== sessionId) {
        messageStore.clearStreamingState()
      }
      if (activeSessionSummary.value?.id !== sessionId) {
        clearActiveSessionSummary()
      }
      syncSelectedAgentToSession(sessionId)
      setActiveSessionId(sessionId)
      await hydrateActiveSessionSummary(sessionId, requestId)
      if (!isCurrentActivationNavigation(requestId, sessionId)) {
        return
      }
      pageRouter.goToChat(sessionId)
    },
    onDeactivated: () => {
      createActivationNavigationRequest()
      messageStore.clearStreamingState()
      clearActiveSessionSummary()
      setActiveSessionId(null)
      pageRouter.goToNewThread()
    },
    onStatusChanged: (sessionId, status, version) => {
      applySessionStatus(sessionId, status, version)
    }
  })
  registerStoreCleanup(sessionIpcBinding.cleanup)
  void ensureGroupModeLoaded()

  return {
    sessions,
    activeSessionId,
    newConversationProjectDirIntent,
    groupMode,
    loading,
    loadingMore,
    hasLoadedInitialPage,
    hasMore,
    nextCursor,
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
    applyConfirmedOrchestrationPolicy,
    selectSession,
    closeSession,
    startNewConversation,
    consumeNewConversationProjectDirIntent,
    renameSession,
    toggleSessionPinned,
    clearSessionMessages,
    exportSession,
    deleteSession,
    setSessionProjectDir,
    moveSessionToAgent,
    toggleGroupMode,
    getPinnedSessions,
    getFilteredGroups
  }
})
