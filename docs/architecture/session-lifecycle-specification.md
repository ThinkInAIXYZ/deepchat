# Session Lifecycle Management - Agentic Layer

## Document Purpose

This document specifies the complete session lifecycle management for the unified agentic layer, covering session creation, loading, and closing for both DeepChat and ACP agents.

**Status**: Implementation Specification
**Date**: 2026-01-25
**Related**: Research Item 6 from `renderer-analysis-research.md`

---

## Part I: Current State Analysis

### 1.1 DeepChat Session Lifecycle

**Storage**: SQLite (`chat.db`)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DeepChat Session Lifecycle                           │
└─────────────────────────────────────────────────────────────────────────┘

1. Session Creation:
   User creates new conversation
      ↓
   ConversationManager.createConversation(title, settings)
      ↓
   SQLite INSERT into conversations table
      ↓
   Generate conversationId (nanoid)
      ↓
   Store settings (modelId, providerId, temperature, agentWorkspacePath, etc.)
      ↓
   Emit CONVERSATION_EVENTS.ACTIVATED
      ↓
   Return conversationId to renderer

2. Session Loading:
   User opens existing conversation
      ↓
   ConversationManager.setActiveConversation(conversationId, tabId)
      ↓
   SQLite SELECT from conversations table
      ↓
   Load conversation record
      ↓
   Emit CONVERSATION_EVENTS.ACTIVATED
      ↓
   Renderer loads messages via MessageManager

3. Session Closing:
   User closes tab or switches conversation
      ↓
   ConversationManager.clearActiveConversation(tabId)
      ↓
   Update activeConversationIds Map
      ↓
   Emit CONVERSATION_EVENTS.DEACTIVATED
      ↓
   Conversation data persists in SQLite
```

### 1.2 ACP Session Lifecycle

**Storage**: In-memory only (no persistence)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      ACP Session Lifecycle                             │
└─────────────────────────────────────────────────────────────────────────┘

1. Session Creation:
   User selects ACP agent + workdir
      ↓
   AcpSessionManager.createSession(agentId, workdir, hooks)
      ↓
   Get or create ACP process for agentId+workdir
      ↓
   Register workdir with ProcessManager
      ↓
   Generate sessionId (nanoid)
      ↓
   Attach session event hooks (onSessionUpdate, onPermission)
      ↓
   Store session in memory (Map<sessionId, AcpSessionRecord>)
      ↓
   Emit ACP_EVENTS.SESSION_CREATED
      ↓
   Return sessionId to renderer

2. Session Loading:
   User reopens ACP session
      ↓
   AcpSessionManager.loadSession(agentId, sessionId, workdir, hooks)
      ↓
   Check if session exists in memory
      ↓
   If yes: Update hooks and return existing session
      ↓
   If no: Try to load from Agent (not yet supported)
         ↓ Fallback to createSession()

3. Session Closing:
   User closes ACP session
      ↓
   AcpSessionManager.closeSession(sessionId)
      ↓
   Remove session from memory Map
      ↓
   Detach all event handlers
      ↓
   Call connection.cancel(sessionId)
      ↓
   Emit ACP_EVENTS.SESSION_CLOSED
      ↓
   Session data is LOST (no persistence)
```

### 1.3 Key Differences

| Aspect | DeepChat | ACP |
|---------|----------|-----|
| **Storage** | SQLite (`chat.db`) | In-memory only |
| **Persistence** | Persistent across app restarts | Lost on app restart |
| **Session ID** | `conversationId` (nanoid) | `sessionId` (nanoid) |
| **Workspace** | Optional (`agentWorkspacePath`) | Required (`workdir`) |
| **Mutability** | Settings can change anytime | Workdir is immutable |
| **Loading** | Always loads from SQLite | Falls back to creation if not in memory |
| **Cleanup** | Just clear active binding | Full cleanup (handlers, connection) |

### 1.4 Current Issues

1. **Terminology**: DeepChat uses `conversationId`, ACP uses `sessionId`
2. **Separate flows**: Different creation methods for each agent type
3. **No unified interface**: Renderer must know which agent type to call
4. **Event fragmentation**: `CONVERSATION_EVENTS` vs `ACP_EVENTS`

---

## Part II: Unified Session Lifecycle

### 2.1 Unified SessionConfig

```typescript
// src/shared/types/presenters/agentic.presenter.d.ts

export interface SessionConfig {
  modelId?: string        // Target model ID
  modeId?: string         // Target mode/permission policy
  workspace?: string      // Workspace/workdir path
  title?: string          // Session title (DeepChat only)
  // Agent-specific config can be added via index signature
  [key: string]: any
}
```

### 2.2 Unified Session Creation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Unified Session Creation                            │
└─────────────────────────────────────────────────────────────────────────┘

1. User creates new session (via UI or API)
   User selects agent + fills config
      ↓
2. Renderer calls AgenticPresenter
   const sessionId = await agenticP.createSession(agentId, {
     modelId?: string
     modeId?: string
     workspace?: string
   })
      ↓
3. AgenticPresenter routes to appropriate presenter
   if agentId starts with 'acp.'
     → AcpPresenter.createSession(config)
   else
     → AgentPresenter.createSession(config)
      ↓
4. Agent presenter handles creation
   DeepChat:
     - Create conversation in SQLite
     - Store settings (including workspace as agentWorkspacePath)
     - Return conversationId as sessionId

   ACP:
     - Get/create process for workdir
     - Register workdir security
     - Create session in memory
     - Return generated sessionId
      ↓
5. AgenticPresenter tracks session
   - sessionToPresenter.set(sessionId, presenter)
   - Create emitter for session
      ↓
6. Emit unified event
   eventBus.sendToRenderer('agentic.session.created', {
     sessionId,
     agentId,
     sessionInfo: await presenter.getSession(sessionId)
   })
      ↓
7. Renderer receives and handles
   - Add session to state
   - Load session messages (DeepChat) or await agent (ACP)
   - Update UI
```

### 2.3 Unified Session Loading Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Unified Session Loading                             │
└─────────────────────────────────────────────────────────────────────────┘

1. User opens existing session
   User clicks on session in sidebar
      ↓
2. Renderer calls AgenticPresenter
   await agenticP.loadSession(sessionId, {
     activate: boolean,
     maxHistory?: number,
     includeSystemMessages?: boolean
   })
      ↓
3. AgenticPresenter routes to appropriate presenter
   Look up presenter from sessionToPresenter Map
      ↓
4. Agent presenter handles loading
   DeepChat:
     - Load conversation from SQLite
     - Set as active in ConversationManager
     - Emit CONVERSATION_EVENTS.ACTIVATED

   ACP:
     - Check if session in memory
     - If yes: Update hooks, return existing
     - If no: Try load from agent (fallback to create)
      ↓
5. Update renderer state
   - Set activeSessionId
   - Load messages
   - Update UI
```

### 2.4 Unified Session Closing Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Unified Session Closing                             │
└─────────────────────────────────────────────────────────────────────────┘

1. User closes session
   User closes tab or clicks "Close session"
      ↓
2. Renderer calls AgenticPresenter
   await agenticP.closeSession(sessionId)
      ↓
3. AgenticPresenter routes to appropriate presenter
   Look up presenter from sessionToPresenter Map
      ↓
4. Agent presenter handles closing
   DeepChat:
     - Clear active binding in ConversationManager
     - Emit CONVERSATION_EVENTS.DEACTIVATED
     - Conversation data persists in SQLite

   ACP:
     - Remove session from memory
     - Detach all event handlers
     - Call connection.cancel(sessionId)
     - Session data is LOST
      ↓
5. AgenticPresenter cleanup
   - Remove from sessionToPresenter Map
   - Clean up emitter
      ↓
6. Emit unified event
   eventBus.sendToRenderer('agentic.session.closed', {
     sessionId
   })
      ↓
7. Renderer updates state
   - Remove session from active state
   - Clear messages
   - Update UI
```

---

## Part III: Agent Presenter Implementations

### 3.1 DeepChat AgentPresenter - Session Lifecycle

```typescript
// src/main/presenter/agentPresenter/index.ts

export class AgentPresenter implements IAgentPresenter {
  readonly agentId = 'deepchat'

  /**
   * Create a new session (conversation)
   */
  async createSession(config: SessionConfig): Promise<string> {
    const title = config.title || 'New Chat'
    const workspace = config.workspace // Will be stored as agentWorkspacePath

    // Build conversation settings from config
    const settings: Partial<CONVERSATION_SETTINGS> = {
      modelId: config.modelId,
      providerId: this.extractProviderId(config.modelId),
      modeId: config.modeId,
      agentWorkspacePath: workspace,
      // ... other settings from defaults
    }

    // Create conversation via ConversationManager
    const conversationId = await this.conversationManager.createConversation(
      title,
      settings,
      tabId
    )

    // Track session context
    this.sessionContexts.set(conversationId, {
      conversationId,
      workspace,
      config
    })

    return conversationId // This becomes the sessionId
  }

  /**
   * Get session info
   */
  async getSession(sessionId: string): SessionInfo | null {
    const context = this.sessionContexts.get(sessionId)
    if (!context) return null

    const conversation = await this.conversationManager.getConversation(sessionId)
    if (!conversation) return null

    // Get mode info
    const currentModeId = this.sessionModes.get(sessionId)

    // Build SessionInfo
    return {
      sessionId,
      agentId: this.agentId,
      status: this.getStatus(sessionId),
      workspace: context.workspace,
      currentModeId,
      availableModes: this.getAvailableModes(),
      currentModelId: conversation.settings.modelId,
      availableModels: this.getAvailableModels(),
      capabilities: {
        supportsVision: true,
        supportsTools: true,
        supportsModes: true,
        supportsCommands: false
      }
    }
  }

  /**
   * Load an existing session
   */
  async loadSession(sessionId: string, context: LoadContext): Promise<void> {
    // Main process derives windowId from IPC context (webContentsId)
    const windowId = this.getCurrentWindowId()
    await this.conversationManager.setActiveConversation(sessionId, windowId)
  }

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    const context = this.sessionContexts.get(sessionId)
    if (!context) return

    const { tabId } = this.findTabForSession(sessionId)
    if (tabId) {
      this.conversationManager.clearActiveConversation(tabId, { notify: true })
    }

    // Don't delete session context - session persists in SQLite
    // Just clear the active binding
  }

  /**
   * Set workspace (DeepChat-specific)
   */
  async setWorkspace(sessionId: string, workspace: string | null): Promise<void> {
    const context = this.sessionContexts.get(sessionId)
    if (context) {
      context.workspace = workspace ?? undefined

      // Update in SQLite
      await this.conversationManager.updateConversationSettings(sessionId, {
        agentWorkspacePath: workspace
      })

      // Re-register workspace
      if (workspace) {
        await this.workspacePresenter.registerWorkspace(workspace)
      }

      // Emit update
      const emitter = this.getEmitter(sessionId)
      emitter?.sessionUpdated({ workspace: workspace ?? undefined })
    }
  }
}
```

### 3.2 ACP AgentPresenter - Session Lifecycle

```typescript
// src/main/presenter/acpPresenter/index.ts

export class AcpPresenter implements IAgentPresenter {
  readonly agentId: string // e.g., 'acp.claude-code'

  /**
   * Create a new session
   */
  async createSession(config: SessionConfig): Promise<string> {
    const workdir = config.workspace || this.getFallbackWorkdir()

    // Register workdir for security
    await this.workspacePresenter.registerWorkdir(workdir)

    // Create session hooks
    const hooks: SessionHooks = {
      onSessionUpdate: (notification) => {
        this.handleSessionUpdate(sessionId, notification)
      },
      onPermission: async (request) => {
        return this.handlePermissionRequest(sessionId, request)
      }
    }

    // Create session via SessionManager
    const sessionRecord = await this.sessionManager.createSession(
      this.agent.id,
      workdir,
      hooks
    )

    return sessionRecord.sessionId
  }

  /**
   * Get session info
   */
  async getSession(sessionId: string): SessionInfo | null {
    const sessionInfo = this.sessionManager.getSessionInfo(sessionId)
    if (!sessionInfo) return null

    return {
      sessionId: sessionInfo.sessionId,
      agentId: sessionInfo.agentId,
      status: this.mapStatus(sessionInfo.status),
      workspace: sessionInfo.workdir,
      currentModeId: sessionInfo.currentModeId,
      availableModes: sessionInfo.availableModes,
      currentModelId: sessionInfo.currentModelId,
      availableModels: sessionInfo.availableModels,
      availableCommands: sessionInfo.availableCommands,
      capabilities: {
        supportsVision: true,
        supportsTools: true,
        supportsModes: (sessionInfo.availableModes?.length ?? 0) > 0,
        supportsCommands: (sessionInfo.availableCommands?.length ?? 0) > 0
      }
    }
  }

  /**
   * Load an existing session
   */
  async loadSession(sessionId: string, context: LoadContext): Promise<void> {
    const sessionInfo = this.sessionManager.getSessionInfo(sessionId)
    if (!sessionInfo) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const workdir = sessionInfo.workdir

    // Load session via SessionManager
    const hooks = this.getSessionHooks(sessionId)
    await this.sessionManager.loadSession(
      this.agent.id,
      sessionId,
      workdir,
      hooks
    )
  }

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    await this.sessionManager.closeSession(sessionId)
  }

  /**
   * Set workspace (NOT SUPPORTED for ACP)
   */
  async setWorkspace(sessionId: string, workspace: string): Promise<void> {
    throw new Error(
      'ACP workdir is immutable for the session lifetime. ' +
      'To use a different workdir, create a new session.'
    )
  }

  /**
   * Map ACP status to unified status
   */
  private mapStatus(status: 'active' | 'paused' | 'error'): SessionStatus {
    const statusMap = {
      'active': 'idle',
      'paused': 'paused',
      'error': 'error'
    }
    return statusMap[status] || 'idle'
  }
}
```

---

## Part IV: Renderer Session Management

### 4.1 Session State in Renderer

```typescript
// src/renderer/src/composables/chat/useAgenticSessionStore.ts

export interface SessionState {
  activeSessionId: string | null
  sessions: SessionInfo[]
  sessionMetadata: Map<string, SessionMetadata>
  // ... other state
}

export function useAgenticSessionStore() {
  const activeSessionId = ref<string | null>(null)
  const sessions = ref<SessionInfo[]>([])
  const sessionMetadata = ref<Map<string, SessionMetadata>>(new Map())

  /**
   * Create a new session
   */
  const createSession = async (
    agentId: string,
    config: SessionConfig
  ): Promise<string> => {
    const agenticPresenter = window.api.agenticPresenter

    try {
      const sessionId = await agenticPresenter.createSession(agentId, config)

      // The SESSION_CREATED event will update our state
      return sessionId
    } catch (error) {
      console.error('Failed to create session:', error)
      throw error
    }
  }

  /**
   * Load an existing session
   */
  const loadSession = async (
    sessionId: string,
    context: LoadContext
  ): Promise<void> => {
    const agenticPresenter = window.api.agenticPresenter

    try {
      await agenticPresenter.loadSession(sessionId, context)
      activeSessionId.value = sessionId
    } catch (error) {
      console.error('Failed to load session:', error)
      throw error
    }
  }

  /**
   * Close the active session
   */
  const closeSession = async (sessionId: string): Promise<void> => {
    const agenticPresenter = window.api.agenticPresenter

    try {
      await agenticPresenter.closeSession(sessionId)

      // Remove from local state
      sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)
      sessionMetadata.value.delete(sessionId)

      if (activeSessionId.value === sessionId) {
        activeSessionId.value = null
      }
    } catch (error) {
      console.error('Failed to close session:', error)
      throw error
    }
  }

  return {
    activeSessionId,
    sessions,
    sessionMetadata,
    createSession,
    loadSession,
    closeSession,
    // ... other methods
  }
}
```

### 4.2 Event Handlers for Session Lifecycle

```typescript
// src/renderer/src/composables/chat/useAgenticEvents.ts

export function useAgenticEventHandlers(/* ... deps */) {
  /**
   * Handle SESSION_CREATED event
   */
  const handleSessionCreated = (event: SessionCreatedEvent) => {
    const { sessionId, agentId, sessionInfo } = event

    // Add to sessions array
    sessions.value.push(sessionInfo)

    // Store metadata
    sessionMetadata.value.set(sessionId, {
      sessionId,
      agentId,
      status: sessionInfo.status,
      workspace: sessionInfo.workspace,
      // ... other metadata
    })

    // Set as active if creating new session
    if (!activeSessionId.value) {
      activeSessionId.value = sessionId
    }

    // Load initial messages (DeepChat only)
    if (!agentId.startsWith('acp.')) {
      loadMessages(sessionId)
    }
  }

  /**
   * Handle SESSION_CLOSED event
   */
  const handleSessionClosed = (event: SessionClosedEvent) => {
    const { sessionId } = event

    // Remove from sessions array
    sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)

    // Clear metadata
    sessionMetadata.value.delete(sessionId)

    // Clear generating state
    sessionsWorkingStatus.value.delete(sessionId)
    generatingSessionIds.value.delete(sessionId)

    // Clear message cache
    clearCachedMessagesForSession(sessionId)

    // Update active session if needed
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
    }
  }

  /**
   * Handle SESSION_UPDATED event
   */
  const handleSessionUpdated = (event: SessionUpdatedEvent) => {
    const { sessionId, sessionInfo } = event

    // Update session in array
    const index = sessions.value.findIndex(s => s.sessionId === sessionId)
    if (index !== -1) {
      sessions.value[index] = { ...sessions.value[index], ...sessionInfo }
    }

    // Update metadata
    const metadata = sessionMetadata.value.get(sessionId)
    if (metadata) {
      sessionMetadata.value.set(sessionId, {
        ...metadata,
        ...sessionInfo
      })
    }
  }

  // ... other handlers
}
```

---

## Part V: Cleanup Procedures

### 5.1 DeepChat Cleanup

```typescript
// DeepChat session cleanup (minimal - data persists)

async closeSession(sessionId: string): Promise<void> {
  // 1. Clear active binding
  this.conversationManager.clearActiveConversation(tabId)

  // 2. Emit deactivation event
  eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, { tabId })

  // 3. Don't delete from SQLite - conversation persists
  // 4. Don't clear session context - can be reloaded
}
```

### 5.2 ACP Cleanup

```typescript
// ACP session cleanup (complete - data is lost)

async closeSession(sessionId: string): Promise<void> {
  // 1. Remove from memory
  this.sessions.delete(sessionId)

  // 2. Detach all event handlers
  session.detachHandlers.forEach((dispose) => dispose())

  // 3. Cancel session with agent
  await connection.cancel({ sessionId })

  // 4. Unregister workdir (if no other sessions using it)
  this.processManager.unregisterSessionWorkdir(sessionId)

  // 5. Emit closed event
  eventBus.sendToRenderer(ACP_EVENTS.SESSION_CLOSED, { sessionId })

  // 6. Session data is LOST - no persistence
}
```

### 5.3 App Shutdown Cleanup

```typescript
// src/main/presenter/agenticPresenter/index.ts

export class AgenticPresenter {
  /**
   * Cleanup all sessions on app shutdown
   */
  async shutdown(): Promise<void> {
    // Close all ACP sessions first (they need cleanup)
    for (const [sessionId, presenter] of this.sessionToPresenter.entries()) {
      if (presenter instanceof AcpPresenter) {
        try {
          await presenter.closeSession(sessionId)
        } catch (error) {
          console.error(`Failed to close ACP session ${sessionId}:`, error)
        }
      }
    }

    // Clear all tracking
    this.sessionToPresenter.clear()
    this.emitters.clear()

    // DeepChat sessions don't need cleanup (data persists)
  }
}
```

---

## Part VI: Error Handling

### 6.1 Session Creation Errors

| Error | DeepChat | ACP |
|-------|----------|-----|
| **Agent not found** | Throw error | Throw error |
| **Invalid workspace** | Allow null (optional) | Create temp fallback |
| **Storage failure** | Throw error | N/A (in-memory) |
| **Process start failure** | N/A | Retry 3x, then throw |

### 6.2 Session Loading Errors

| Error | DeepChat | ACP |
|-------|----------|-----|
| **Session not found** | Throw error | Fallback to createSession() |
| **Conversation deleted** | Throw error | N/A |
| **Agent not running** | N/A | Start process, then retry |
| **Workdir not accessible** | N/A | Create temp fallback |

### 6.3 Session Closing Errors

| Error | DeepChat | ACP |
|-------|----------|-----|
| **Session not found** | Log warning, return | Log warning, return |
| **Agent process crashed** | Continue (data persists) | Log error, continue |
| **Connection hung** | N/A | Force close after timeout |

---

## Part VII: Implementation Checklist

### Phase 1: Type Definitions

- [ ] Add `LoadContext` interface to `agentic.presenter.d.ts`
- [ ] Ensure `SessionConfig` is complete for both agent types
- [ ] Add shutdown method to `IAgentPresenter` interface

### Phase 2: Agent Presenter Updates

**DeepChat (`agentPresenter/index.ts`)**:
- [ ] Implement `createSession(config: SessionConfig)`
- [ ] Implement `getSession(sessionId): SessionInfo`
- [ ] Implement `loadSession(sessionId, context): Promise<void>`
- [ ] Implement `closeSession(sessionId): Promise<void>`
- [ ] Implement `setWorkspace(sessionId, workspace): Promise<void>`
- [ ] Track session contexts in Map

**ACP (`acpPresenter/index.ts`)**:
- [ ] Implement `createSession(config: SessionConfig)`
- [ ] Implement `getSession(sessionId): SessionInfo`
- [ ] Implement `loadSession(sessionId, context): Promise<void>`
- [ ] Implement `closeSession(sessionId): Promise<void>`
- [ ] Add error fallback in `setWorkspace` (immutable)

### Phase 3: AgenticPresenter Updates

- [ ] Update `createSession` to emit `SESSION_CREATED` with full SessionInfo
- [ ] Update `closeSession` to emit `SESSION_CLOSED` event
- [ ] Add `shutdown()` method for app cleanup
- [ ] Track sessionId → presenter mapping

### Phase 4: Renderer Composables

- [ ] Update `useAgenticSessionStore` with session lifecycle methods
- [ ] Add event handlers for SESSION_CREATED, SESSION_CLOSED
- [ ] Implement session loading logic
- [ ] Implement session closing logic

### Phase 5: Error Handling

- [ ] Add error handling for session creation failures
- [ ] Add error handling for session loading failures
- [ ] Add error handling for session closing failures
- [ ] Add user-facing error messages

### Phase 6: Testing

- [ ] Test DeepChat session creation
- [ ] Test DeepChat session loading
- [ ] Test DeepChat session closing
- [ ] Test ACP session creation
- [ ] Test ACP session loading
- [ ] Test ACP session closing
- [ ] Test workspace change (DeepChat)
- [ ] Test workspace change rejection (ACP)
- [ ] Test app shutdown cleanup

---

## Part VIII: Architectural Decisions

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D-039 | 2026-01-25 | SessionConfig as unified interface | Single createSession() for all agents | ✅ Confirmed |
| D-040 | 2026-01-25 | Agent-specific session persistence | DeepChat persists, ACP doesn't | ✅ Confirmed |
| D-041 | 2026-01-25 | ACP workdir is immutable | Matches ACP protocol design | ✅ Confirmed |
| D-042 | 2026-01-25 | ACP session loading falls back to creation | No persistence in ACP protocol | ✅ Confirmed |
| D-043 | 2026-01-25 | Unified SESSION_CREATED/SESSION_CLOSED events | Single event system for all agents | ✅ Confirmed |
| D-044 | 2026-01-25 | App shutdown closes ACP sessions first | ACP needs cleanup, DeepChat persists | ✅ Confirmed |
| D-045 | 2026-01-25 | sessionId → presenter mapping in AgenticPresenter | Efficient routing for session operations | ✅ Confirmed |
| D-046 | 2026-01-25 | LoadContext excludes tabId (derived from IPC) | Chat windows use single WebContents, windowId derived from IPC context | ✅ Updated 2026-01-25 |

---

## Part IX: Related Documents

- `state-management-refactoring-spec.md` - State management refactoring
- `event-payload-specification.md` - Unified event system
- `workspace-implementation-plan.md` - Workspace handling
- `renderer-analysis-research.md` - Main research document (Research Item 6)

### Code References

- `src/main/presenter/sessionPresenter/managers/conversationManager.ts` - DeepChat session management
- `src/main/presenter/acpPresenter/managers/sessionManager.ts` - ACP session management
- `src/main/presenter/agenticPresenter/index.ts` - Unified session interface
- `src/main/presenter/agentPresenter/index.ts` - DeepChat agent presenter
- `src/main/presenter/acpPresenter/index.ts` - ACP agent presenter
