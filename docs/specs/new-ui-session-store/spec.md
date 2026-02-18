# Session Store Spec

## Overview

Session Store is the central owner of all session state: the session list, the active session, grouping/filtering, and session CRUD operations. It coordinates with the Page Router for navigation.

## File Location

`src/renderer/src/stores/ui/session.ts`

## Type Definitions

### UI Session (derived from presenter Session)

The presenter returns a rich `Session` object. The UI store maps it to a flattened structure for display:

```typescript
interface UISession {
  id: string
  title: string
  agentId: string           // Derived: see "Agent ID Resolution" below
  status: UISessionStatus
  projectDir: string        // From session.context.agentWorkspacePath
  providerId: string
  modelId: string
  createdAt: number
  updatedAt: number
}

type UISessionStatus = 'completed' | 'working' | 'error' | 'none'
```

### Agent ID Resolution

The presenter `Session` does not have a top-level `agentId`. It is derived:

```typescript
function resolveAgentId(session: Session): string {
  // ACP agent sessions have chatMode 'acp agent' and an acpWorkdirMap
  if (session.config.chatMode === 'acp agent') {
    const acpMap = session.context.acpWorkdirMap
    if (acpMap) {
      // The first (or only) key in acpWorkdirMap is the agentId
      const agentIds = Object.keys(acpMap)
      if (agentIds.length > 0) return agentIds[0]
    }
  }
  return 'deepchat'
}
```

### Session Status Mapping

Map presenter `SessionStatus` to UI display status:

```typescript
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
```

### Session Group

```typescript
interface SessionGroup {
  label: string             // 'Today', 'Yesterday', 'Last Week', or project name
  sessions: UISession[]
}

type GroupMode = 'time' | 'project'
```

## Store Design

```typescript
export const useSessionStore = defineStore('session', () => {
  const sessionPresenter = usePresenter('sessionPresenter')
  const pageRouter = usePageRouterStore()

  // --- State ---
  const sessions = ref<UISession[]>([])
  const activeSessionId = ref<string | null>(null)
  const groupMode = ref<GroupMode>('time')
  const loading = ref(false)
  const error = ref<string | null>(null)

  // --- Getters ---
  const activeSession: ComputedRef<UISession | undefined>
  const sessionGroups: ComputedRef<SessionGroup[]>
  const hasActiveSession: ComputedRef<boolean>

  // --- Actions ---
  async function fetchSessions(): Promise<void>
  async function createSession(params: CreateSessionInput): Promise<void>
  async function selectSession(sessionId: string): Promise<void>
  async function closeSession(): Promise<void>
  function toggleGroupMode(): void
  function getFilteredGroups(agentId: string | null): SessionGroup[]

  return {
    sessions, activeSessionId, groupMode, loading, error,
    activeSession, sessionGroups, hasActiveSession,
    fetchSessions, createSession, selectSession, closeSession,
    toggleGroupMode, getFilteredGroups
  }
})
```

## Actions

### `fetchSessions(): Promise<void>`

Load all sessions from the presenter.

```typescript
async function fetchSessions() {
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
```

### `createSession(params): Promise<void>`

Create a new session and navigate to it.

```typescript
interface CreateSessionInput {
  title: string
  message: string
  projectDir?: string
  providerId?: string
  modelId?: string
  agentId?: string            // 'deepchat' or ACP agent id
  reasoningEffort?: string
}

async function createSession(params: CreateSessionInput) {
  error.value = null
  try {
    const tabId = window.api.getWebContentsId()
    const settings: Partial<SessionConfig> = {}

    if (params.providerId) settings.providerId = params.providerId
    if (params.modelId) settings.modelId = params.modelId
    if (params.projectDir) settings.agentWorkspacePath = params.projectDir
    if (params.reasoningEffort) settings.reasoningEffort = params.reasoningEffort

    // Determine chat mode from agent
    if (params.agentId && params.agentId !== 'deepchat') {
      settings.chatMode = 'acp agent'
      settings.acpWorkdirMap = { [params.agentId]: params.projectDir ?? null }
    }

    const sessionId = await sessionPresenter.createSession({
      title: params.title || 'New Thread',
      settings,
      tabId
    })

    // Refresh session list and activate
    await fetchSessions()
    activeSessionId.value = sessionId
    pageRouter.goToChat(sessionId)

    // Send the initial message
    const agentPresenter = usePresenter('agentPresenter')
    await agentPresenter.chat(sessionId, params.message, tabId)
  } catch (e) {
    error.value = `Failed to create session: ${e}`
  }
}
```

### `selectSession(sessionId: string): Promise<void>`

Switch to an existing session.

```typescript
async function selectSession(sessionId: string) {
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
```

### `closeSession(): Promise<void>`

Deactivate the current session and return to NewThread.

```typescript
async function closeSession() {
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
```

### `toggleGroupMode(): void`

```typescript
function toggleGroupMode() {
  groupMode.value = groupMode.value === 'time' ? 'project' : 'time'
}
```

### `getFilteredGroups(agentId: string | null): SessionGroup[]`

Returns grouped sessions, optionally filtered by agent. Used by the sidebar.

```typescript
function getFilteredGroups(agentId: string | null): SessionGroup[] {
  const grouped = groupMode.value === 'time'
    ? groupByTime(sessions.value)
    : groupByProject(sessions.value)

  if (agentId === null) return grouped

  return grouped
    .map(group => ({
      label: group.label,
      sessions: group.sessions.filter(s => s.agentId === agentId)
    }))
    .filter(group => group.sessions.length > 0)
}
```

## Getters

```typescript
const activeSession = computed(() =>
  sessions.value.find(s => s.id === activeSessionId.value)
)

const hasActiveSession = computed(() => activeSessionId.value !== null)

const sessionGroups = computed(() => getFilteredGroups(null))
```

## Grouping Logic

### groupByTime

```typescript
function groupByTime(sessions: UISession[]): SessionGroup[] {
  const now = Date.now()
  const today = startOfDay(now)
  const yesterday = startOfDay(now - 86400000)
  const lastWeek = startOfDay(now - 7 * 86400000)

  const groups: Record<string, UISession[]> = {
    'Today': [],
    'Yesterday': [],
    'Last Week': [],
    'Older': []
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
```

### groupByProject

```typescript
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
```

## IPC Call Mapping

| Action | Presenter Call |
|--------|---------------|
| Fetch sessions | `sessionPresenter.getSessionList(page, pageSize)` |
| Create session | `sessionPresenter.createSession({ title, settings, tabId })` |
| Activate session | `sessionPresenter.activateSession(tabId, sessionId)` |
| Deactivate session | `sessionPresenter.unbindFromTab(tabId)` |
| Send message | `agentPresenter.chat(sessionId, message, tabId)` |
| Get active session | `sessionPresenter.getActiveSession(tabId)` |

## Event Listeners

| Event | Handler |
|-------|---------|
| `CONVERSATION_EVENTS.LIST_UPDATED` | Call `fetchSessions()` to refresh list |
| `CONVERSATION_EVENTS.ACTIVATED` | Update `activeSessionId` |
| `CONVERSATION_EVENTS.DEACTIVATED` | Clear `activeSessionId`, `goToNewThread()` |

## Error Handling

All async actions catch errors and set `error` ref. Components can display errors via:

```vue
<div v-if="sessionStore.error" class="text-destructive text-sm">
  {{ sessionStore.error }}
</div>
```

The `error` state is cleared at the start of each action.

## Test Points

1. `fetchSessions` maps presenter Sessions to UISession correctly
2. `resolveAgentId` returns 'deepchat' for agent-mode sessions
3. `resolveAgentId` returns ACP agent id for acp-agent-mode sessions
4. `createSession` creates session, refreshes list, navigates to chat
5. `selectSession` activates session and navigates to chat
6. `closeSession` unbinds tab and navigates to newThread
7. `groupByTime` correctly buckets sessions into Today/Yesterday/Last Week/Older
8. `groupByProject` correctly groups by projectDir
9. `getFilteredGroups` filters by agentId when provided
10. Error states are set on failure and cleared on retry
