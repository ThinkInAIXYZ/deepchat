import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { CONVERSATION_EVENTS } from '@/events'
import type { Session } from '@shared/types/presenters/session.presenter'
import type { Ref } from 'vue'

export type GroupBy = 'project' | 'time'

export interface SessionGroup {
  dt: string
  sessions: SessionListItem[]
}

export interface SessionListItem {
  id: string
  title: string
  agentId?: string
  status: 'none' | 'working' | 'completed' | 'error'
  projectDir: string
  isPinned?: boolean
  updatedAt: number
}

function getSessionStatus(session: Session): 'none' | 'working' | 'completed' | 'error' {
  if (session.status === 'generating' || session.status === 'waiting_permission') {
    return 'working'
  }
  if (session.status === 'error') {
    return 'error'
  }
  return 'none'
}

function getProjectDir(session: Session): string {
  if (session.context.acpWorkdirMap) {
    const dirs = Object.values(session.context.acpWorkdirMap).filter(Boolean)
    if (dirs.length > 0) return dirs[0] as string
  }
  if (session.context.agentWorkspacePath) {
    return session.context.agentWorkspacePath
  }
  return ''
}

function sessionToListItem(session: Session): SessionListItem {
  return {
    id: session.sessionId,
    title: session.config.title || 'Untitled',
    agentId: session.config.agentId,
    status: getSessionStatus(session),
    projectDir: getProjectDir(session),
    isPinned: session.config.isPinned,
    updatedAt: session.updatedAt
  }
}

function groupByTime(sessions: SessionListItem[]): SessionGroup[] {
  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000
  const groups = new Map<string, SessionListItem[]>()

  const pinnedSessions = sessions.filter((s) => s.isPinned)
  const unpinnedSessions = sessions.filter((s) => !s.isPinned)

  for (const session of unpinnedSessions) {
    const age = now - session.updatedAt
    let label: string

    if (age < oneDayMs) {
      label = 'Today'
    } else if (age < 2 * oneDayMs) {
      label = 'Yesterday'
    } else if (age < 7 * oneDayMs) {
      label = 'Last Week'
    } else if (age < 30 * oneDayMs) {
      label = 'Last Month'
    } else {
      label = 'Older'
    }

    if (!groups.has(label)) {
      groups.set(label, [])
    }
    groups.get(label)!.push(session)
  }

  const order = ['Today', 'Yesterday', 'Last Week', 'Last Month', 'Older']
  const result: SessionGroup[] = []

  if (pinnedSessions.length > 0) {
    result.push({ dt: 'Pinned', sessions: pinnedSessions })
  }

  for (const label of order) {
    const groupSessions = groups.get(label)
    if (groupSessions && groupSessions.length > 0) {
      result.push({ dt: label, sessions: groupSessions })
    }
  }

  return result
}

function groupByProject(sessions: SessionListItem[]): SessionGroup[] {
  const projectMap = new Map<string, SessionListItem[]>()

  const pinnedSessions = sessions.filter((s) => s.isPinned)
  const unpinnedSessions = sessions.filter((s) => !s.isPinned)

  for (const session of unpinnedSessions) {
    const dir = session.projectDir || 'Unknown'
    if (!projectMap.has(dir)) {
      projectMap.set(dir, [])
    }
    projectMap.get(dir)!.push(session)
  }

  const result: SessionGroup[] = []

  if (pinnedSessions.length > 0) {
    result.push({ dt: 'Pinned', sessions: pinnedSessions })
  }

  for (const [dir, dirSessions] of projectMap) {
    const displayName = dir.split('/').pop() || dir
    result.push({ dt: displayName, sessions: dirSessions })
  }

  return result
}

export const LOCAL_AGENT_ID = 'local-agent'

export function useSessionList(
  selectedAgentId: Ref<string | null>,
  templateAgentIds: Ref<string[]>
) {
  const sessionPresenter = usePresenter('sessionPresenter')

  const allSessions = ref<SessionListItem[]>([])
  const groupBy = ref<GroupBy>('time')
  const searchQuery = ref('')
  const loading = ref(false)

  const filteredSessions = computed(() => {
    let sessions = allSessions.value

    if (selectedAgentId.value !== null) {
      if (selectedAgentId.value === LOCAL_AGENT_ID) {
        sessions = sessions.filter((s) => s.agentId && templateAgentIds.value.includes(s.agentId))
      } else {
        sessions = sessions.filter((s) => s.agentId === selectedAgentId.value)
      }
    }

    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase()
      sessions = sessions.filter((s) => s.title.toLowerCase().includes(query))
    }

    return sessions
  })

  const groupedSessions = computed(() => {
    const sessions = filteredSessions.value
    return groupBy.value === 'project' ? groupByProject(sessions) : groupByTime(sessions)
  })

  async function loadSessions() {
    loading.value = true
    try {
      const result = await sessionPresenter.getSessionList(1, 1000)
      allSessions.value = result.sessions.map(sessionToListItem)
    } catch (error) {
      console.error('Failed to load sessions:', error)
    } finally {
      loading.value = false
    }
  }

  async function refreshSessions() {
    await loadSessions()
  }

  function setGroupBy(value: GroupBy) {
    groupBy.value = value
  }

  function handleListUpdated() {
    void refreshSessions()
  }

  onMounted(() => {
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.LIST_UPDATED, handleListUpdated)
  })

  onUnmounted(() => {
    window.electron.ipcRenderer.removeListener(CONVERSATION_EVENTS.LIST_UPDATED, handleListUpdated)
  })

  return {
    allSessions,
    groupBy,
    searchQuery,
    filteredSessions,
    groupedSessions,
    loading,
    loadSessions,
    refreshSessions,
    setGroupBy
  }
}
