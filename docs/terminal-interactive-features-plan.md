# Terminal Interactive Features Implementation Plan

## Overview

This plan implements interactive capabilities for the workspace terminal in `WorkspaceTerminal.vue`, enabling:
- Click to expand/collapse terminal command output
- Right-click context menu to terminate running commands
- Automatic cleanup of all running commands when user cancels chat streaming

## Requirements

### User Requirements
- All snippets start collapsed by default
- Click to expand and view full command output
- Scrollable output container with max-height (240px / 15rem)
- Scroll to bottom of output when expanded
- Right-click context menu to terminate running commands
- Remove terminated commands from list (not just mark as aborted)
- Clean up all commands when user stops streaming in ChatInput
- Scope: only affect current conversation

### Design Decisions
- Expansion state persisted in component only (not in snippet data)
- Reuse ContextMenu pattern from `WorkspaceFileNode.vue`
- Show truncation indicator when applicable
- Terminate commands only affect current conversation

---

## Phase 1: Backend Process Tracking & Termination

### 1.1 Type Definitions

**File:** `src/shared/types/presenters/workspace.d.ts`

**Changes:**
- Add `terminateCommand` method to `IWorkspacePresenter` interface:

```typescript
export interface IWorkspacePresenter {
  // ... existing methods ...

  /**
   * Terminate a running command
   * @param conversationId Conversation ID
   * @param snippetId Terminal snippet ID
   */
  terminateCommand(conversationId: string, snippetId: string): Promise<void>
}
```

**Rationale:** Provides typed interface for command termination across main/renderer boundary.

---

### 1.2 Process Tracking in FileSystemHandler

**File:** `src/main/presenter/llmProviderPresenter/agent/agentFileSystemHandler.ts`

**Changes:**

1. Add process tracking map to class:
```typescript
private activeProcesses = new Map<string, {
  conversationId: string
  snippetId: string
  child: import('child_process').ChildProcess
}>()
```

2. Modify `executeCommand()` method to:
   - Accept optional `snippetId` parameter
   - Generate snippet ID if not provided (using `crypto.randomUUID()` if available or timestamp-based)
   - Register process in `activeProcesses` map immediately after spawn
   - Add cleanup in finally block to remove from map when process exits

3. Add `terminateCommandProcess()` method:
```typescript
async terminateCommandProcess(conversationId: string, snippetId: string): Promise<void> {
  const processKey = `${conversationId}:${snippetId}`
  const processEntry = this.activeProcesses.get(processKey)

  if (!processEntry) {
    console.warn(`[FileSystem] No active process found for snippet ${snippetId}`)
    return
  }

  const { child } = processEntry

  try {
    // First try SIGTERM for graceful shutdown
    child.kill('SIGTERM')

    // Force kill if still alive after 2 seconds
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch (e) {
        // ignore
      }
    }, 2000)

    // Clear timeout on process exit
    child.once('exit', () => {
      clearTimeout(killTimer)
    })
  } catch (error) {
    console.error(`[FileSystem] Failed to terminate command ${snippetId}:`, error)
  }

  // Remove from tracking map
  this.activeProcesses.delete(processKey)

  // Update snippet status via workspacePresenter
  await this.workspacePresenter?.emitTerminalSnippet(conversationId, {
    id: snippetId,
    status: 'aborted',
    // Include other fields from existing snippet or retrieve from somewhere
  })
}
```

**Rationale:** Tracks all running child processes to enable clean termination. Uses SIGTERM first for graceful shutdown, then SIGKILL as fallback.

---

### 1.3 WorkspacePresenter Termination Implementation

**File:** `src/main/presenter/workspacePresenter/index.ts`

**Changes:**

1. Add import for agentFileSystemHandler if not already available:
```typescript
import { agentFileSystemHandler } from '../llmProviderPresenter/agent/agentFileSystemHandler'
```

2. Implement `terminateCommand()` method:
```typescript
async terminateCommand(conversationId: string, snippetId: string): Promise<void> {
  // Delegate to fileSystemHandler
  await agentFileSystemHandler.terminateCommandProcess(conversationId, snippetId)
}
```

**Rationale:** WorkspacePresenter acts as the public interface, delegating to the specialized handler.

---

### 1.4 Agent Loop Cleanup Integration

**File:** `src/main/presenter/llmProviderPresenter/managers/agentLoopHandler.ts` (if needed)

**Changes:**

Option A: Add method to terminate all commands for a conversation:
```typescript
async terminateAllCommands(conversationId: string): Promise<void> {
  // This would be implemented in agentFileSystemHandler
  // Called when stream is cancelled
}
```

Option B: Rely on chatStore calling workspacePresenter.terminateCommand() for each running snippet individually.

**Decision:** Use Option B - simpler, and the frontend already has access to running snippets.

---

## Phase 2: Store Updates

### 2.1 Workspace Store Enhancements

**File:** `src/renderer/src/stores/workspace.ts`

**Changes:**

1. Add expansion state tracking:
```typescript
const expandedSnippetIds = ref<Set<string>>(new Set())
```

2. Add snippet expansion toggle method:
```typescript
const toggleSnippetExpansion = (snippetId: string) => {
  if (expandedSnippetIds.value.has(snippetId)) {
    expandedSnippetIds.value.delete(snippetId)
  } else {
    expandedSnippetIds.value.add(snippetId)
  }
}
```

3. Add snippet removal method:
```typescript
const removeTerminalSnippet = (snippetId: string) => {
  const snippet = terminalSnippets.value.find(s => s.id === snippetId)
  if (snippet?.status === 'running') {
    // Also remove from expanded tracking when running commands are removed
    expandedSnippetIds.value.delete(snippetId)
  }
  terminalSnippets.value = terminalSnippets.value.filter(s => s.id !== snippetId)
}
```

4. Add command termination method:
```typescript
const terminateCommand = async (snippetId: string) => {
  const conversationId = chatStore.getActiveThreadId()
  if (!conversationId) {
    console.warn('[Workspace] No active conversation, cannot terminate command')
    return
  }

  try {
    await workspacePresenter.terminateCommand(conversationId, snippetId)
  } catch (error) {
    console.error('[Workspace] Failed to terminate command:', error)
  }
}
```

5. Add terminate all running commands method:
```typescript
const terminateAllRunningCommands = async () => {
  const conversationId = chatStore.getActiveThreadId()
  if (!conversationId) return

  const runningSnippets = terminalSnippets.value.filter(s => s.status === 'running')
  if (runningSnippets.length === 0) return

  console.info(`[Workspace] Terminating ${runningSnippets.length} running commands for conversation ${conversationId}`)

  try {
    await Promise.all(runningSnippets.map(s => terminateCommand(s.id)))
  } catch (error) {
    console.error('[Workspace] Failed to terminate one or more commands:', error)
  }
}
```

6. Export new methods and state:
```typescript
return {
  // ... existing exports ...
  expandedSnippetIds,
  toggleSnippetExpansion,
  removeTerminalSnippet,
  terminateCommand,
  terminateAllRunningCommands
}
```

**Rationale:** Centralized state management for terminal expansion and command termination.

---

### 2.2 Chat Store Integration with Cancellation

**File:** `src/renderer/src/stores/chat.ts`

**Changes:**

1. Import workspace store if not already imported:
```typescript
import { useWorkspaceStore } from './workspace'
```

2. Modify `cancelGenerating()` method:
```typescript
const cancelGenerating = async (threadId: string) => {
  if (!threadId) return

  try {
    // Terminate all running workspace commands
    const workspaceStore = useWorkspaceStore()
    await workspaceStore.terminateAllRunningCommands()

    // ... existing cancelGenerating logic ...
    const cache = getGeneratingMessagesCache()
    const generatingMessage = Array.from(cache.entries()).find(
      ([, cached]) => cached.threadId === threadId
    ) as string[]
    if (generatingMessage) {
      const [messageId] = generatingMessage
      await threadP.stopMessageGeneration(messageId)
      // ... rest of existing logic ...
    }
  } catch (error) {
    console.error('Failed to cancel generation:', error)
    throw error
  }
}
```

**Rationale:** Ensures all running commands are cleaned up when user cancels chat streaming.

---

## Phase 3: UI Component Updates

### 3.1 WorkspaceTerminal Component Refactoring

**File:** `src/renderer/src/components/workspace/WorkspaceTerminal.vue`

**Changes:**

1. Add ContextMenu component imports:
```typescript
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@shadcn/components/ui/context-menu'
```

2. Add template ref for output container:
```typescript
const expandedOutputRefs = ref<Map<string, HTMLElement>>(new Map())
```

3. Add computed property for expansion check:
```typescript
const isSnippetExpanded = (snippetId: string) => {
  return store.expandedSnippetIds.has(snippetId)
}
```

4. Add template ref setup function:
```typescript
const setOutputRef = (snippetId: string) => {
  return (el: any) => {
    if (el) {
      expandedOutputRefs.value.set(snippetId, el)
    } else {
      expandedOutputRefs.value.delete(snippetId)
    }
  }
}
```

5. Add scroll to bottom function:
```typescript
const scrollToBottom = (snippetId: string) => {
  nextTick(() => {
    const el = expandedOutputRefs.value.get(snippetId)
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}
```

6. Add click handler for expansion:
```typescript
const handleSnippetClick = (snippetId: string) => {
  store.toggleSnippetExpansion(snippetId)
  if (store.expandedSnippetIds.has(snippetId)) {
    scrollToBottom(snippetId)
  }
}
```

7. Add terminate handler:
```typescript
const handleTerminate = async (snippetId: string) => {
  await store.terminateCommand(snippetId)
}
```

8. Modify template to wrap snippets in ContextMenu:

```vue
<template>
  <section v-if="store.terminalSnippets.length > 0" class="mt-2 px-0">
    <button
      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/40"
      type="button"
      @click="showTerminal = !showTerminal"
    >
      <Icon icon="lucide:terminal" class="h-3.5 w-3.5" />
      <span class="flex-1 text-[12px] font-medium tracking-wide text-foreground/80 dark:text-white/80">
        {{ t(sectionKey) }}
      </span>
      <span class="text-[10px] text-muted-foreground">
        {{ store.terminalSnippets.length }}
      </span>
      <Icon
        :icon="showTerminal ? 'lucide:chevron-down' : 'lucide:chevron-up'"
        class="h-3 w-3 text-muted-foreground"
      />
    </button>

    <Transition name="workspace-collapse">
      <div v-if="showTerminal" class="space-y-0 overflow-hidden">
        <div
          v-if="store.terminalSnippets.length === 0"
          class="px-4 py-3 text-[11px] text-muted-foreground"
        >
          {{ t(`${terminalKeyPrefix}.empty`) }}
        </div>
        <ul v-else class="pb-1">
          <li v-for="snippet in store.terminalSnippets" :key="snippet.id">
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <button
                  class="flex w-full items-center gap-2 py-2 pr-4 text-left text-xs text-muted-foreground pl-7 transition hover:bg-muted/40"
                  type="button"
                  @click="handleSnippetClick(snippet.id)"
                >
                  <span class="flex h-4 w-4 shrink-0 items-center justify-center">
                    <Icon
                      :icon="getStatusIcon(getDisplayStatus(snippet.status))"
                      :class="getStatusIconClass(getDisplayStatus(snippet.status))"
                    />
                  </span>
                  <span class="flex-1 min-w-0 truncate text-[12px] font-medium">
                    {{ snippet.command }}
                  </span>
                  <span
                    class="text-[10px]"
                    :class="getStatusLabelClass(getDisplayStatus(snippet.status))"
                  >
                    {{ getStatusLabel(getDisplayStatus(snippet.status)) }}
                  </span>
                  <Icon
                    :icon="isSnippetExpanded(snippet.id) ? 'lucide:chevron-down' : 'lucide:chevron-right'"
                    class="h-3 w-3 text-muted-foreground"
                  />
                </button>
              </ContextMenuTrigger>

              <ContextMenuContent class="w-48">
                <ContextMenuItem
                  v-if="snippet.status === 'running'"
                  @select="handleTerminate(snippet.id)"
                >
                  <Icon icon="lucide:stop-circle" class="h-4 w-4" />
                  {{ t(`${terminalKeyPrefix}.contextMenu.terminate`) }}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem v-if="isSnippetExpanded(snippet.id)" @select="store.toggleSnippetExpansion(snippet.id)">
                  <Icon icon="lucide:chevron-right" class="h-4 w-4" />
                  {{ t(`${terminalKeyPrefix}.contextMenu.collapse`) }}
                </ContextMenuItem>
                <ContextMenuItem v-else @select="handleSnippetClick(snippet.id)">
                  <Icon icon="lucide:chevron-down" class="h-4 w-4" />
                  {{ t(`${terminalKeyPrefix}.contextMenu.expand`) }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            <Transition name="terminal-expand">
              <div
                v-if="isSnippetExpanded(snippet.id)"
                :ref="setOutputRef(snippet.id)"
                class="max-h-60 overflow-y-auto px-7 pr-4 pb-2"
              >
                <div class="rounded bg-muted/30 p-2">
                  <div v-if="snippet.output" class="text-[11px] font-mono whitespace-pre-wrap text-muted-foreground/80">
                    {{ snippet.output }}
                    <span v-if="snippet.truncated" class="ml-2 text-muted-foreground/60">
                      {{ t(`${terminalKeyPrefix}.output.truncated`) }}
                    </span>
                  </div>
                  <div v-else class="text-[10px] text-muted-foreground">
                    {{ t(`${terminalKeyPrefix}.noOutput`) }}
                  </div>
                </div>
              </div>
            </Transition>
          </li>
        </ul>
      </div>
    </Transition>
  </section>
</template>
```

9. Add expansion transition styles:
```css
<style scoped>
/* ... existing styles ... */

.terminal-expand-enter-active,
.terminal-expand-leave-active {
  transition: all 0.2s ease;
}

.terminal-expand-enter-from,
.terminal-expand-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}

.terminal-expand-enter-to,
.terminal-expand-leave-from {
  opacity: 1;
  max-height: 15rem; /* max-h-60 */
  transform: translateY(0);
}
</style>
```

**Rationale:** Provides intuitive UI for terminal expansion and command termination, matching existing patterns in WorkspaceFileNode.vue.

---

## Phase 4: Internationalization

### 4.1 English Translation

**File:** `src/renderer/src/i18n/locales/en-US.yaml`

**Changes:**

Add under `chat.workspace.terminal`:
```yaml
contextMenu:
  terminate: Terminate
  expand: Expand
  collapse: Collapse
output:
  truncated: "[truncated]"
noOutput: No output
```

---

### 4.2 Chinese Translation

**File:** `src/renderer/src/i18n/locales/zh-CN.yaml`

**Changes:**

Add under `chat.workspace.terminal`:
```yaml
contextMenu:
  terminate: 终止命令
  expand: 展开查看
  collapse: 折叠
output:
  truncated: "[已截断]"
noOutput: 无输出
```

---

### 4.3 Japanese Translation

**File:** `src/renderer/src/i18n/locales/ja-JP.yaml`

**Changes:**

Add under `chat.workspace.terminal`:
```yaml
contextMenu:
  terminate: コマンドを停止
  expand: 展開
  collapse: 折りたたむ
output:
  truncated: "[切り捨て]"
noOutput: 出力なし
```

---

## Implementation Order

1. **Phase 1: Backend Changes**
   - 1.1 Type definitions
   - 1.2 Process tracking in agentFileSystemHandler
   - 1.3 WorkspacePresenter termination
   - 1.4 Agent loop cleanup (if needed)

2. **Phase 2: Store Updates**
   - 2.1 Workspace store enhancements
   - 2.2 Chat store integration

3. **Phase 3: UI Updates**
   - 3.1 WorkspaceTerminal component refactoring

4. **Phase 4: Internationalization**
   - 4.1 English translations
   - 4.2 Chinese translations
   - 4.3 Japanese translations

5. **Testing & Verification**

---

## Testing Checklist

- [ ] All snippets start collapsed by default
- [ ] Clicking snippet toggles expansion
- [ ] Expanded output shows max-height (240px) scrollbar
- [ ] Expanded output scrolls to bottom automatically
- [ ] Right-click shows context menu with "Terminate" for running commands
- [ ] Clicking "Terminate" removes command from list
- [ ] Clicking stop button in ChatInput terminates all running commands
- [ ] Truncated output shows truncation indicator
- [ ] Commands without output show "No output" message
- [ ] Multiple expansions work independently
- [ ] All locale translations are correct

---

## Notes

- The `truncated` flag is already part of `WorkspaceTerminalSnippet` type, no changes needed
- Process cleanup on normal exit (timeout, completion, failure) needs to remove from `activeProcesses` map
- Consider race condition where process exits before termination is called
- Ensure proper error handling for termination failures
- Test with long-running commands to verify termination works correctly
