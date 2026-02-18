import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ComputedRef } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { CONVERSATION_EVENTS } from '@/events'
import type {
  Session,
  SessionStatus,
  SessionConfig
} from '@shared/types/presenters/session.presenter'
import { usePageRouterStore } from './pageRouter'

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
  createdAt: number
  updatedAt: number
}

export interface SessionGroup {
  label: string
  sessions: UISession[]
}

export type GroupMode = 'time' | 'project'

export interface CreateSessionInput {
  title: string
  message: string
  projectDir?: string
  providerId?: string
  modelId?: string
  agentId?: string
  reasoningEffort?: string
}

// --- Helper Functions ---

function resolveAgentId(session: Session): string {
  if (session.config.chatMode === 'acp agent') {
    const acpMap = session.context.acpWorkdirMap
    if (acpMap) {
      const agentIds = Object.keys(acpMap)
      if (agentIds.length > 0) return agentIds[0]
    }
  }
  return 'deepchat'
}

function mapSessionStatus(status: SessionStatus): UISessionStatus {
  switch (status) {
    case 'generating':
    case 'waiting_permission':
    case 'waiting_question':
      return 'working'
    case 'error':
      return 'error'
    case 'idle':
    case 'paused':
      return 'none'
    default:
      return 'none'
  }
}

function mapToUISession(session: Session): UISession {
  return {
    id: session.sessionId,
    title: session.config.title,
    agentId: resolveAgentId(session),
    status: mapSessionStatus(session.status),
    projectDir: session.context.agentWorkspacePath ?? '',
    providerId: session.config.providerId,
    modelId: session.config.modelId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
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
    Today: [],
    Yesterday: [],
    'Last Week': [],
    Older: []
  }

  for (const s of sessions) {
    if (s.updatedAt >= today) groups['Today'].push(s)
    else if (s.updatedAt >= yesterday) groups['Yesterday'].push(s)
    else if (s.updatedAt >= lastWeek) groups['Last Week'].push(s)
    else groups['Older'].push(s)
  }

  return Object.entries(groups)
    .filter(([, sessions]) => sessions.length > 0)
    .map(([label, sessions]) => ({ label, sessions }))
}

function groupByProject(sessions: UISession[]): SessionGroup[] {
  const projectMap = new Map<string, UISession[]>()
  for (const session of sessions) {
    const dir = session.projectDir || 'No Project'
    if (!projectMap.has(dir)) projectMap.set(dir, [])
    projectMap.get(dir)!.push(session)
  }
  return Array.from(projectMap.entries()).map(([dir, sessions]) => ({
    label: dir.split('/').pop() ?? dir,
    sessions
  }))
}

// --- Store ---

export const useSessionStore = defineStore('session', () => {
  const sessionPresenter = usePresenter('sessionPresenter')
  const agentPresenter = usePresenter('agentPresenter')
  const pageRouter = usePageRouterStore()

  // --- State ---
  const sessions = ref<UISession[]>([])
  const activeSessionId = ref<string | null>(null)
  const groupMode = ref<GroupMode>('time')
  const loading = ref(false)
  const error = ref<string | null>(null)

  // --- Getters ---
  const activeSession: ComputedRef<UISession | undefined> = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value)
  )

  const hasActiveSession: ComputedRef<boolean> = computed(() => activeSessionId.value !== null)

  const sessionGroups: ComputedRef<SessionGroup[]> = computed(() => getFilteredGroups(null))

  // --- Actions ---

  async function fetchSessions(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await sessionPresenter.getSessionList(1, 200)
      sessions.value = result.sessions.map(mapToUISession)
    } catch (e) {
      error.value = `Failed to load sessions: ${e}`
    } finally {
      loading.value = false
    }
  }

  async function createSession(params: CreateSessionInput): Promise<void> {
    error.value = null
    try {
      const tabId = window.api.getWebContentsId()
      const settings: Partial<SessionConfig> = {}

      if (params.providerId) settings.providerId = params.providerId
      if (params.modelId) settings.modelId = params.modelId
      if (params.projectDir) settings.agentWorkspacePath = params.projectDir
      if (params.reasoningEffort) {
        settings.reasoningEffort = params.reasoningEffort as SessionConfig['reasoningEffort']
      }

      // Determine chat mode from agent
      if (params.agentId && params.agentId !== 'deepchat') {
        settings.chatMode = 'acp agent'
        settings.acpWorkdirMap = { [params.agentId]: params.projectDir ?? null }
      }

      // Force new session to prevent reusing an empty conversation
      // with different settings (e.g. switching from DeepChat to ACP agent)
      const sessionId = await sessionPresenter.createSession({
        title: params.title || 'New Thread',
        settings,
        tabId,
        options: { forceNewAndActivate: true }
      })

      // Refresh session list and activate
      await fetchSessions()
      activeSessionId.value = sessionId
      pageRouter.goToChat(sessionId)

      // Send the initial message (content must be JSON-encoded UserMessageContent)
      const messageContent = JSON.stringify({
        text: params.message,
        files: [],
        links: [],
        search: false,
        think: false
      })
      await agentPresenter.sendMessage(sessionId, messageContent, tabId)
    } catch (e) {
      error.value = `Failed to create session: ${e}`
    }
  }

  async function selectSession(sessionId: string): Promise<void> {
    error.value = null
    try {
      const tabId = window.api.getWebContentsId()
      await sessionPresenter.activateSession(tabId, sessionId)
      activeSessionId.value = sessionId
      pageRouter.goToChat(sessionId)
    } catch (e) {
      error.value = `Failed to select session: ${e}`
    }
  }

  async function closeSession(): Promise<void> {
    error.value = null
    try {
      const tabId = window.api.getWebContentsId()
      await sessionPresenter.unbindFromTab(tabId)
      activeSessionId.value = null
      pageRouter.goToNewThread()
    } catch (e) {
      error.value = `Failed to close session: ${e}`
    }
  }

  function toggleGroupMode(): void {
    groupMode.value = groupMode.value === 'time' ? 'project' : 'time'
  }

  function getFilteredGroups(agentId: string | null): SessionGroup[] {
    const grouped =
      groupMode.value === 'time' ? groupByTime(sessions.value) : groupByProject(sessions.value)

    if (agentId === null) return grouped

    return grouped
      .map((group) => ({
        label: group.label,
        sessions: group.sessions.filter((s) => s.agentId === agentId)
      }))
      .filter((group) => group.sessions.length > 0)
  }

  // --- Event Listeners ---

  window.electron.ipcRenderer.on(CONVERSATION_EVENTS.LIST_UPDATED, () => {
    fetchSessions()
  })

  window.electron.ipcRenderer.on(
    CONVERSATION_EVENTS.ACTIVATED,
    (_: unknown, msg: { tabId: number; conversationId: string }) => {
      const tabId = window.api.getWebContentsId()
      if (msg.tabId === tabId) {
        activeSessionId.value = msg.conversationId
      }
    }
  )

  window.electron.ipcRenderer.on(
    CONVERSATION_EVENTS.DEACTIVATED,
    (_: unknown, msg: { tabId: number }) => {
      const tabId = window.api.getWebContentsId()
      if (msg.tabId === tabId) {
        activeSessionId.value = null
        pageRouter.goToNewThread()
      }
    }
  )

  return {
    sessions,
    activeSessionId,
    groupMode,
    loading,
    error,
    activeSession,
    sessionGroups,
    hasActiveSession,
    fetchSessions,
    createSession,
    selectSession,
    closeSession,
    toggleGroupMode,
    getFilteredGroups
  }
})
