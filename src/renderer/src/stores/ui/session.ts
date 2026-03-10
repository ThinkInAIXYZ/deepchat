import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ComputedRef } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { SESSION_EVENTS } from '@/events'
import type {
  SessionWithState,
  CreateSessionInput,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { MessageFile } from '@shared/chat'
import { downloadBlob } from '@/lib/download'
import { usePageRouterStore } from './pageRouter'
import { useMessageStore } from './message'

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
  createdAt: number
  updatedAt: number
}

export interface SessionGroup {
  label: string
  labelKey?: string
  sessions: UISession[]
}

export type GroupMode = 'time' | 'project'

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
    .map(([labelKey, sessions]) => ({ label: labelKey, labelKey, sessions }))
}

function groupByProject(sessions: UISession[]): SessionGroup[] {
  const projectMap = new Map<string, UISession[]>()
  for (const session of sessions) {
    const dir = session.projectDir.trim() || '__no_project__'
    if (!projectMap.has(dir)) projectMap.set(dir, [])
    projectMap.get(dir)!.push(session)
  }
  return Array.from(projectMap.entries()).map(([dir, sessions]) => ({
    label: dir === '__no_project__' ? 'common.project.none' : (dir.split('/').pop() ?? dir),
    labelKey: dir === '__no_project__' ? 'common.project.none' : undefined,
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
  const newAgentPresenter = usePresenter('newAgentPresenter')
  const tabPresenter = usePresenter('tabPresenter')
  const pageRouter = usePageRouterStore()
  const messageStore = useMessageStore()
  const myWebContentsId = window.api.getWebContentsId()
  let rendererReadyNotified = false

  // --- State ---
  const sessions = ref<UISession[]>([])
  const activeSessionId = ref<string | null>(null)
  const groupMode = ref<GroupMode>('time')
  const loading = ref(false)
  const error = ref<string | null>(null)

  const notifyRendererReady = (): void => {
    if (rendererReadyNotified) return
    rendererReadyNotified = true
    void tabPresenter.onRendererTabReady(myWebContentsId)
  }

  notifyRendererReady()

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
      const webContentsId = window.api.getWebContentsId()
      const [result, activeSession] = await Promise.all([
        newAgentPresenter.getSessionList(),
        newAgentPresenter.getActiveSession(webContentsId)
      ])
      sessions.value = result.map(mapToUISession)

      const nextActiveSessionId = activeSession?.id ?? null
      if (activeSessionId.value !== nextActiveSessionId) {
        if (activeSessionId.value && activeSessionId.value !== nextActiveSessionId) {
          messageStore.clearStreamingState()
        }
        activeSessionId.value = nextActiveSessionId
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
      const webContentsId = window.api.getWebContentsId()
      const session = await newAgentPresenter.createSession(input, webContentsId)
      activeSessionId.value = session.id

      if (input.message?.trim()) {
        messageStore.addOptimisticUserMessage(
          session.id,
          input.message,
          (input.files ?? []) as MessageFile[]
        )
      }

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
      const webContentsId = window.api.getWebContentsId()
      await newAgentPresenter.activateSession(webContentsId, sessionId)
      activeSessionId.value = sessionId
      pageRouter.goToChat(sessionId)
    } catch (e) {
      error.value = `Failed to select session: ${e}`
    }
  }

  async function closeSession(): Promise<void> {
    error.value = null
    try {
      messageStore.clearStreamingState()
      const webContentsId = window.api.getWebContentsId()
      await newAgentPresenter.deactivateSession(webContentsId)
      activeSessionId.value = null
      pageRouter.goToNewThread()
    } catch (e) {
      error.value = `Failed to close session: ${e}`
    }
  }

  async function sendMessage(sessionId: string, content: string | SendMessageInput): Promise<void> {
    error.value = null
    try {
      await newAgentPresenter.sendMessage(sessionId, content)
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
      const updated = await newAgentPresenter.setSessionModel(sessionId, providerId, modelId)
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
      await newAgentPresenter.deleteSession(sessionId)
      if (activeSessionId.value === sessionId) {
        activeSessionId.value = null
        pageRouter.goToNewThread()
      }
      await fetchSessions()
    } catch (e) {
      error.value = `Failed to delete session: ${e}`
    }
  }

  async function renameSession(sessionId: string, title: string): Promise<void> {
    error.value = null
    try {
      const normalized = title.trim()
      if (!normalized) {
        return
      }
      await newAgentPresenter.renameSession(sessionId, normalized)
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
      await newAgentPresenter.toggleSessionPinned(sessionId, pinned)
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
      await newAgentPresenter.clearSessionMessages(sessionId)
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
      const result = await newAgentPresenter.exportSession(sessionId, format)
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

  function toggleGroupMode(): void {
    groupMode.value = groupMode.value === 'time' ? 'project' : 'time'
  }

  function getPinnedSessions(agentId: string | null): UISession[] {
    const pinned = sessions.value
      .filter((session) => session.isPinned && !session.isDraft)
      .sort((a, b) => b.updatedAt - a.updatedAt)

    if (agentId === null) return pinned

    return pinned.filter((session) => session.agentId === agentId)
  }

  function getFilteredGroups(agentId: string | null): SessionGroup[] {
    const visibleSessions = sessions.value.filter(
      (session) => !session.isDraft && !session.isPinned
    )
    const grouped =
      groupMode.value === 'time' ? groupByTime(visibleSessions) : groupByProject(visibleSessions)

    if (agentId === null) return grouped

    return grouped
      .map((group) => ({
        label: group.label,
        labelKey: group.labelKey,
        sessions: group.sessions.filter((s) => s.agentId === agentId)
      }))
      .filter((group) => group.sessions.length > 0)
  }

  // --- Event Listeners ---

  window.electron.ipcRenderer.on(SESSION_EVENTS.LIST_UPDATED, () => {
    fetchSessions()
  })

  window.electron.ipcRenderer.on(
    SESSION_EVENTS.ACTIVATED,
    (_: unknown, msg: { webContentsId: number; sessionId: string }) => {
      if (msg.webContentsId === myWebContentsId) {
        if (activeSessionId.value && activeSessionId.value !== msg.sessionId) {
          messageStore.clearStreamingState()
        }
        activeSessionId.value = msg.sessionId
        void tabPresenter.onRendererTabActivated(msg.sessionId)
      }
    }
  )

  window.electron.ipcRenderer.on(
    SESSION_EVENTS.DEACTIVATED,
    (_: unknown, msg: { webContentsId: number }) => {
      if (msg.webContentsId === myWebContentsId) {
        messageStore.clearStreamingState()
        activeSessionId.value = null
        pageRouter.goToNewThread()
      }
    }
  )

  window.electron.ipcRenderer.on(
    SESSION_EVENTS.STATUS_CHANGED,
    (_: unknown, msg: { sessionId: string; status: string }) => {
      const session = sessions.value.find((s) => s.id === msg.sessionId)
      if (session) {
        session.status = mapSessionStatus(msg.status)
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
    sendMessage,
    setSessionModel,
    selectSession,
    closeSession,
    renameSession,
    toggleSessionPinned,
    clearSessionMessages,
    exportSession,
    deleteSession,
    toggleGroupMode,
    getPinnedSessions,
    getFilteredGroups
  }
})
