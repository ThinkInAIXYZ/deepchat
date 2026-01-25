# Tasks: Agentic Presenter Renderer Integration

## Overview

This document breaks down the integration into ordered, executable tasks. Each task is designed to be small enough to be completed in a single work session and validated independently.

**Total Estimated Tasks**: 47-50
**Suggested Workflow**: Complete tasks sequentially within each phase

---

## Phase 1: Foundation (New Composables)

### Task 1.1: Create `useAgenticSession` Composable

**File**: `src/renderer/src/composables/agentic/useAgenticSession.ts`

**Description**: Create composable that exposes reactive `SessionInfo` for a given session.

**Steps**:
1. Create `src/renderer/src/composables/agentic/` directory
2. Create `useAgenticSession.ts`
3. Import `usePresenter` and `AgenticPresenter`
4. Define function signature: `useAgenticSession(sessionId: () => string | null)`
5. Create `sessionInfo` ref from `agenticP.getSession(sessionId())`
6. Create computed properties: `agentId`, `status`, `availableModes`, `currentModeId`, `availableModels`, `currentModelId`, `availableCommands`, `workspace`, `capabilities`
7. Create convenience computed: `hasWorkspace`, `supportsModes`, `supportsCommands`, `isGenerating`, `hasError`
8. Implement `loadSessionInfo()` function
9. Add `watch` on `sessionId()` to reload session info
10. Export all properties and functions

**Acceptance Criteria**:
- [ ] File exists at specified location
- [ ] TypeScript compiles without errors
- [ ] JSDoc comments added for public API
- [ ] Export matches specification in `plan.md` Phase 1.1

**Related**: `plan.md` Phase 1.1

---

### Task 1.2: Create `useAgenticEvents` Composable

**File**: `src/renderer/src/composables/agentic/useAgenticEvents.ts`

**Description**: Create composable for type-safe `AgenticEventType` subscription.

**Steps**:
1. Create `useAgenticEvents.ts`
2. Import `eventBus`, `AgenticEventType`, event types
3. Define function signature with handlers object parameter
4. Create `unsubscribers` array
5. Implement conditional subscription for each event type
6. Add `onUnmounted` cleanup
7. Return `unsubscribe` function
8. Add JSDoc comments

**Acceptance Criteria**:
- [ ] File exists
- [ ] TypeScript compiles
- [ ] All `AgenticEventType` events supported
- [ ] Cleanup on unmount implemented

**Related**: `plan.md` Phase 1.2

---

### Task 1.3: Create `useAgenticAdapter` Composable

**File**: `src/renderer/src/composables/agentic/useAgenticAdapter.ts`

**Description**: Create composable for agent discovery and full message execution interface.

**Interface**:
```typescript
interface AgenticAdapter {
  // Agent Discovery
  agents: Computed<AgentInfo[]>
  deepchatAgents: Computed<AgentInfo[]>
  acpAgents: Computed<AgentInfo[]>
  getAgent(agentId: string): AgentInfo | undefined

  // Message Execution
  sendMessage(sessionId: string, content: MessageContent, selectedVariants?: Record<string, string>): Promise<AssistantMessage>
  continueLoop(sessionId: string, messageId: string, selectedVariants?: Record<string, string>): Promise<AssistantMessage>
  cancelLoop(sessionId: string, messageId: string): Promise<void>
  retryMessage(sessionId: string, messageId: string, selectedVariants?: Record<string, string>): Promise<AssistantMessage>
  regenerateFromUserMessage(sessionId: string, userMessageId: string, selectedVariants?: Record<string, string>): Promise<AssistantMessage>
}
```

**Steps**:
1. Create `useAgenticAdapter.ts`
2. Import `usePresenter` and `AgenticPresenter`
3. Implement agent discovery methods (`agents`, `deepchatAgents`, `acpAgents`, `getAgent`)
4. Implement message execution methods (`sendMessage`, `continueLoop`, `cancelLoop`, `retryMessage`, `regenerateFromUserMessage`)
5. Add JSDoc comments for all methods
6. Export all

**Acceptance Criteria**:
- [ ] File exists
- [ ] TypeScript compiles
- [ ] Agent filtering works correctly
- [ ] All message execution methods delegate to `AgenticPresenter`

**Related**: `plan.md` Phase 1.3, `state-management-refactoring-spec.md` Part 4.4

---

### Task 1.5: Create `useSessionConfig` Composable

**File**: `src/renderer/src/composables/agentic/useSessionConfig.ts`

**Description**: Create SessionInfo-driven configuration composable.

**Steps**:
1. Create `useSessionConfig.ts`
2. Import `usePresenter` and `useAgenticSession`
3. Implement methods to get/set session configuration from `SessionInfo`
4. Implement `setModel(sessionId, modelId)` via `AgenticPresenter`
5. Implement `setMode(sessionId, modeId)` via `AgenticPresenter`
6. Implement workspace getters/setters (agent-specific behavior)
7. Export all

**Acceptance Criteria**:
- [ ] File exists
- [ ] TypeScript compiles
- [ ] Methods delegate to `AgenticPresenter`
- [ ] Works with both DeepChat and ACP agents

**Related**: `state-management-refactoring-spec.md` Part 4.3

---

### Task 1.6: Create `useSessionExport` Composable

**File**: `src/renderer/src/composables/agentic/useSessionExport.ts`

**Description**: Create sessionId-based export composable.

**Steps**:
1. Create `useSessionExport.ts`
2. Implement export methods using `sessionId`
3. Reuse existing export logic with new terminology
4. Export all

**Acceptance Criteria**:
- [ ] File exists
- [ ] TypeScript compiles
- [ ] Export functionality preserved

**Related**: `state-management-refactoring-spec.md` Part 4.3

---

### Task 1.4: Create `useAgenticSessionStore` Composable

**File**: `src/renderer/src/composables/agentic/useAgenticSessionStore.ts`

**Description**: Create new store with flat sessions array (alongside old store).

**Steps**:
1. Create `useAgenticSessionStore.ts`
2. Define state: `activeSessionId`, `sessions`, `sessionMetadata`, `generatingSessionIds`, `sessionsWorkingStatus`
3. Create `activeSession` computed
4. Create `isGenerating` computed
5. Implement actions: `addSession`, `updateSession`, `removeSession`, `setGenerating`
6. Export all

**Acceptance Criteria**:
- [ ] File exists
- [ ] TypeScript compiles
- [ ] Actions properly update state
- [ ] Old `useChatStoreService` unchanged

**Related**: `plan.md` Phase 6

---

## Phase 2: Terminology Migration

### Task 2.1: Update Type Definitions - Shared Types

**Files**: `src/shared/types/`, `src/renderer/src/types/`

**Description**: Replace `threadId`/`conversationId` with `sessionId` in type definitions.

**Steps**:
1. Search for `threadId` and `conversationId` in type files
2. Replace in type aliases, interfaces, type parameters
3. Keep `conversationId` in database-related types (SQLite)
4. Run `pnpm run typecheck` to validate

**Acceptance Criteria**:
- [ ] Zero `threadId` in renderer type definitions
- [ ] Zero `conversationId` in renderer type definitions
- [ ] `conversationId` preserved in database types
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 2, Batch 1

---

### Task 2.2: Update State Variables - useChatStoreService

**File**: `src/renderer/src/composables/chat/useChatStoreService.ts`

**Description**: Rename state variables in the store.

**Steps**:
1. Rename `activeThreadId` → `activeSessionId`
2. Rename `threads` → `sessions` (temporary, will restructure in Phase 6)
3. Rename `generatingThreadIds` → `generatingSessionIds`
4. Rename `threadsWorkingStatus` → `sessionsWorkingStatus`
5. Update all internal references
6. Update exported interface
7. Run typecheck

**Acceptance Criteria**:
- [ ] All state variables renamed
- [ ] All internal references updated
- [ ] TypeScript compiles
- [ ] No runtime errors

**Related**: `plan.md` Phase 2, Batch 2

---

### Task 2.3: Rename Composable Files

**Files**: `src/renderer/src/composables/chat/`

**Description**: Rename composable files to new naming convention.

**Steps**:
1. Rename `useThreadManagement.ts` → `useSessionManagement.ts`
2. Update import statements in all files that import it
3. Update class/function name within file
4. Run typecheck

**Acceptance Criteria**:
- [ ] File renamed
- [ ] All imports updated
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 2, Batch 3

---

### Task 2.4: Update Component Props and Emits

**Files**: `src/renderer/src/components/`

**Description**: Update component props/emits that use old terminology.

**Steps**:
1. Search for `threadId` in component files
2. Replace prop names: `threadId` → `sessionId`
3. Replace emit names: `@thread-select` → `@session-select`
4. Update handler functions
5. Update template usage

**Acceptance Criteria**:
- [ ] No `threadId` props in components
- [ ] No `@thread-*` emits
- [ ] Templates updated
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 2, Batch 4

---

### Task 2.5: Global Find-Replace Remaining References

**Files**: All renderer files

**Description**: Final pass to replace remaining `threadId`/`conversationId`.

**Steps**:
1. Global search for `threadId` in renderer
2. Context-sensitive replacement
3. Global search for `conversationId` in renderer
4. Replace except in comments/documentation
5. Run `pnpm run typecheck`
6. Run `pnpm run lint`

**Acceptance Criteria**:
- [ ] Zero `threadId` in renderer code
- [ ] Zero `conversationId` in renderer code (except comments)
- [ ] TypeScript compiles
- [ ] Linting passes

**Related**: `plan.md` Phase 2, Batch 6

---

## Phase 3: Event System Migration

### Task 3.1: Audit Current Event Listeners

**Description**: Document all current event listeners in renderer.

**Steps**:
1. Search for all `eventBus.on()` calls in renderer
2. Document each listener: file, event type, handler
3. Create mapping table of old → new events

**Deliverable**: Event listener audit document

**Acceptance Criteria**:
- [ ] All listeners documented
- [ ] Mapping table created

**Related**: `plan.md` Phase 3, Step 3.1

---

### Task 3.2: Replace STREAM_EVENTS Listeners

**Files**: `src/renderer/src/composables/chat/useChatEvents.ts` and related

**Description**: Replace `STREAM_EVENTS` with `AgenticEventType.MESSAGE_*`.

**Steps**:
1. Find all `STREAM_EVENTS.RESPONSE` listeners
2. Replace with `AgenticEventType.MESSAGE_DELTA`
3. Update handler to process new payload structure
4. Find all `STREAM_EVENTS.END` listeners
5. Replace with `AgenticEventType.MESSAGE_END`
6. Find all `STREAM_EVENTS.ERROR` listeners
7. Replace with `AgenticEventType.ERROR`
8. Remove `STREAM_EVENTS` imports

**Acceptance Criteria**:
- [ ] No `STREAM_EVENTS` listeners in renderer
- [ ] Handlers updated for new payloads
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 3

---

### Task 3.3: Replace ACP_WORKSPACE_EVENTS Listeners

**Files**: `src/renderer/src/composables/chat/` and related

**Description**: Replace ACP workspace events with `AgenticEventType.SESSION_UPDATED`.

**Steps**:
1. Find all `ACP_WORKSPACE_EVENTS.SESSION_MODES_READY` listeners
2. Replace with `AgenticEventType.SESSION_UPDATED`
3. Update handler to check `event.availableModes`
4. Find all `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` listeners
5. Replace with `AgenticEventType.SESSION_UPDATED`
6. Update handler to check `event.availableModels`
7. Find all `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` listeners
8. Replace with `AgenticEventType.SESSION_UPDATED`
9. Update handler to check `event.availableCommands`
10. Remove `ACP_WORKSPACE_EVENTS` imports

**Acceptance Criteria**:
- [ ] No `ACP_WORKSPACE_EVENTS` listeners in renderer
- [ ] Handlers check for specific payload fields
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 3

---

### Task 3.4: Update useAgenticEvents Implementation

**File**: `src/renderer/src/composables/agentic/useAgenticEvents.ts`

**Description**: Complete implementation of all event subscriptions.

**Steps**:
1. Add all missing event type subscriptions
2. Implement proper type narrowing for discriminated unions
3. Add error handling for malformed events
4. Test with manual event emission

**Acceptance Criteria**:
- [ ] All `AgenticEventType` events supported
- [ ] Type-safe event handlers
- [ ] Error handling in place

**Related**: `plan.md` Phase 1.2, Phase 3

---

## Phase 4: Components

### Task 4.1: Create AgentHeader Component

**File**: `src/renderer/src/components/chat-input/AgentHeader.vue`

**Description**: Implement component displaying agent info, status, capabilities, and workspace.

**Props**:
```typescript
interface Props {
  sessionId: string
  compact?: boolean           // Default: false
  showStatus?: boolean        // Default: true
  showCapabilities?: boolean  // Default: true
  showWorkspace?: boolean     // Default: true
}
```

**Steps**:
1. Create component file with `<script setup>` syntax
2. Define props: `sessionId`, `compact`, `showStatus`, `showCapabilities`, `showWorkspace`
3. Define emits: `config-click`, `workspace-click`, `retry-click`
4. Use `useAgenticSession` composable for data
5. Implement template with agent icon, name, status indicator
6. Add capability badges (Vision, Tools, Modes, Commands count)
7. Add workspace display with truncation
8. Add status pulse animation (CSS)
9. Add i18n for all user-facing strings
10. Add tooltips for compact mode

**Acceptance Criteria**:
- [ ] Component renders correctly
- [ ] All props work as expected
- [ ] Emits work as expected
- [ ] Status indicator shows correct state
- [ ] Pulse animation for generating state
- [ ] Capability badges display correctly
- [ ] Workspace path truncated with `~`
- [ ] i18n strings used

**Related**: `plan.md` Phase 4.1, `unified-components-specification.md` Part II

---

### Task 4.2: Create UnifiedModelSelector Component

**File**: `src/renderer/src/components/chat/UnifiedModelSelector.vue`

**Description**: Implement agent-agnostic model selection dropdown.

**Steps**:
1. Create component file
2. Define props: `sessionId`, `disabled`, `showProvider`
3. Define emits: `model-select`
4. Use `useAgenticSession` for availableModels/currentModelId
5. Implement dropdown UI
6. Add provider prefix display for DeepChat models
7. Handle model selection
8. Call presenter `setModel()` when selection changes
9. Add i18n strings

**Acceptance Criteria**:
- [ ] Works with DeepChat agents (shows provider prefix)
- [ ] Works with ACP agents (no prefix)
- [ ] Emits event on selection
- [ ] Updates current model
- [ ] Disabled state works

**Related**: `plan.md` Phase 4.2, `unified-components-specification.md` Part III

---

### Task 4.3: Create UnifiedModeSelector Component

**File**: `src/renderer/src/components/chat/UnifiedModeSelector.vue`

**Description**: Implement agent-agnostic mode/permission policy selection.

**Steps**:
1. Create component file
2. Define props: `sessionId`, `showDescription`
3. Define emits: `mode-select`
4. Use `useAgenticSession` for availableModes/currentModeId
5. Only render when `supportsModes` is true
6. Implement dropdown UI
7. Add description in tooltip (D-030)
8. Handle mode selection
9. Call presenter `setMode()` when selection changes
10. Add i18n strings

**Acceptance Criteria**:
- [ ] Only visible when agent supports modes
- [ ] Works with DeepChat agents (permission policies)
- [ ] Works with ACP agents (execution modes)
- [ ] Tooltip shows mode description
- [ ] Updates current mode

**Related**: `plan.md` Phase 4.3, `unified-components-specification.md` Part IV

---

### Task 4.4: Create WorkspaceSelector Component

**File**: `src/renderer/src/components/chat/WorkspaceSelector.vue`

**Description**: Implement workspace selection with agent-specific behavior.

**Steps**:
1. Create component file
2. Define props: `sessionId`, `editable`, `compact`
3. Define emits: `workspace-change`
4. Use `useAgenticSession` for workspace
5. Implement display with `~` truncation
6. Detect agent type from `agentId`
7. For DeepChat: allow editing
8. For ACP: show error on edit attempt (D-028)
9. Add i18n strings and error messages

**Acceptance Criteria**:
- [ ] Shows workspace path
- [ ] Path truncated with `~`
- [ ] DeepChat: editable
- [ ] ACP: shows error on edit attempt
- [ ] Error message is user-friendly

**Related**: `plan.md` Phase 4.4, `unified-components-specification.md` Part V

---

### Task 4.5: Create CommandsDisplay Component

**File**: `src/renderer/src/components/chat/CommandsDisplay.vue`

**Description**: Implement ACP commands display component.

**Steps**:
1. Create component file
2. Define props: `sessionId`
3. Define emits: `command-insert`
4. Use `useAgenticSession` for availableCommands
5. Only render when commands exist
6. Implement collapsible list (max 5 visible)
7. Show command name, description, input hint
8. Handle click to insert template
9. Add i18n strings

**Acceptance Criteria**:
- [ ] Only visible when commands available
- [ ] Shows all command info
- [ ] Collapsible after 5 items
- [ ] Click emits template string
- [ ] Updates dynamically

**Related**: `plan.md` Phase 4.5, `acp-commands-specification.md` Part VI

---

### Task 4.6: Integrate Components in ChatInput

**File**: `src/renderer/src/components/chat/ChatInput.vue`

**Description**: Replace old components with new unified components.

**Steps**:
1. Remove `AcpModeSelector` component (if present)
2. Remove `ModelSelector` component (if present)
3. Remove agent-type branching logic
4. Add `AgentHeader` component
5. Add `UnifiedModelSelector` component
6. Add `UnifiedModeSelector` component
7. Add `WorkspaceSelector` component
8. Add `CommandsDisplay` component
9. Wire up event handlers to call presenter methods

**Acceptance Criteria**:
- [ ] Old components removed
- [ ] New components integrated
- [ ] No agent-type branching in template
- [ ] All events handled correctly
- [ ] Layout looks correct

**Related**: `plan.md` Phase 4, Component Integration

---

### Task 4.7: Remove Old Components

**Files**: `src/renderer/src/components/chat/AcpModeSelector.vue`, `AcpSessionModelSelector.vue`, `ModelSelector.vue` (old)

**Description**: Delete old component files.

**Steps**:
1. Verify no imports of old components
2. Delete `AcpModeSelector.vue`
3. Delete `AcpSessionModelSelector.vue`
4. Delete old `ModelSelector.vue` (if separate from new)
5. Run `pnpm run typecheck`

**Acceptance Criteria**:
- [ ] Files deleted
- [ ] No broken imports
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 6, Cleanup

---

## Phase 5: Composables

### Task 5.1: Create useSessionManagement Composable

**File**: `src/renderer/src/composables/agentic/useSessionManagement.ts`

**Description**: Implement session lifecycle management composable.

**Steps**:
1. Create file
2. Import `usePresenter`
3. Implement `createSession(agentId, config)`
4. Implement `loadSession(sessionId, context)`
5. Implement `closeSession(sessionId)`
6. Implement `setActiveSession(sessionId)`
7. Add JSDoc comments
8. Export all

**Acceptance Criteria**:
- [ ] All methods implemented
- [ ] Uses `AgenticPresenter`
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 5, Example

---

### Task 5.2: Migrate Consumers to useSessionManagement

**Files**: Components and views that use old session management

**Description**: Replace old session management with new composable.

**Steps**:
1. Find all imports of `useThreadManagement`
2. Replace with `useSessionManagement`
3. Update method calls
4. Update variable names
5. Test each component

**Acceptance Criteria**:
- [ ] All consumers updated
- [ ] No imports of old composable
- [ ] All functionality preserved

**Related**: `plan.md` Phase 5

---

### Task 5.3: Migrate Consumers to useAgenticAdapter

**Files**: Components and views that use `useChatAdapter`

**Description**: Replace old adapter with new composable.

**Steps**:
1. Find all imports of `useChatAdapter`
2. Replace with `useAgenticAdapter`
3. Update property accesses
4. Test each component

**Acceptance Criteria**:
- [ ] All consumers updated
- [ ] No imports of old composable
- [ ] Agent listing works

**Related**: `plan.md` Phase 5

---

### Task 5.4: Migrate Consumers to useAgenticEvents

**Files**: Components that use `useChatEvents`

**Description**: Replace old events composable with new one.

**Steps**:
1. Find all imports of `useChatEvents`
2. Replace with `useAgenticEvents`
3. Update event handler signatures
4. Update handler logic for new payloads
5. Test event flows

**Acceptance Criteria**:
- [ ] All consumers updated
- [ ] Event handlers receive correct payloads
- [ ] All event flows work

**Related**: `plan.md` Phase 5

---

### Task 5.5: Migrate Consumers to useAgenticExecution

**Files**: Components that use `useExecutionAdapter`

**Description**: Replace old execution composable with new one.

**Steps**:
1. Find all imports of `useExecutionAdapter`
2. Replace with `useAgenticExecution`
3. Update method calls
4. Test execution flows

**Acceptance Criteria**:
- [ ] All consumers updated
- [ ] Message execution works
- [ ] Cancel works

**Related**: `plan.md` Phase 5

---

### Task 5.6: Migrate Consumers to useSessionConfig

**Files**: Components and views that use `useChatConfig`

**Description**: Replace old config composable with new one.

**Steps**:
1. Find all imports of `useChatConfig`
2. Replace with `useSessionConfig`
3. Update property accesses (now SessionInfo-driven)
4. Test each component

**Acceptance Criteria**:
- [ ] All consumers updated
- [ ] No imports of old composable
- [ ] Configuration works correctly

**Related**: `state-management-refactoring-spec.md` Part 4.3

---

### Task 5.7: Migrate Consumers to useSessionExport

**Files**: Components and views that use `useThreadExport`

**Description**: Replace old export composable with new one.

**Steps**:
1. Find all imports of `useThreadExport`
2. Replace with `useSessionExport`
3. Update method calls (sessionId-based)
4. Test export functionality

**Acceptance Criteria**:
- [ ] All consumers updated
- [ ] No imports of old composable
- [ ] Export functionality works

**Related**: `state-management-refactoring-spec.md` Part 4.3

---

### Task 5.8: Delete Old Composables

**Files**: `useThreadManagement.ts`, `useThreadExport.ts`, `useChatAdapter.ts`, `useChatConfig.ts`, `useChatEvents.ts`, `useExecutionAdapter.ts`

**Description**: Remove old composables after migration.

**Steps**:
1. Verify no imports of old composables
2. Delete `useThreadManagement.ts`
3. Delete `useThreadExport.ts`
4. Delete `useChatAdapter.ts`
5. Delete `useChatConfig.ts`
6. Delete `useChatEvents.ts`
7. Delete `useExecutionAdapter.ts`
8. Run `pnpm run typecheck`

**Acceptance Criteria**:
- [ ] Files deleted
- [ ] No broken imports
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 6, Cleanup

---

## Phase 6: Store & Cleanup

### Task 6.1: Migrate to useAgenticSessionStore

**File**: `src/renderer/src/composables/chat/useChatStoreService.ts` → delete

**Description**: Replace old store with new unified store.

**Steps**:
1. Find all imports of `useChatStoreService`
2. Replace with `useAgenticSessionStore`
3. Update state property accesses
4. Update method calls
5. Update computed properties
6. Test state-driven components

**Acceptance Criteria**:
- [ ] All consumers updated
- [ ] State works correctly
- [ ] Reactive updates work

**Related**: `plan.md` Phase 6

---

### Task 6.2: Delete useChatStoreService

**File**: `src/renderer/src/composables/chat/useChatStoreService.ts`

**Description**: Remove old store after migration.

**Steps**:
1. Verify no imports of old store
2. Delete `useChatStoreService.ts`
3. Run `pnpm run typecheck`

**Acceptance Criteria**:
- [ ] File deleted
- [ ] No broken imports
- [ ] TypeScript compiles

**Related**: `plan.md` Phase 6, Cleanup

---

### Task 6.3: Remove Unused Event Constants

**Files**: `src/shared/constants/events.ts`, renderer event imports

**Description**: Clean up unused event constants from renderer.

**Steps**:
1. Search for `STREAM_EVENTS` usage in renderer
2. If none found, remove imports
3. Search for `ACP_WORKSPACE_EVENTS` usage in renderer
4. If none found, remove imports
5. Keep constants in main process (still used by presenters)

**Acceptance Criteria**:
- [ ] No unused event imports in renderer
- [ ] Constants preserved in main process

**Related**: `plan.md` Phase 6, Cleanup

---

### Task 6.4: Final Validation

**Description**: Complete validation of integration.

**Steps**:
1. Run `pnpm run typecheck` - no errors
2. Run `pnpm run lint` - no errors
3. Run `pnpm run format` - ensure formatting
4. Manual testing checklist (see below)
5. Unit tests pass
6. E2E tests pass (if applicable)

**Acceptance Criteria**:
- [ ] All quality checks pass
- [ ] Manual testing complete
- [ ] All tests pass

**Related**: `plan.md` Testing Strategy

---

## Manual Testing Checklist

### Session Management

- [ ] Create new DeepChat session
- [ ] Create new ACP session with workspace
- [ ] Load existing DeepChat session
- [ ] Load existing ACP session (falls back to creation)
- [ ] Close DeepChat session (persists)
- [ ] Close ACP session (cleanup)
- [ ] Switch between multiple sessions

### Model & Mode Selection

- [ ] Change model in DeepChat session
- [ ] Change model in ACP session
- [ ] Change mode in DeepChat session (permission policy)
- [ ] Change mode in ACP session (execution mode)
- [ ] Verify `SESSION_UPDATED` events emitted

### Workspace

- [ ] Set workspace on DeepChat session creation
- [ ] Change workspace in active DeepChat session
- [ ] Set workspace on ACP session creation (required)
- [ ] Attempt to change workspace in ACP session (error)
- [ ] Verify workspace display with `~` truncation

### Commands (ACP)

- [ ] View commands in ACP session
- [ ] Click command to insert template
- [ ] Verify commands update dynamically
- [ ] Verify commands clear on session close

### Status & Errors

- [ ] Verify status indicator shows "idle"
- [ ] Send message, verify status changes to "generating"
- [ ] Verify pulse animation during generation
- [ ] Wait for response, verify status returns to "idle"
- [ ] Trigger error, verify status shows "error"
- [ ] Verify error message displayed

### Agent Switching

- [ ] Create DeepChat session
- [ ] Create ACP session
- [ ] Switch between sessions
- [ ] Verify components update for each agent type
- [ ] Verify no agent-type labels visible

### Multi-Window/Tab

- [ ] Open session in new tab
- [ ] Verify session state syncs
- [ ] Close tab, verify session persists

---

## Post-Integration Tasks

### Task 7.1: Update Documentation

**Files**: `docs/`, README files

**Description**: Update documentation to reflect new architecture.

**Steps**:
1. Update architecture diagrams
2. Update component documentation
3. Update composable documentation
4. Add migration notes (if needed for external consumers)

**Acceptance Criteria**:
- [ ] Documentation accurate
- [ ] No references to old patterns

---

### Task 7.2: Performance Review

**Description**: Review performance impact of integration.

**Steps**:
1. Profile state update frequency
2. Check for unnecessary re-renders
3. Verify event listener cleanup
4. Optimize if needed

**Acceptance Criteria**:
- [ ] No performance regressions
- [ ] Memory usage reasonable

---

### Task 7.3: Code Review Checklist

**Description**: Final review before merge.

**Checklist**:
- [ ] All tasks completed
- [ ] All acceptance criteria met
- [ ] No TODO comments left in new code
- [ ] No console errors/warnings
- [ ] i18n complete for user-facing strings
- [ ] Types properly exported
- [ ] Public APIs documented

---

## Task Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1: Foundation | 6 | ⏳ Pending |
| Phase 2: Terminology | 5 | ⏳ Pending |
| Phase 3: Event System | 4 | ⏳ Pending |
| Phase 4: Components | 7 | ⏳ Pending |
| Phase 5: Composables | 8 | ⏳ Pending |
| Phase 6: Store & Cleanup | 4 | ⏳ Pending |
| Post-Integration | 3 | ⏳ Pending |
| **Total** | **41** | |

---

## Related Documents

- Spec: `docs/specs/agentic-renderer-integration/spec.md`
- Plan: `docs/specs/agentic-renderer-integration/plan.md`
- Presenter Layer Spec: `docs/specs/agentic-unified-layer/spec.md`
- Component Specs: `docs/architecture/unified-components-specification.md`
- State Refactoring: `docs/architecture/state-management-refactoring-spec.md`
- Session Lifecycle: `docs/architecture/session-lifecycle-specification.md`
