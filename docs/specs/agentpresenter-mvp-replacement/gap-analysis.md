# Architecture Gap Analysis

## Executive Summary

This document analyzes the functional gaps between the old architecture (`agentPresenter` + `sessionPresenter` + `chatStore`) and the new architecture (`agentRuntimePresenter` + `agentSessionPresenter` + `sessionStore`/`messageStore`).

**Critical Finding**: The new architecture has successfully implemented the core streaming and message persistence infrastructure, but lacks critical functionality in five key areas:

1. **Permission Flow**: No permission mode selection, whitelist management, or approval UI integration
2. **Session Configuration**: Missing model/permission persistence at session creation
3. **Message Operations**: No edit/retry/regenerate/fork capabilities
4. **Frontend Integration**: ChatStatusBar shows permissions as read-only, NewThreadPage lacks permission mode selector
5. **Tool Execution**: New dispatch module lacks permission integration entirely

**Priority**: P0 items must be completed before MVP launch.

---

## 1. NewThreadPage Functionality

### Current State (New Architecture)

**Implemented:**
- ✅ Basic session creation via `agentSessionPresenter.createSession()`
- ✅ Model resolution from default settings (`configPresenter.getDefaultModel()`)
- ✅ Preferred model fallback logic
- ✅ Project/workspace binding via `projectStore.selectedProject.path`
- ✅ Agent selection (deepchat vs ACP agents)

**File References:**
- `src/renderer/src/pages/NewThreadPage.vue` (lines 70-112)
- `src/main/presenter/agentSessionPresenter/index.ts` (lines 24-60)

### Missing Functionality

#### 1.1 Permission Mode Selection

**Gap**: No UI or backend support for selecting `Default` vs `Full access` permission mode at session creation.

**Old Architecture:**
- `ChatStatusBar.vue` had permission mode dropdown
- Permission mode stored in session/conversation settings
- `agentPresenter.permissionHandler` enforced mode

**New Architecture:**
- `ChatStatusBar.vue` line 91: Shows "Default permissions" as **read-only button** (no dropdown)
- `agentSessionPresenter` has no `permissionMode` parameter in `createSession()`
- `new_sessions` table has no `permission_mode` column

**Impact**: Users cannot choose permission level; all sessions default to unknown behavior.

#### 1.2 Workspace Binding Enforcement

**Gap**: No validation that workspace is bound before allowing `Full access` mode.

**Old Architecture:**
- Permission handler checked `session.projectDir` before enabling full access
- UI disabled full access if no workspace bound

**New Architecture:**
- No validation in `NewThreadPage.onSubmit()`
- No validation in `agentSessionPresenter.createSession()`

#### 1.3 Default Model Loading from Settings

**Partially Implemented:**
- ✅ Reads `defaultModel` setting
- ✅ Falls back to `preferredModel`
- ✅ Falls back to first available model

**Missing:**
- ❌ No user feedback if no model configured (silent failure)
- ❌ No settings deep-link to configure model

### Required Implementation

1. **Add `permissionMode` to session creation:**
   ```typescript
   // new_sessions table schema
   permission_mode: 'default' | 'full'  // default: 'default'
   ```

2. **Update NewThreadPage UI:**
   - Add permission mode dropdown in ChatStatusBar
   - Disable "Full access" if `!projectStore.selectedProject`
   - Show tooltip: "Bind workspace first to enable Full access"

3. **Update agentSessionPresenter.createSession():**
   ```typescript
   async createSession(input: {
     message: string
     projectDir: string | null
     agentId: string
     providerId?: string
     modelId?: string
     permissionMode?: 'default' | 'full'  // NEW
   }): Promise<SessionWithState>
   ```

---

## 2. Permission Flow

### Current State (New Architecture)

**Implemented:**
- ✅ `agentRuntimePresenter.process.ts` executes tool calls
- ✅ `agentRuntimePresenter.dispatch.ts` builds tool conversations

**File References:**
- `src/main/presenter/agentRuntimePresenter/process.ts`
- `src/main/presenter/agentRuntimePresenter/dispatch.ts`

### Missing Functionality

#### 2.1 Permission Request Generation

**Gap**: No permission request blocks created before tool execution.

**Old Architecture:**
```
Old Flow:
1. LLM emits tool_call event
2. agentPresenter/loop/toolCallHandler.interceptToolCalls()
3. Creates permission request block if tool requires permission
4. Emits STREAM_EVENTS.RESPONSE with permission block
5. Frontend renders permission UI (approve/reject/remember)
6. User responds → agentPresenter.handlePermissionResponse()
7. permissionHandler validates and resumes loop
```

**New Architecture:**
```
New Flow (BROKEN):
1. LLM emits tool_call event
2. processStream → executeTools()
3. Tools executed IMMEDIATELY (line 118-145 dispatch.ts)
4. NO permission check ❌
5. NO permission block created ❌
6. NO user approval ❌
```

**Critical**: `executeTools()` in `dispatch.ts` directly calls `toolPresenter.callTool()` without any permission validation.

#### 2.2 Backend Pause/Resume Mechanism

**Gap**: No mechanism to pause stream generation waiting for permission approval.

**Old Architecture:**
- `sessionManager` tracked `pendingPermission` state
- `PermissionHandler` held tool call state
- `handlePermissionResponse()` resumed loop with approved tool calls

**New Architecture:**
- `agentRuntimePresenter` has no pause state
- `processStream()` is synchronous - no yield points for user input
- No IPC method to resume after permission approval

#### 2.3 Frontend Permission UI Rendering

**Gap**: No permission UI components integrated with new stores.

**Old Architecture:**
- `MessageList.vue` rendered `action` blocks with `action_type: 'tool_call_permission'`
- Permission blocks had approve/reject buttons
- Integrated with `chatStore.handlePermissionResponse()`

**New Architecture:**
- `messageStore` receives `STREAM_EVENTS.RESPONSE` with blocks
- `MessageList` component unchanged (should still render blocks)
- **Missing**: No handler to call `agentSessionPresenter` permission methods (don't exist yet)

#### 2.4 Permission Approval Handler

**Gap**: No IPC method to handle permission responses.

**Old Architecture:**
```typescript
// agentPresenter.ts (line 243)
async handlePermissionResponse(
  messageId: string,
  toolCallId: string,
  granted: boolean,
  permissionType: 'read' | 'write' | 'all' | 'command',
  remember?: boolean
): Promise<void>
```

**New Architecture:**
- ❌ No `handlePermissionResponse()` in `agentSessionPresenter`
- ❌ No `handlePermissionResponse()` in `agentRuntimePresenter`

#### 2.5 Whitelist Management

**Gap**: No session-scoped whitelist storage or matching.

**Old Architecture:**
- `CommandPermissionService` managed whitelists
- Whitelist entries: `{ sessionId, toolName, pathPattern, permissionType }`
- `remember: true` added to whitelist

**New Architecture:**
- No whitelist storage
- No whitelist matching logic
- No "remember this permission" UI

#### 2.6 Session-Scoped Permissions

**Gap**: Whitelists not isolated by session.

**Old Architecture:**
- Whitelists scoped to `sessionId`
- Different sessions could have different permissions

**New Architecture:**
- No whitelist implementation at all

### Required Implementation

#### Complete Permission Flow Diagram

```
OLD ARCHITECTURE:
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   LLM       │────▶│ ToolCall     │────▶│ Permission      │
│  coreStream │     │ Handler      │     │ Handler         │
└─────────────┘     └──────────────┘     └─────────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              │                               │
                              ▼                               ▼
                     ┌────────────────┐            ┌────────────────┐
                     │  Auto-approve  │            │  Ask User      │
                     │  (whitelist)   │            │  (permission   │
                     │                │            │   request UI)  │
                     └────────────────┘            └────────────────┘
                                                      │
                                                      ▼
                                             ┌────────────────┐
                                             │  User Approves │
                                             │  /Rejects      │
                                             └────────────────┘
                                                      │
                                                      ▼
                     ┌─────────────────────────────────┴──────────┐
                     │                                            │
                     ▼                                            ▼
            ┌────────────────┐                         ┌────────────────┐
            │  Resume Loop   │                         │  Skip Tool     │
            │  Execute Tool  │                         │  Continue      │
            └────────────────┘                         └────────────────┘


NEW ARCHITECTURE (CURRENT - BROKEN):
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   LLM       │────▶│ processStream│────▶│ executeTools()  │
│  coreStream │     │              │     │ (NO PERMISSION) │
└─────────────┘     └──────────────┘     └─────────────────┘
```

### Required Implementation

1. **Add permission checker to agentRuntimePresenter:**
   ```typescript
   // agentRuntimePresenter/index.ts
   private permissionChecker: PermissionChecker
   
   constructor(..., toolPresenter: IToolPresenter) {
     this.permissionChecker = new PermissionChecker(sqlitePresenter)
   }
   ```

2. **Modify processStream to check permissions:**
   ```typescript
   // Before executeTools(), check each tool call
   for (const tc of state.completedToolCalls) {
     const permission = await permissionChecker.checkPermission(
       sessionId,
       tc.name,
       tc.arguments
     )
     
     if (permission.status === 'pending') {
       // Create permission request block
       // Emit to renderer
       // PAUSE and wait for approval
     }
   }
   ```

3. **Add IPC methods:**
   ```typescript
   // agentSessionPresenter/index.ts
   async handlePermissionResponse(
     sessionId: string,
     messageId: string,
     toolCallId: string,
     granted: boolean,
     permissionType: 'read' | 'write' | 'all' | 'command',
     remember?: boolean
   ): Promise<void>
   ```

4. **Update ChatStatusBar:**
   - Replace read-only button with dropdown
   - Add permission mode selector
   - Integrate with sessionStore

---

## 3. Session Management

### Current State (New Architecture)

**Implemented:**
- ✅ `NewSessionManager.create()` - creates session records
- ✅ `NewSessionManager.bindWindow()` - binds session to window
- ✅ `agentSessionPresenter.createSession()` - full creation flow
- ✅ `agentSessionPresenter.activateSession()` - activation
- ✅ `agentSessionPresenter.deactivateSession()` - deactivation
- ✅ Session status tracking via `runtimeState` Map
- ✅ Event emission: `SESSION_EVENTS.ACTIVATED`, `DEACTIVATED`, `STATUS_CHANGED`

**File References:**
- `src/main/presenter/agentSessionPresenter/sessionManager.ts`
- `src/main/presenter/agentSessionPresenter/index.ts`
- `src/renderer/src/stores/ui/session.ts`

### Missing Functionality

#### 3.1 Session Creation with Full Configuration

**Gap**: Missing configuration fields at creation time.

**Old Architecture:**
```typescript
// sessionPresenter.createConversation()
settings: {
  providerId, modelId, temperature, contextLength, 
  maxTokens, systemPrompt, artifacts, enabledMcpTools,
  thinkingBudget, reasoningEffort, verbosity,
  permissionMode, agentWorkspacePath
}
```

**New Architecture:**
```typescript
// agentSessionPresenter.createSession()
input: {
  message, projectDir, agentId, providerId, modelId
  // MISSING: temperature, contextLength, maxTokens, 
  // systemPrompt, permissionMode, enabledMcpTools
}
```

**Impact**: Sessions created with default settings only; no customization.

#### 3.2 Session Activation/Deactivation

**Status**: ✅ Fully implemented

**Notes:**
- `activateSession()` binds window and emits event
- `deactivateSession()` unbinds and navigates to NewThreadPage
- Frontend `sessionStore` handles events correctly

#### 3.3 Session Status Tracking

**Status**: ✅ Implemented, but could be enhanced

**Current States:**
- `'idle'` - ready for input
- `'generating'` - processing message
- `'error'` - error occurred

**Missing:**
- `'paused'` - waiting for permission approval (critical for permission flow)
- Status persistence in DB (currently only in-memory `runtimeState`)

#### 3.4 Session Persistence and Retrieval

**Status**: ✅ Implemented

**Notes:**
- `new_sessions` table stores sessions
- `sessionStore.fetchSessions()` loads from DB
- State rebuilt from `agentRuntimePresenter.getSessionState()`

#### 3.5 Session Deletion and Cleanup

**Status**: ✅ Implemented

**Notes:**
- `deleteSession()` calls `agent.destroySession()`
- Cleans up messages via `messageStore.deleteBySession()`
- Emits `SESSION_EVENTS.LIST_UPDATED`

### Session Lifecycle Comparison

```
OLD:
createConversation → init settings → bind to tab → send message → stream
       ↓
   update settings (mid-conversation) → reconfigure
       ↓
   deleteConversation → cleanup messages → unbind

NEW:
createSession → initSession → bindWindow → processMessage → stream
       ↓
   [MISSING: update session config mid-conversation]
       ↓
   deleteSession → destroySession → unbindWindow
```

### Required Implementation

1. **Add `permission_mode` to new_sessions table:**
   ```sql
   ALTER TABLE new_sessions ADD COLUMN permission_mode TEXT DEFAULT 'default'
   ```

2. **Extend createSession input:**
   ```typescript
   interface CreateSessionInput {
     message: string
     projectDir: string | null
     agentId: string
     providerId?: string
     modelId?: string
     permissionMode?: 'default' | 'full'  // NEW
     temperature?: number                 // NEW
     contextLength?: number               // NEW
     maxTokens?: number                   // NEW
   }
   ```

3. **Add 'paused' status:**
   ```typescript
   type DeepChatSessionStatus = 'idle' | 'generating' | 'error' | 'paused'
   ```

4. **Add session update method:**
   ```typescript
   async updateSession(
     sessionId: string,
     fields: Partial<CreateSessionInput>
   ): Promise<void>
   ```

---

## 4. Message Streaming

### Current State (New Architecture)

**Implemented:**
- ✅ `processStream()` handles streaming with tool calls
- ✅ `accumulator.ts` accumulates LLM events into blocks
- ✅ `messageStore.createAssistantMessage()` creates pending message
- ✅ `messageStore.updateAssistantContent()` updates during stream
- ✅ `messageStore.finalizeAssistantMessage()` completes message
- ✅ Event emission: `STREAM_EVENTS.RESPONSE`, `END`, `ERROR`
- ✅ Frontend `messageStore` listens to events and updates `streamingBlocks`

**File References:**
- `src/main/presenter/agentRuntimePresenter/process.ts`
- `src/main/presenter/agentRuntimePresenter/accumulator.ts`
- `src/main/presenter/agentRuntimePresenter/messageStore.ts`
- `src/renderer/src/stores/ui/message.ts`

### Missing Functionality

#### 4.1 Stream Event Format

**Status**: ✅ Implemented (blocks format)

**Old Architecture:**
```typescript
// Old: AssistantMessage with blocks
{
  id: string,
  content: AssistantMessageBlock[],
  role: 'assistant',
  status: 'pending' | 'sent' | 'error'
}
```

**New Architecture:**
```typescript
// New: Same block format ✅
AssistantMessageBlock:
  type: 'content' | 'tool_call' | 'reasoning_content' | 'error'
  content: string
  status: 'pending' | 'success' | 'error'
  tool_call?: { id, name, arguments, response, server_name }
```

**Compatibility**: ✅ Blocks format is compatible

#### 4.2 Frontend Stream Handlers

**Status**: ✅ Implemented

**Notes:**
- `messageStore` listens to `STREAM_EVENTS.RESPONSE`
- Updates `streamingBlocks` ref
- `ChatPage.vue` computes `displayMessages` including streaming message

#### 4.3 Message Rendering During Streaming

**Status**: ✅ Implemented

**Notes:**
- `ChatPage.vue` line 105-117: Appends streaming message to display list
- `MessageList` component renders blocks
- Auto-scroll works during streaming

#### 4.4 Generating State Management

**Status**: ✅ Implemented

**Notes:**
- Session status set to `'generating'` before stream (agentRuntimePresenter line 101)
- Status set to `'idle'` or `'error'` after completion (lines 167, 175)
- `SESSION_EVENTS.STATUS_CHANGED` emitted
- `sessionStore` updates session status

#### 4.5 Stream Completion/Finalization

**Status**: ✅ Implemented

**Notes:**
- `finalize()` in `dispatch.ts` marks blocks as success
- Computes metadata (generation time, tokens/sec)
- Calls `messageStore.finalizeAssistantMessage()`
- Emits `STREAM_EVENTS.END`
- Frontend reloads messages from DB

### Stream Flow Comparison

```
OLD:
sendMessage → create user message → create assistant message
   → streamGenerationHandler.generateAIResponse()
   → startStreamCompletion()
   → LLM coreStream → LLMEventHandler → ContentBufferHandler
   → ToolCallHandler (with permission)
   → Flush blocks to renderer → Edit DB message
   → Finalize → STREAM_EVENTS.END

NEW:
processMessage → create user message → create assistant message
   → processStream()
   → LLM coreStream → accumulator()
   → executeTools() [MISSING: permission check]
   → finalize() → STREAM_EVENTS.END
```

### Required Implementation

**No critical gaps in streaming itself.** The streaming infrastructure is solid. The only gap is integrating permission checks into the tool execution loop (covered in Section 2).

---

## 5. Tool Execution

### Current State (New Architecture)

**Implemented:**
- ✅ `processStream()` manages tool-calling loop
- ✅ `executeTools()` in `dispatch.ts` calls tools
- ✅ Tool responses added to conversation
- ✅ Tool call blocks updated with responses
- ✅ Error handling for tool failures

**File References:**
- `src/main/presenter/agentRuntimePresenter/process.ts`
- `src/main/presenter/agentRuntimePresenter/dispatch.ts`

### Missing Functionality

#### 5.1 Tool Call Execution Flow

**Gap**: No permission integration.

**Old Architecture:**
```
1. LLM emits tool_use
2. ToolCallHandler.interceptToolCalls()
3. For each tool call:
   a. Check if tool requires permission (filesystem, MCP)
   b. Check whitelist (if remember: true previously)
   c. If not whitelisted → create permission request block
   d. Emit to renderer, wait for user approval
   e. On approval → execute tool
   f. On reject → skip tool, add error block
```

**New Architecture:**
```
1. LLM emits tool_use
2. accumulate() adds tool_call blocks
3. executeTools() loops through completedToolCalls
4. For each tool call:
   a. NO permission check ❌
   b. NO whitelist check ❌
   c. Directly call toolPresenter.callTool() ❌
   d. Add response to conversation
   e. Update block status
```

**Critical**: `executeTools()` line 118-145 in `dispatch.ts`:
```typescript
for (const tc of state.completedToolCalls) {
  // ... build toolCall object ...
  
  try {
    const { rawData } = await toolPresenter.callTool(toolCall)  // ← NO PERMISSION CHECK
    const responseText = toolResponseToText(rawData.content)
    // ... add to conversation ...
  } catch (err) {
    // ... handle error ...
  }
}
```

#### 5.2 Permission Integration

**Status**: ❌ Completely missing

See Section 2 for full details.

#### 5.3 Error Handling

**Status**: ✅ Partially implemented

**Implemented:**
- ✅ Tool execution errors caught and added to conversation
- ✅ Error blocks created in `finalizeError()`
- ✅ `STREAM_EVENTS.ERROR` emitted

**Missing:**
- ❌ No distinction between "user rejected" vs "tool failed"
- ❌ No retry mechanism for failed tools
- ❌ No error recovery (stream continues even after critical errors)

#### 5.4 Result Processing

**Status**: ✅ Implemented

**Notes:**
- `toolResponseToText()` converts MCP content to text
- Tool responses added to conversation as `role: 'tool'` messages
- Blocks updated with response text

#### 5.5 Context Building

**Status**: ✅ Implemented

**Notes:**
- `contextBuilder.ts` builds message context
- Includes system prompt, message history
- Respects `contextLength` and `maxTokens` limits

### Tool Execution Flow Diagram

```
OLD ARCHITECTURE:
┌────────────────┐
│ LLM Tool Call  │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ ToolCallHandler│
│ intercept()    │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Permission     │
│ Check          │
└───────┬────────┘
        │
   ┌────┴────┐
   │         │
   ▼         ▼
┌──────┐  ┌──────────┐
│ Auto │  │ Ask User │
│ Run  │  │ (pause)  │
└──┬───┘  └────┬─────┘
   │           │
   └─────┬─────┘
         │
         ▼
┌────────────────┐
│ Execute Tool   │
│ Update Blocks  │
└────────────────┘

NEW ARCHITECTURE (CURRENT):
┌────────────────┐
│ LLM Tool Call  │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ accumulate()   │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ executeTools() │
│ (NO PERMISSION)│
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ toolPresenter  │
│ .callTool()    │
└────────────────┘
```

### Required Implementation

1. **Add permission check before tool execution:**
   ```typescript
   // dispatch.ts executeTools()
   for (const tc of state.completedToolCalls) {
     // NEW: Check permission
     const permission = await io.permissionChecker.check(
       io.sessionId,
       tc.name,
       tc.arguments
     )
     
     if (permission.status === 'pending') {
       // Create permission request block
       const permissionBlock: AssistantMessageBlock = {
         type: 'action',
         action_type: 'tool_call_permission',
         tool_call: { ...tc },
         extra: {
           serverName: toolDef.server.name,
           permissionType: getPermissionType(tc.name),
           requiresApproval: true
         },
         status: 'pending',
         timestamp: Date.now()
       }
       state.blocks.push(permissionBlock)
       
       // Flush to renderer
       eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
         conversationId: io.sessionId,
         blocks: JSON.parse(JSON.stringify(state.blocks))
       })
       
       // PAUSE stream - set session to 'paused'
       io.messageStore.updateAssistantContent(io.messageId, state.blocks)
       return { paused: true, pendingToolCall: tc }
     }
     
     // Auto-approve if whitelisted or full access mode
     if (permission.status === 'approved') {
       // Execute tool
     }
   }
   ```

2. **Add resume method:**
   ```typescript
   // agentRuntimePresenter/index.ts
   async resumeAfterPermission(
     sessionId: string,
     messageId: string,
     toolCallId: string,
     granted: boolean
   ): Promise<void> {
     // Resume stream processing
     // If granted: execute tool
     // If rejected: add error block, continue or stop
   }
   ```

3. **Update processStream to handle pause/resume:**
   ```typescript
   // processStream needs to be async generator or use callbacks
   // to support pausing mid-stream
   ```

---

## Implementation Priority

### P0: Critical (MVP Blockers)

1. **Permission Mode Selection**
   - Add `permission_mode` to new_sessions table
   - Add permission dropdown to ChatStatusBar
   - Pass permissionMode to createSession()
   - Store and retrieve permission mode

2. **Permission Check Integration**
   - Create PermissionChecker class
   - Integrate into executeTools() before tool calls
   - Create permission request blocks
   - Pause stream waiting for approval

3. **Permission Response Handler**
   - Add `handlePermissionResponse()` to agentSessionPresenter
   - Implement resume mechanism after approval
   - Update session status ('paused' → 'generating')

4. **Whitelist Management**
   - Add whitelist table/session-scoped storage
   - Implement "remember this permission" logic
   - Check whitelist before asking user

5. **Full Access Boundary Enforcement**
   - Validate projectDir before allowing full access
   - Enforce projectDir boundary in tool execution
   - Reject operations outside projectDir

### P1: High (Core Functionality)

6. **Session Configuration Extension**
   - Add temperature, contextLength, maxTokens to createSession
   - Persist in session record
   - Apply during initSession

7. **Edit User Message**
   - Add `editUserMessage(sessionId, messageId, newContent)`
   - Delete all messages after edited message
   - Trigger regenerate

8. **Retry/Regenerate (No Variants)**
   - Add `retryMessage(sessionId, messageId)`
   - Append new assistant message (no variants)
   - Manage message boundaries

9. **Fork Session**
   - Add `forkSessionFromMessage(sessionId, messageId)`
   - Copy messages up to fork point
   - Create new session with continued conversation

10. **Frontend Permission UI**
    - Ensure MessageList renders permission blocks
    - Connect approve/reject buttons to agentSessionPresenter
    - Add "remember" checkbox

### P2: Medium (Nice to Have)

11. **Session Status 'paused'**
    - Add 'paused' status for permission wait state
    - Update UI to show paused indicator

12. **Model Configuration UI**
    - Add feedback if no model configured
    - Deep-link to settings page

13. **Error Recovery**
    - Distinguish user-rejected vs tool-failed
    - Add retry option for failed tools

14. **Permission Whitelist UI**
    - View/manage session whitelists
    - Clear all permissions option

---

## Migration Strategy

### Phase 1: Core Infrastructure (Week 1-2)

**Goal**: Enable permission flow end-to-end

1. Database schema updates:
   - Add `permission_mode` to new_sessions
   - Create `permission_whitelists` table

2. Backend permission infrastructure:
   - Create PermissionChecker class
   - Add handlePermissionResponse() IPC
   - Implement pause/resume in processStream

3. Frontend permission UI:
   - Update ChatStatusBar with permission dropdown
   - Ensure permission blocks render in MessageList

**Deliverable**: Users can create sessions with permission mode, approve/reject tool permissions

### Phase 2: Session Configuration (Week 3)

**Goal**: Full session customization

1. Extend createSession() with all config options
2. Update NewThreadPage with advanced settings (optional/collapsible)
3. Persist and apply configuration

**Deliverable**: Users can configure temperature, context length, max tokens at session creation

### Phase 3: Message Operations (Week 4)

**Goal**: Edit, retry, fork capabilities

1. Implement editUserMessage()
2. Implement retryMessage() (no variants)
3. Implement forkSessionFromMessage()
4. Frontend UI for message actions

**Deliverable**: Full message lifecycle management

### Phase 4: Polish and Testing (Week 5)

**Goal**: Production readiness

1. Integration testing: full permission flow
2. Edge cases: concurrent permissions, session cleanup
3. Performance: whitelist lookup optimization
4. Documentation: update spec.md, plan.md, tasks.md

**Deliverable**: MVP ready for release

---

## Appendix: File Reference Map

### Old Architecture Files

| Component | File Path |
|-----------|-----------|
| AgentPresenter | `src/main/presenter/agentPresenter/index.ts` |
| PermissionHandler | `src/main/presenter/agentPresenter/permission/permissionHandler.ts` |
| ToolCallHandler | `src/main/presenter/agentPresenter/loop/toolCallHandler.ts` |
| SessionPresenter | `src/main/presenter/sessionPresenter/index.ts` |
| ChatStore | `src/renderer/src/stores/chat.ts` |
| ChatStatusBar | `src/renderer/src/components/chat/ChatStatusBar.vue` |

### New Architecture Files

| Component | File Path |
|-----------|-----------|
| AgentSessionPresenter | `src/main/presenter/agentSessionPresenter/index.ts` |
| AgentRuntimePresenter | `src/main/presenter/agentRuntimePresenter/index.ts` |
| ProcessStream | `src/main/presenter/agentRuntimePresenter/process.ts` |
| Dispatch | `src/main/presenter/agentRuntimePresenter/dispatch.ts` |
| MessageStore | `src/main/presenter/agentRuntimePresenter/messageStore.ts` |
| SessionStore (UI) | `src/renderer/src/stores/ui/session.ts` |
| MessageStore (UI) | `src/renderer/src/stores/ui/message.ts` |
| NewThreadPage | `src/renderer/src/pages/NewThreadPage.vue` |
| ChatPage | `src/renderer/src/pages/ChatPage.vue` |
| ChatStatusBar | `src/renderer/src/components/chat/ChatStatusBar.vue` |

### Database Tables

| Table | Purpose | Status |
|-------|---------|--------|
| new_sessions | Session storage (new arch) | ✅ Created |
| deepchat_messages | Message storage (new arch) | ✅ Created |
| conversations | Session storage (old arch) | ⚠️ Legacy |
| messages | Message storage (old arch) | ⚠️ Legacy |
| permission_whitelists | Permission whitelist | ❌ Not created |

---

## Document History

- **2026-02-28**: Initial gap analysis created
- **Author**: Subagent (document-arch-gap-analysis)
- **Review Status**: Pending Claude review
