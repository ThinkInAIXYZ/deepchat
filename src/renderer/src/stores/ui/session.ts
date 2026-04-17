import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose, getCurrentScope } from 'vue'
import type { ComputedRef } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type {
  DeepChatSubagentMeta,
  SessionWithState,
  SessionKind,
  CreateSessionInput,
  SendMessageInput
} from '@shared/types/agent-interface'
import { downloadBlob } from '@/lib/download'
import { useAgentStore } from './agent'
import { usePageRouterStore } from './pageRouter'
import { useMessageStore } from './message'
import { bindSessionStoreIpc } from './sessionIpc'
import { getRendererWindowContext } from '@/lib/windowContext'

// --- Type Definitions ---

export type UISessionStatus = 'completed' | 'working' | 'error' | 'none'

export interface UISession {
  id: string
  title: string
  agentId: string
  status: UISessionStatus
  projectDir: string
  providerId: string
  modelId: string
  isPinned: boolean
  isDraft: boolean
  sessionKind: SessionKind
  parentSessionId: string | null
  subagentEnabled: boolean
  subagentMeta: DeepChatSubagentMeta | null
  createdAt: number
  updatedAt: number
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

// --- Helper Functions ---

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

function mapToUISession(session: SessionWithState): UISession {
  return {
    id: session.id,
    title: session.title,
    agentId: session.agentId,
    status: mapSessionStatus(session.status),
    projectDir: session.projectDir ?? '',
    providerId: session.providerId,
    modelId: session.modelId,
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

function isRegularSession(session: Pick<UISession, 'sessionKind'>): boolean {
  return (session.sessionKind ?? 'regular') === 'regular'
}

function getCurrentWebContentsId(): number {
  return getRendererWindowContext().webContentsId ?? -1
}

function registerStoreCleanup(cleanup: () => void): void {
  if (getCurrentScope()) {
    onScopeDispose(cleanup)
  }
}

function startOfDay(timestamp: number): number {
  const d = new Date(timestamp)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
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

  for (const s of sessions) {
    if (s.updatedAt >= today) groups['common.time.today'].push(s)
    else if (s.updatedAt >= yesterday) groups['common.time.yesterday'].push(s)
    else if (s.updatedAt >= lastWeek) groups['common.time.lastWeek'].push(s)
    else groups['common.time.older'].push(s)
  }

  return Object.entries(groups)
    .filter(([, sessions]) => sessions.length > 0)
    .map(([labelKey, sessions]) => ({ id: labelKey, label: labelKey, labelKey, sessions }))
}

const NO_PROJECT_GROUP_ID = '__no_project__'

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
    if (!projectMap.has(projectGroupId)) projectMap.set(projectGroupId, [])
    projectMap.get(projectGroupId)!.push(session)
  }
  return Array.from(projectMap.entries()).map(([projectGroupId, sessions]) => ({
    id: projectGroupId,
    ...getProjectGroupLabel(projectGroupId),
    sessions
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

// --- Store ---

export const useSessionStore = defineStore('session', () => {
  const agentSessionPresenter = usePresenter('agentSessionPresenter')
  const tabPresenter = usePresenter('tabPresenter')
  const configPresenter = usePresenter('configPresenter', { safeCall: false })
  const agentStore = useAgentStore()
  const pageRouter = usePageRouterStore()
  const messageStore = useMessageStore()
  const myWebContentsId = getCurrentWebContentsId()
  let rendererReadyNotified = false
  let groupModeLoadPromise: Promise<void> | null = null
  let groupModeWritePromise: Promise<void> = Promise.resolve()
  let hasLoadedGroupMode = false
  let groupModeUpdateVersion = 0

  // --- State ---
  const sessions = ref<UISession[]>([])
  const activeSessionId = ref<string | null>(null)
  const groupMode = ref<GroupMode>(DEFAULT_GROUP_MODE)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const notifyRendererReady = (): void => {
    if (rendererReadyNotified) return
    rendererReadyNotified = true
    void tabPresenter.onRendererTabReady(myWebContentsId)
  }

  notifyRendererReady()

  const normalizeGroupMode = (value: unknown): GroupMode =>
    value === 'time' || value === 'project' ? value : DEFAULT_GROUP_MODE

  const loadGroupModePreference = async (): Promise<void> => {
    const loadVersion = groupModeUpdateVersion

    try {
      const savedGroupMode = await configPresenter.getSetting<GroupMode>(SIDEBAR_GROUP_MODE_KEY)
      if (groupModeUpdateVersion === loadVersion) {
        groupMode.value = normalizeGroupMode(savedGroupMode)
      }
    } catch (error) {
      if (groupModeUpdateVersion === loadVersion) {
        groupMode.value = DEFAULT_GROUP_MODE
      }
      console.warn('[sessionStore] Failed to load sidebar group mode:', error)
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

  // --- Getters ---
  const activeSession: ComputedRef<UISession | undefined> = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value)
  )

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

    const targetSession = availableSessions.find((session) => session.id === sessionId)
    const targetAgentId = targetSession?.agentId?.trim()
    if (!targetAgentId || agentStore.selectedAgentId === targetAgentId) {
      return
    }

    agentStore.setSelectedAgent(targetAgentId)
  }

  // --- Actions ---

  async function fetchSessions(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await ensureGroupModeLoaded()
      const webContentsId = getCurrentWebContentsId()
      const previousActiveSessionId = activeSessionId.value
      const [result, activeSession] = await Promise.all([
        agentSessionPresenter.getSessionList({ includeSubagents: true }),
        agentSessionPresenter.getActiveSession(webContentsId)
      ])
      sessions.value = result.map(mapToUISession)

      const nextActiveSessionId = activeSession?.id ?? null
      if (previousActiveSessionId !== nextActiveSessionId) {
        if (previousActiveSessionId && previousActiveSessionId !== nextActiveSessionId) {
          messageStore.clearStreamingState()
        }
        activeSessionId.value = nextActiveSessionId
      }
      syncSelectedAgentToSession(nextActiveSessionId, sessions.value)
      if (previousActiveSessionId && !nextActiveSessionId && pageRouter.currentRoute === 'chat') {
        pageRouter.goToNewThread()
      }
    } catch (e) {
      error.value = `Failed to load sessions: ${e}`
    } finally {
      loading.value = false
    }
  }

  async function createSession(input: CreateSessionInput): Promise<void> {
    error.value = null
    try {
      const webContentsId = getCurrentWebContentsId()
      const session = await agentSessionPresenter.createSession(input, webContentsId)
      activeSessionId.value = session.id

      await fetchSessions()
      pageRouter.goToChat(session.id)
    } catch (e) {
      error.value = `Failed to create session: ${e}`
    }
  }

  async function selectSession(sessionId: string): Promise<void> {
    error.value = null
    try {
      if (activeSessionId.value && activeSessionId.value !== sessionId) {
        messageStore.clearStreamingState()
      }
      const webContentsId = getCurrentWebContentsId()
      await agentSessionPresenter.activateSession(webContentsId, sessionId)
      syncSelectedAgentToSession(sessionId)
      activeSessionId.value = sessionId
      pageRouter.goToChat(sessionId)
    } catch (e) {
      error.value = `Failed to select session: ${e}`
    }
  }

  async function closeSession(options: CloseSessionOptions = {}): Promise<void> {
    error.value = null
    try {
      messageStore.clearStreamingState()
      const webContentsId = getCurrentWebContentsId()
      await agentSessionPresenter.deactivateSession(webContentsId)
      activeSessionId.value = null
      pageRouter.goToNewThread(options.refresh ? { refresh: true } : {})
    } catch (e) {
      error.value = `Failed to close session: ${e}`
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
      await agentSessionPresenter.sendMessage(sessionId, content)
    } catch (e) {
      error.value = `Failed to send message: ${e}`
    }
  }

  async function setSessionModel(
    sessionId: string,
    providerId: string,
    modelId: string
  ): Promise<void> {
    error.value = null
    try {
      const updated = await agentSessionPresenter.setSessionModel(sessionId, providerId, modelId)
      const index = sessions.value.findIndex((item) => item.id === sessionId)
      if (index >= 0) {
        sessions.value[index] = mapToUISession(updated)
      }
    } catch (e) {
      error.value = `Failed to set session model: ${e}`
      throw e
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    error.value = null
    try {
      await agentSessionPresenter.deleteSession(sessionId)
      if (activeSessionId.value === sessionId) {
        activeSessionId.value = null
        pageRouter.goToNewThread()
      }
      await fetchSessions()
    } catch (e) {
      error.value = `Failed to delete session: ${e}`
    }
  }

  async function setSessionSubagentEnabled(sessionId: string, enabled: boolean): Promise<void> {
    error.value = null
    try {
      const updated = await agentSessionPresenter.setSessionSubagentEnabled(sessionId, enabled)
      const index = sessions.value.findIndex((item) => item.id === sessionId)
      if (index >= 0) {
        sessions.value[index] = mapToUISession(updated)
      } else {
        sessions.value.push(mapToUISession(updated))
      }
    } catch (e) {
      error.value = `Failed to update subagent state: ${e}`
      throw e
    }
  }

  async function setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    error.value = null
    try {
      const updated = await agentSessionPresenter.setSessionProjectDir(sessionId, projectDir)
      const index = sessions.value.findIndex((item) => item.id === sessionId)
      if (index >= 0) {
        sessions.value[index] = mapToUISession(updated)
      }
    } catch (e) {
      error.value = `Failed to set session project directory: ${e}`
      throw e
    }
  }

  async function renameSession(sessionId: string, title: string): Promise<void> {
    error.value = null
    try {
      const normalized = title.trim()
      if (!normalized) {
        return
      }
      await agentSessionPresenter.renameSession(sessionId, normalized)
      const target = sessions.value.find((session) => session.id === sessionId)
      if (target) {
        target.title = normalized
      }
    } catch (e) {
      error.value = `Failed to rename session: ${e}`
      throw e
    }
  }

  async function toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    error.value = null
    try {
      await agentSessionPresenter.toggleSessionPinned(sessionId, pinned)
      const target = sessions.value.find((session) => session.id === sessionId)
      if (target) {
        target.isPinned = pinned
      }
    } catch (e) {
      error.value = `Failed to toggle pinned state: ${e}`
      throw e
    }
  }

  async function clearSessionMessages(sessionId: string): Promise<void> {
    error.value = null
    try {
      await agentSessionPresenter.clearSessionMessages(sessionId)
      if (activeSessionId.value === sessionId) {
        messageStore.clearStreamingState()
        await messageStore.loadMessages(sessionId)
      }
    } catch (e) {
      error.value = `Failed to clear session messages: ${e}`
      throw e
    }
  }

  async function exportSession(
    sessionId: string,
    format: 'markdown' | 'html' | 'txt' | 'nowledge-mem'
  ): Promise<{ filename: string; content: string }> {
    error.value = null
    try {
      const result = await agentSessionPresenter.exportSession(sessionId, format)
      const blob = new Blob([result.content], {
        type: getContentType(format)
      })
      downloadBlob(blob, result.filename)
      return result
    } catch (e) {
      error.value = `Failed to export session: ${e}`
      throw e
    }
  }

  async function toggleGroupMode(): Promise<void> {
    const previousMode = groupMode.value
    groupMode.value = previousMode === 'time' ? 'project' : 'time'
    const localVersion = ++groupModeUpdateVersion

    groupModeWritePromise = groupModeWritePromise.then(async () => {
      try {
        await configPresenter.setSetting(SIDEBAR_GROUP_MODE_KEY, groupMode.value)
        if (localVersion !== groupModeUpdateVersion) {
          return
        }
      } catch (error) {
        if (localVersion === groupModeUpdateVersion) {
          groupMode.value = previousMode
        }
        console.warn('[sessionStore] Failed to persist sidebar group mode:', error)
      }
    })

    await groupModeWritePromise
  }

  function getPinnedSessions(agentId: string | null): UISession[] {
    const pinned = sessions.value
      .filter((session) => isRegularSession(session) && session.isPinned && !session.isDraft)
      .sort((a, b) => b.updatedAt - a.updatedAt)

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
        sessions: group.sessions.filter((s) => s.agentId === agentId)
      }))
      .filter((group) => group.sessions.length > 0)
  }

  const cleanupIpcBindings = bindSessionStoreIpc({
    webContentsId: myWebContentsId,
    fetchSessions,
    onActivated: (sessionId) => {
      if (activeSessionId.value && activeSessionId.value !== sessionId) {
        messageStore.clearStreamingState()
      }
      syncSelectedAgentToSession(sessionId)
      activeSessionId.value = sessionId
      pageRouter.goToChat(sessionId)
      void tabPresenter.onRendererTabActivated(sessionId)
    },
    onDeactivated: () => {
      messageStore.clearStreamingState()
      activeSessionId.value = null
      pageRouter.goToNewThread()
    },
    onStatusChanged: (payload) => {
      const session = sessions.value.find((item) => item.id === payload.sessionId)
      if (session) {
        session.status = mapSessionStatus(payload.status)
      }
    }
  })
  registerStoreCleanup(cleanupIpcBindings)
  void ensureGroupModeLoaded()

  return {
    sessions,
    activeSessionId,
    groupMode,
    loading,
    error,
    activeSession,
    sessionGroups,
    hasActiveSession,
    newConversationTargetAgentId,
    fetchSessions,
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
