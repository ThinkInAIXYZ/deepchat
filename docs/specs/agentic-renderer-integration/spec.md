# Spec: Agentic Presenter Renderer Integration

## Overview

This specification defines the renderer-side integration of the unified `AgenticPresenter` layer. It completes the unified agent architecture by enabling the renderer process to interact with ACP agents and DeepChat agents through a single, consistent interface.

This is the **renderer companion** to `docs/specs/agentic-unified-layer/spec.md`, which defines the presenter layer. This spec focuses on:

1. **State Management** - Migrate from `threadId`/`conversationId` terminology to unified `sessionId`
2. **Event System** - Replace fragmented event listeners with unified `AgenticEventType`
3. **Components** - Create agent-agnostic components using unified data
4. **Composables** - Reorganize composables to use `AgenticPresenter`

## Background

### Current State (Pre-Integration)

| Aspect | Current Implementation | Problem |
|--------|------------------------|---------|
| **Session Identifier** | Mix of `threadId`, `conversationId` | Terminology inconsistency |
| **State Management** | `useChatStoreService` with branching logic | Agent-type discrimination in state layer |
| **Event Listening** | `STREAM_EVENTS`, `ACP_WORKSPACE_EVENTS` | Fragmented event handling |
| **Components** | `ModelSelector`, `AcpSessionModelSelector`, `AcpModeSelector` | Duplicate components per agent type |
| **Composables** | `useChatAdapter`, `useExecutionAdapter`, `useThreadManagement` | Tightly coupled to specific presenters |

### Target State (Post-Integration)

| Aspect | Target Implementation | Benefit |
|--------|----------------------|---------|
| **Session Identifier** | `sessionId` everywhere | Consistent terminology |
| **State Management** | `useAgenticSessionStore` with `SessionInfo` | Agent-agnostic state |
| **Event Listening** | `AgenticEventType` only | Single event system |
| **Components** | `AgentHeader`, `UnifiedModelSelector`, `UnifiedModeSelector`, `WorkspaceSelector` | Single component per concern |
| **Composables** | `useAgenticSession`, `useAgenticAdapter`, `useSessionManagement` | Unified presenter usage |

## Goals

### Primary Goals

1. **Unified Interface**: Renderer interacts with all agent types through `AgenticPresenter` only
2. **Terminology Consistency**: Eliminate `threadId`/`conversationId` confusion, use `sessionId` everywhere
3. **Event Unification**: Listen only to `AgenticEventType`, no native event leakage
4. **Component Unification**: Single set of components that work for all agent types
5. **State Simplicity**: Flat, agent-agnostic state structure

### Non-Goals

- NO changes to SQLite schema (database keeps `conversationId`)
- NO changes to ACP protocol (agent interface unchanged)
- NO backward compatibility with old event types (clean break)
- NO feature flags or gradual migration (atomic change)

## User Stories

### Story 1: Seamless Agent Switching

**As a user**, I can switch between a DeepChat agent and an ACP agent without noticing any difference in UI behavior.

**Acceptance Criteria**:
- Model selector shows available models for the active agent
- Mode selector shows available modes for the active agent
- Workspace selector adapts to agent (required for ACP, optional for DeepChat)
- No UI labels mention "ACP" or "DeepChat" (implementation detail)

### Story 2: Consistent Session Management

**As a user**, I can create, load, and close sessions using the same UI patterns regardless of agent type.

**Acceptance Criteria**:
- New session button works for all agent types
- Session list shows all sessions with unified metadata
- Closing a session works the same way (cleanup happens transparently)

### Story 3: Agent Status Visibility

**As a user**, I can see the current status of my agent (idle, generating, paused, error) with clear visual feedback.

**Acceptance Criteria**:
- Status indicator appears in session header
- Generating status shows pulse animation
- Error status shows clear error message
- Status updates immediately when agent state changes

### Story 4: Workspace Handling

**As a user**, I can select a workspace when creating a session, and the UI handles agent-specific constraints.

**Acceptance Criteria**:
- Workspace selector shown in session creation dialog
- For ACP agents: workspace is required and immutable after session creation
- For DeepChat agents: workspace is optional and can be changed anytime
- Path truncated with `~` substitution for display

### Story 5: Commands Display (ACP Agents)

**As a user**, I can see available commands exposed by ACP agents and invoke them through the chat interface.

**Acceptance Criteria**:
- Commands appear in session info panel when available
- Commands show name, description, and input hint
- Clicking a command inserts invocation template into chat input
- Commands update dynamically during agent execution

## Requirements

### Functional Requirements

#### REQ-1: Terminology Unification

- **REQ-1.1**: All renderer code SHALL use `sessionId` instead of `threadId` or `conversationId`
- **REQ-1.2**: State variables SHALL be renamed: `activeSessionId`, `sessions`, `generatingSessionIds`, `sessionsWorkingStatus`
- **REQ-1.3**: The presenter layer MAY continue to use `conversationId` internally (DeepChat SQLite)
- **REQ-1.4**: No `threadId` or `conversationId` SHALL be exposed to UI components

#### REQ-2: State Management Refactoring

- **REQ-2.1**: State SHALL use a flat `sessions: SessionInfo[]` array instead of nested `dt/dtThreads` structure
- **REQ-2.2**: A `sessionMetadata: Map<string, SessionInfo>` SHALL provide efficient lookup
- **REQ-2.3**: All agent-type branching logic SHALL be removed from state management
- **REQ-2.4**: New composable `useAgenticSession(sessionId)` SHALL expose session metadata reactively

#### REQ-3: Event System Migration

- **REQ-3.1**: Renderer SHALL listen ONLY to `AgenticEventType` events
- **REQ-3.2**: No listeners for `STREAM_EVENTS` or `ACP_WORKSPACE_EVENTS` SHALL remain in renderer
- **REQ-3.3**: `useAgenticEvents` composable SHALL provide type-safe event handling
- **REQ-3.4**: Event normalizers SHALL NOT be present in renderer (presenter responsibility)

#### REQ-4: Component Unification

- **REQ-4.1**: `AgentHeader` component SHALL display agent info (name, icon, status, capabilities)
- **REQ-4.2**: `UnifiedModelSelector` component SHALL work for all agent types
- **REQ-4.3**: `UnifiedModeSelector` component SHALL work for all agent types
- **REQ-4.4**: `WorkspaceSelector` component SHALL handle agent-specific behavior
- **REQ-4.5**: `CommandsDisplay` component SHALL show ACP agent commands
- **REQ-4.6**: All components SHALL use `useAgenticSession` composable for data access

#### REQ-5: Composable Reorganization

- **REQ-5.1**: `useAgenticSessionStore` SHALL replace `useChatStoreService`
- **REQ-5.2**: `useAgenticAdapter` SHALL replace `useChatAdapter` and provide full message execution interface
- **REQ-5.3**: `useSessionManagement` SHALL replace `useThreadManagement`
- **REQ-5.4**: `useAgenticEvents` SHALL replace `useChatEvents`
- **REQ-5.5**: `useAgenticExecution` SHALL replace `useExecutionAdapter`
- **REQ-5.6**: `useSessionConfig` SHALL replace `useChatConfig` with SessionInfo-driven configuration
- **REQ-5.7**: `useSessionExport` SHALL replace `useThreadExport` with sessionId-based export
- **REQ-5.8**: `useMessageStreaming` and `useMessageCache` SHALL remain unchanged (already agent-agnostic)
- **REQ-5.9**: `useVariantManagement` SHALL remain unchanged (already agent-agnostic)

#### REQ-6: Session Lifecycle

- **REQ-6.1**: Session creation SHALL use `agenticP.createSession(agentId, config)`
- **REQ-6.2**: Session loading SHALL use `agenticP.loadSession(sessionId, context)`
- **REQ-6.3**: Session closing SHALL use `agenticP.closeSession(sessionId)`
- **REQ-6.4**: ACP sessions SHALL be closed on app shutdown (they need cleanup)
- **REQ-6.5**: DeepChat sessions SHALL persist automatically (no explicit save needed)

### Non-Functional Requirements

#### NFR-1: Type Safety

- All new code SHALL be fully typed with TypeScript
- No `any` types SHALL be used in public interfaces
- Event payloads SHALL be typed discriminated unions

#### NFR-2: Performance

- State updates SHALL not trigger unnecessary re-renders
- Computed values SHALL be cached where appropriate
- Event listeners SHALL be cleaned up on component unmount

#### NFR-3: Code Quality

- All code MUST pass `pnpm run lint`
- All code MUST pass `pnpm run typecheck`
- All user-facing strings MUST use i18n keys

#### NFR-4: Test Coverage

- Critical composables SHALL have unit tests
- Component integration tests SHALL verify agent-agnostic behavior
- Manual testing checklist SHALL be completed before merge

## Data Models

### SessionInfo (from Presenter Layer)

```typescript
interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'

  // Workspace (D-007, D-008)
  workspace?: string

  // Modes (permission policies or execution modes)
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string

  // Models
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModelId?: string

  // Commands (ACP agents only)
  availableCommands?: Array<{
    name: string
    description?: string
    inputHint?: string
  }>

  // Capabilities
  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
    supportsCommands?: boolean
  }
}
```

### SessionConfig (for createSession)

```typescript
interface SessionConfig {
  modelId?: string
  modeId?: string
  workspace?: string
  title?: string  // DeepChat only
  // Agent-specific config via index signature
  [key: string]: unknown
}
```

### LoadContext (for loadSession)

```typescript
interface LoadContext {
  activate: boolean
  maxHistory?: number
  includeSystemMessages?: boolean
}
```

**Note**: `tabId` is not required in the LoadContext. The main process automatically obtains the caller's `webContentsId` from the IPC context and derives the `windowId` from it. Chat windows use a single WebContents architecture, so only `windowId` is needed internally for event routing.

## API Specification

### Renderer Presenter Contract

The renderer accesses `AgenticPresenter` through the preload bridge:

```typescript
// In renderer components
import { usePresenter } from '@/composables/usePresenter'

const agenticP = usePresenter().agenticPresenter

// === Session Lifecycle ===

// Create session
const sessionId = await agenticP.createSession(agentId, {
  modelId: 'anthropic:claude-3-5-sonnet',
  modeId: 'balanced',
  workspace: '/Users/user/project'
})

// Get session info
const sessionInfo = agenticP.getSession(sessionId)

// Load session (with context)
await agenticP.loadSession(sessionId, {
  activate: true,
  maxHistory: 50
})

// Close session
await agenticP.closeSession(sessionId)

// === Message Execution ===

// Send message to agent
await agenticP.sendMessage(sessionId, {
  text: 'Hello',
  images: [...],
  files: [...]
}, selectedVariants?)  // Optional variant selection

// Continue agent loop from a message
await agenticP.continueLoop(sessionId, messageId, selectedVariants?)

// Cancel ongoing generation
await agenticP.cancelLoop(sessionId, messageId)

// Retry a failed message
await agenticP.retryMessage(sessionId, messageId, selectedVariants?)

// Regenerate from user message
await agenticP.regenerateFromUserMessage(sessionId, userMessageId, selectedVariants?)

// === Session Configuration ===

// Set model for session
await agenticP.setModel(sessionId, modelId)

// Set mode for session
await agenticP.setMode(sessionId, modeId)

// === Agent Discovery ===

// Get all registered agents
const agents = agenticP.getRegisteredAgents()
```

## Architecture Decisions

This section summarizes key architectural decisions from the research phase.

| ID | Decision | Rationale | Source |
|----|----------|-----------|--------|
| D-001 | Use `sessionId` exclusively in renderer | Eliminate terminology inconsistency | `renderer-analysis-research.md` Part I Decision 1 |
| D-003 | Extend `AgenticEventType` to cover all events | Single unified event format | `renderer-analysis-research.md` Part I Decision 2 |
| D-004 | Create new components only | Clean break from legacy patterns | `renderer-analysis-research.md` Part I Decision 3 |
| D-005 | No backward compatibility layer | Direct replacement, green-field | `renderer-analysis-research.md` Part I Decision 4 |
| D-007 | Use session-scoped workspace (unified model) | Aligns with ACP, presenter abstracts difference | `workspace-integration-analysis.md` |
| D-008 | Workspace is part of SessionConfig | Specified at session creation | `workspace-integration-analysis.md` |
| D-010 | Include `availableCommands` in SessionInfo | Consistent with modes/models | `acp-commands-specification.md` |
| D-011 | Use `SESSION_UPDATED` for all session metadata | Single event for all changes | `event-payload-specification.md` |
| D-016 | Unified SessionInfo structure for modes/models | Same structure for all agents | `acp-modes-models-specification.md` |
| D-025 | All components use useAgenticSession composable | Single data source | `unified-components-specification.md` |
| D-031 | Direct find-and-replace for terminology migration | Consistent with Decision 1 | `state-management-refactoring-spec.md` |
| D-033 | Use flat sessions array instead of dt/dtThreads | Simpler data structure | `state-management-refactoring-spec.md` |
| D-034 | Add sessionMetadata Map to store SessionInfo | Efficient lookup | `state-management-refactoring-spec.md` |
| D-035 | Create new composables alongside old ones then replace | Reduces risk | `state-management-refactoring-spec.md` |
| D-039 | SessionConfig as unified interface | Single createSession() for all agents | `session-lifecycle-specification.md` |

## Integration Scope

### Files Requiring Changes

Based on the research, the following areas require changes:

| Area | Estimated Files | Description |
|------|----------------|-------------|
| **Terminology** | ~350 | Global find-replace: `threadId` → `sessionId`, `conversationId` → `sessionId` |
| **State Management** | ~15 | Store refactoring, new composables |
| **Event System** | ~20 | Event listener migration |
| **Components** | ~10 | New components, old component removal |
| **Composables** | ~8 | Composable replacement |
| **Types** | ~5 | Shared type definitions |

### Migration Strategy

The integration will follow a phased approach (detailed in `plan.md`):

1. **Phase 1**: New composables alongside old ones
2. **Phase 2**: Terminology migration (threadId → sessionId)
3. **Phase 3**: Event system migration (AgenticEventType)
4. **Phase 4**: Component implementation and replacement
5. **Phase 5**: Composable replacement
6. **Phase 6**: Store replacement and cleanup

## Dependencies

### Internal Dependencies

| Dependency | Status | Description |
|------------|--------|-------------|
| `AgenticPresenter` | ✅ Implemented | Presenter layer unified interface |
| `AgenticEventType` | ✅ Implemented | Unified event types |
| `SessionInfo` | ✅ Implemented | Unified session metadata |
| `event-payload-specification.md` | ✅ Complete | Event payload definitions |
| `workspace-implementation-plan.md` | ✅ Complete | Workspace integration design |
| `acp-commands-specification.md` | ✅ Complete | Commands UI component spec |
| `acp-modes-models-specification.md` | ✅ Complete | Modes/models UI component spec |
| `unified-components-specification.md` | ✅ Complete | Component specifications |
| `state-management-refactoring-spec.md` | ✅ Complete | State refactoring plan |
| `session-lifecycle-specification.md` | ✅ Complete | Session lifecycle design |

### External Dependencies

- Vue 3.4+ (Composition API)
- Pinia (state management)
- TypeScript 5.6+ (type safety)

## Success Criteria

1. ✅ All agent types work through `AgenticPresenter` only
2. ✅ No `threadId` or `conversationId` in renderer code
3. ✅ No native event listeners (`STREAM_EVENTS`, `ACP_WORKSPACE_EVENTS`) in renderer
4. ✅ Single set of components works for all agent types
5. ✅ State management has no agent-type branching logic
6. ✅ All user-facing functionality preserved
7. ✅ No regression in existing ACP or DeepChat functionality
8. ✅ Code passes lint, typecheck, and tests

## Open Questions

### [RESOLVED] Workspace Terminology
**Question**: Should we use `workspace` or `workdir`?

**Resolution**: Use `workspace` as unified term (D-007)
- For ACP: Can have multiple workdirs active simultaneously
- For DeepChat: Different conversations can have different workspaces

### [RESOLVED] Session-Scoped Workspace
**Question**: Should workspace be session-scoped or global?

**Resolution**: Workspace is session-scoped (D-007, D-008)
- Selected at session creation via `SessionConfig.workspace`
- Appears in `SessionInfo` returned from `getSession()`

### [RESOLVED] ACP Workspace Mutability
**Question**: Can ACP workspace be changed after session creation?

**Resolution**: No, ACP workdir is immutable (D-041)
- ACP sessions are tied to workdir for their lifetime
- DeepChat workspace can be changed anytime

### [RESOLVED] Command Representation
**Question**: How to represent ACP commands in SessionInfo?

**Resolution**: Use `availableCommands: AgentCommand[]` (D-010)
- Commands trigger `SESSION_UPDATED` event (D-011)
- `input.hint` flattened to `inputHint` (D-012)

### [RESOLVED] Event Unification
**Question**: Should modes/models/commands be separate events?

**Resolution**: No, use `SESSION_UPDATED` for all (D-011)
- Single event type for all session metadata changes
- Payload includes updated fields

## Risk Mitigation

### High-Risk Areas

| Risk | Mitigation |
|------|------------|
| **Breaking change** | Single atomic change, comprehensive testing |
| **State corruption** | Migration script if needed, backup plan |
| **Event handling gaps** | Event mapping validation, test coverage |
| **Component behavior change** | Manual testing checklist, E2E tests |

### Rollback Plan

If integration causes critical issues:
1. Revert to commit before integration
2. Fix issues in integration branch
3. Re-apply integration after fixes

## Related Documents

### Architecture & Research
- `docs/architecture/agentic-unified-presenter.md` - Presenter layer achievements
- `docs/architecture/renderer-investigation.md` - Current renderer architecture
- `docs/architecture/renderer-analysis-research.md` - Complete research findings
- `docs/architecture/workspace-integration-analysis.md` - Workspace deep dive
- `docs/architecture/event-payload-specification.md` - Event payload spec
- `docs/architecture/acp-commands-specification.md` - Commands spec
- `docs/architecture/acp-modes-models-specification.md` - Modes/models spec
- `docs/architecture/unified-components-specification.md` - Component specs
- `docs/architecture/state-management-refactoring-spec.md` - State refactoring spec
- `docs/architecture/session-lifecycle-specification.md` - Session lifecycle spec

### Implementation Specs
- `docs/specs/agentic-unified-layer/spec.md` - Presenter layer spec (companion)
- `docs/specs/agentic-renderer-integration/plan.md` - Implementation plan (this folder)
- `docs/specs/agentic-renderer-integration/tasks.md` - Task breakdown (this folder)

### Standards
- `docs/spec-driven-dev.md` - Specification-driven development guidelines

## Appendix: Terminology Mapping

| Old Term | New Term | Notes |
|----------|----------|-------|
| `threadId` | `sessionId` | Renderer only |
| `conversationId` | `sessionId` (renderer), `conversationId` (SQLite) | Database unchanged |
| `activeThreadId` | `activeSessionId` | State variable |
| `threads` | `sessions` | State variable |
| `generatingThreadIds` | `generatingSessionIds` | State variable |
| `threadsWorkingStatus` | `sessionsWorkingStatus` | State variable |
| `useChatStoreService` | `useAgenticSessionStore` | Composable |
| `useChatAdapter` | `useAgenticAdapter` | Composable |
| `useChatConfig` | `useSessionConfig` | Composable |
| `useThreadManagement` | `useSessionManagement` | Composable |
| `useThreadExport` | `useSessionExport` | Composable |
| `useChatEvents` | `useAgenticEvents` | Composable |
| `useExecutionAdapter` | `useAgenticExecution` | Composable |
