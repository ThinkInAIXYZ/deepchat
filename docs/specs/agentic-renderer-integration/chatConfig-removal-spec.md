# ChatConfig Removal Specification

## Overview

Remove all `chatConfig` (CONVERSATION_SETTINGS) functionality from the codebase. This includes database schema, UI components, and all associated logic.

**Rationale**: Per-conversation configuration adds unnecessary complexity. The new agentic architecture should be simpler with only essential session state.

---

## Decision: What to Keep vs Remove

### ✅ KEEP: Core Session State (from SessionInfo)

These fields are **runtime state** managed by the agent, not user configuration:

| Field | Source | Access Method |
|-------|--------|---------------|
| `modelId` | `SessionInfo.currentModelId` | `useSessionConfig(sessionId).modelId` |
| `agentId` | `SessionInfo.agentId` | `useSessionConfig(sessionId).agentId` |
| `modeId` | `SessionInfo.currentModeId` | `useSessionConfig(sessionId).modeId` |
| `workspace` | `SessionInfo.workspace` | `useSessionConfig(sessionId).workspace` |

**Note**: `providerId` is **REMOVED**. Use `agentId` instead. The provider concept is no longer needed in the unified agentic architecture.

---

### ❌ REMOVE: All LLM Parameters

These parameters are **no longer configurable** by users:

| Field | Removal Reason |
|-------|----------------|
| `temperature` | Use agent default |
| `contextLength` | Use agent default |
| `maxTokens` | Use agent default |
| `thinkingBudget` | Use agent default |
| `reasoningEffort` | Use agent default |
| `verbosity` | Use agent default |

---

### ❌ REMOVE: Feature Flags

| Field | Removal Reason |
|-------|----------------|
| `artifacts` | Feature removed |
| `enableSearch` | Always enabled if supported |
| `forcedSearch` | Feature removed |
| `searchStrategy` | Use agent default |

---

### ❌ REMOVE: Tool Selection

| Field | Removal Reason |
|-------|----------------|
| `enabledMcpTools` | All available tools enabled by default |

**Note**: Tools can still be disabled at the MCP server level, but per-session tool selection is removed.

---

### ❌ REMOVE: Prompt Configuration

| Field | Removal Reason |
|-------|----------------|
| `systemPrompt` | Use agent default prompt |
| `systemPromptId` | Feature removed |
| `activeSkills` | Feature removed |

---

### ❌ REMOVE: Runtime State (Moved to Store)

| Field | New Location |
|-------|--------------|
| `selectedVariantsMap` | Store runtime state (not persisted) |

---

## Database Schema Changes

### Remove Column

```sql
-- Remove settings column from conversations table
ALTER TABLE conversations DROP COLUMN settings;
```

### Remove Type

```typescript
// Remove from thread.presenter.d.ts
export type CONVERSATION_SETTINGS = { ... } // DELETE THIS
```

---

## Component Changes

### ✅ KEEP: ModelSelect Components

**Files**:
- `src/renderer/src/components/ModelSelect.vue`
- `src/renderer/src/components/ModelChooser.vue`
- `src/renderer/src/components/UnifiedModeSelector.vue`

**Changes**:
- Update to read from `SessionInfo` instead of `chatConfig`
- Remove providerId references
- Use `useSessionConfig(sessionId)` composable

**Example**:
```vue
<script setup lang="ts">
import { useSessionConfig } from '@/composables/agentic/useSessionConfig'

const props = defineProps<{ sessionId: string }>()

const { modelId, agentId, availableModels } = useSessionConfig(props.sessionId)
</script>

<template>
  <select :value="modelId" @change="setModel($event.target.value)">
    <option v-for="model in availableModels" :key="model.id" :value="model.id">
      {{ model.name }}
    </option>
  </select>
</template>
```

---

### ❌ DELETE: PromptInput Configuration

**Files**:
- `src/renderer/src/components/chat-input/composables/usePromptInputConfig.ts` - DELETE

**Components using it**:
- Simplify to use agent defaults
- Remove all config-related UI

---

### ❌ DELETE/SIMPLIFY: MCP Tools Configuration

**Files**:
- `src/renderer/src/components/McpToolsList.vue` - Simplify to display-only
- `src/renderer/src/composables/mcp/useMcpStoreService.ts` - Remove tool selection logic

**Changes**:
- Display available tools only
- Remove enable/disable functionality
- All tools enabled by default

---

## Composable Changes

### ✅ KEEP: useSessionConfig

**Location**: `src/renderer/src/composables/agentic/useSessionConfig.ts`

**Returns**:
```typescript
{
  sessionInfo,      // SessionInfo object
  modelId,          // Current model ID
  modeId,           // Current mode ID
  workspace,        // Current workspace
  agentId,          // Agent ID (replaces providerId)
  availableModels,  // Available models
  availableModes,   // Available modes
  capabilities,     // Agent capabilities
  setModel,         // Change model
  setMode,          // Change mode
}
```

---

### ❌ DELETE: useChatConfig

**Location**: `src/renderer/src/composables/chat/useChatConfig.ts` - DELETE

**Replaced by**: `useSessionConfig`

---

### ❌ DELETE: useVariantManagement

**Location**: `src/renderer/src/composables/chat/useVariantManagement.ts` - DELETE

**Rationale**: Variant management (regenerating responses, selecting between variants) adds complexity. In the new architecture:
- Keep only the most recent response for each message
- Remove variant selection UI
- Remove `selectedVariantsMap` from store state
- `retryMessage` will simply regenerate, not create variants

**Migration**:
- Remove variant-related UI components
- Simplify message retry logic
- Remove variant selection from MessageList.vue

---

### ❌ DELETE: useMcpSamplingStoreService

**Location**: `src/renderer/src/composables/mcp/useMcpSamplingStoreService.ts` - DELETE

**Rationale**: MCP sampling configuration is no longer needed. All MCP tools are enabled by default.

**Migration**:
- Remove any UI components using this service
- Remove sampling-related configuration options

---

### ✅ UPDATE: useAgenticSessionStore

**Remove**:
- `chatConfig` property
- All `chatConfig.*` sub-properties
- `updateChatConfig` method
- `loadChatConfig` method
- `setAgentWorkspacePreference` method (use `setMode` or direct workspace setting)
- `selectedVariantsMap` property (variant management removed)
- `variantManagementComposable` integration
- `clearSelectedVariantForMessage` method
- `updateSelectedVariant` method
- `regenerateFromUserMessage` method (variant-based regeneration)

**Keep**:
- Session state methods
- Message methods (simplified - no variants)
- Export methods

**Simplified Interface**:
```typescript
export function useAgenticSessionStore() {
  return {
    // Session state (from SessionInfo)
    activeSessionId,
    activeSessionInfo,
    currentModelId,
    currentAgentId,
    currentModeId,
    currentWorkspace,
    availableModels,
    availableModes,

    // Message state (no variants)
    messageIds,
    messageItems,
    generatingSessionIds,
    sessionsWorkingStatus,

    // Methods (simplified)
    loadMessages,
    sendMessage,
    retryMessage,        // Simple retry, no variants
    deleteMessage,
    cancelGenerating,
    continueStream,

    // Export
    exportSession,
    exportAsMarkdown,
    exportAsHtml,
    exportAsTxt,
    exportAndDownload,

    // Session management
    setActiveSessionId,
    updateSessionWorkingStatus,
  }
}
```

---

## Migration Plan

### Step 1: Update useSessionConfig

Ensure `useSessionConfig` provides all needed session state:
- ✅ Already done in Phase 1-5
- Returns `modelId`, `modeId`, `workspace`, `agentId`

### Step 2: Update Consumers

Replace all `chatConfig` usage:

| Before | After |
|--------|-------|
| `chatStore.chatConfig.modelId` | `useSessionConfig(sessionId).modelId` |
| `chatStore.chatConfig.providerId` | `useSessionConfig(sessionId).agentId` |
| `chatStore.chatConfig.contextLength` | *Remove (use default)* |
| `chatStore.chatConfig.temperature` | *Remove (use default)* |
| `chatStore.chatConfig.enabledMcpTools` | *Remove (all tools enabled)* |

### Step 3: Update Components

1. **ModelSelect.vue** - Read from SessionInfo
2. **ChatInput.vue** - Remove config props
3. **McpToolsList.vue** - Simplify to display-only
4. **usePromptInputConfig.ts** - DELETE

### Step 4: Database Migration

```sql
-- Migration script
ALTER TABLE conversations DROP COLUMN settings;
```

### Step 5: Cleanup

1. Delete `useChatConfig.ts`
2. Delete `useVariantManagement.ts` (variant management removed)
3. Delete `useMcpSamplingStoreService.ts` (MCP sampling removed)
4. Delete `useThreadExport.ts` (use `useSessionExport`)
5. Delete `useChatAdapter.ts` (use `useAgenticAdapter`)
6. Delete `usePromptInputConfig.ts`
7. Remove `CONVERSATION_SETTINGS` type
8. Update `SessionPresenter` interfaces
9. Remove variant-related UI components

---

## Affected Files (20+ total)

### DELETE Composables (6 files)

1. `src/renderer/src/composables/chat/useChatConfig.ts` - DELETE
2. `src/renderer/src/composables/chat/useVariantManagement.ts` - DELETE
3. `src/renderer/src/composables/mcp/useMcpSamplingStoreService.ts` - DELETE
4. `src/renderer/src/composables/chat/useThreadExport.ts` - DELETE (use useSessionExport)
5. `src/renderer/src/composables/chat/useChatAdapter.ts` - DELETE (use useAgenticAdapter)
6. `src/renderer/src/components/chat-input/composables/usePromptInputConfig.ts` - DELETE

### UPDATE Components (High Priority)

7. `src/renderer/src/components/ModelSelect.vue` - Use SessionInfo
8. `src/renderer/src/components/ModelChooser.vue` - Use SessionInfo
9. `src/renderer/src/components/UnifiedModeSelector.vue` - Already uses SessionInfo ✅
10. `src/renderer/src/components/ChatInput.vue` - Remove chatConfig props
11. `src/renderer/src/components/NewThread.vue` - Use agentId instead of providerId
12. `src/renderer/src/components/McpToolsList.vue` - Simplify to display-only or DELETE

### UPDATE Components (Medium Priority)

13. `src/renderer/src/components/ChatLayout.vue` - Remove contextLength usage
14. `src/renderer/src/components/message/MessageList.vue` - Remove variant selection UI
15. `src/renderer/src/components/message/MessageItem.vue` - Remove variant buttons
16. `src/renderer/src/composables/agentic/useAgenticSessionStore.ts` - Remove chatConfig, variants, MCP sampling
17. `src/renderer/src/composables/chat/useSessionManagement.ts` - Remove chatConfig usage
18. `src/renderer/src/composables/mcp/useMcpStoreService.ts` - Remove tool selection logic
19. `src/renderer/src/composables/workspace/useWorkspaceStoreService.ts` - Update to use SessionInfo

### UPDATE Components (Low Priority)

20. `src/renderer/src/components/chat-input/composables/useAcpWorkdir.ts`
21. `src/renderer/src/components/chat-input/composables/useAgentWorkspace.ts`
22. `src/renderer/src/components/chat-input/composables/useRateLimitStatus.ts`
23. `src/renderer/src/components/chat-input/composables/useSendButtonState.ts`

---

## Testing Checklist

### Core Functionality
- [ ] Model selection works (change model via ModelSelect)
- [ ] Mode selection works (change mode via UnifiedModeSelector)
- [ ] Workspace selection works (for ACP agents)
- [ ] Messages send without chatConfig
- [ ] Retry message works (simple retry, no variants)
- [ ] Delete message works

### Removed Features
- [ ] Variant selection UI removed
- [ ] Variant buttons removed from messages
- [ ] MCP tool selection UI removed
- [ ] PromptInput configuration UI removed
- [ ] Temperature/contextLength config UI removed

### Data Migration
- [ ] Database migration successful (settings column dropped)
- [ ] Existing conversations load without settings
- [ ] No errors on console

### Integration
- [ ] All components using SessionInfo work correctly
- [ ] Session state updates propagate correctly
- [ ] Export functionality works (use useSessionExport)

---

## Rollback Plan

If issues arise:

1. **Keep settings column** but mark as deprecated
2. **Add default values** for removed fields
3. **Restore components** with simplified versions
4. **Phase out** gradually over multiple releases
