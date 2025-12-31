# Terminal Interactive Features - Implementation TODOs

## Phase 1: Backend Process Tracking & Termination

### 1.1 Type Definitions
- [ ] Add `terminateCommand` method to `IWorkspacePresenter` interface in `src/shared/types/presenters/workspace.d.ts`
  - Signature: `terminateCommand(conversationId: string, snippetId: string): Promise<void>`

### 1.2 Process Tracking in FileSystemHandler
- [ ] Add `activeProcesses` Map to `agentFileSystemHandler.ts` class
- [ ] Modify `executeCommand()` method to accept optional `snippetId` parameter
- [ ] Implement snippet ID generation in `executeCommand()` if not provided
- [ ] Register process in `activeProcesses` map immediately after spawn
- [ ] Add cleanup code in `executeCommand()` finally block to remove from map
- [ ] Implement `terminateCommandProcess()` method
  - Find process from map
  - Kill with SIGTERM
  - Force kill with SIGKILL after 2s timeout
  - Update snippet status to 'aborted' via workspacePresenter
  - Remove from tracking map

### 1.3 WorkspacePresenter Termination Implementation
- [ ] Import `agentFileSystemHandler` in `workspacePresenter/index.ts`
- [ ] Implement `terminateCommand(conversationId: string, snippetId: string)` method
  - Delegate to `agentFileSystemHandler.terminateCommandProcess()`

### 1.4 Agent Loop Cleanup Integration
- [ ] Evaluate if additional cleanup is needed in agentLoopHandler.ts
- [ ] (Optional) Add `terminateAllCommands(conversationId: string)` if needed

---

## Phase 2: Store Updates

### 2.1 Workspace Store Enhancements
- [ ] Add `expandedSnippetIds` ref to track expanded state in `stores/workspace.ts`
- [ ] Implement `toggleSnippetExpansion(snippetId: string)` method
  - Add to Set if not present, remove if present
- [ ] Implement `removeTerminalSnippet(snippetId: string)` method
  - Filter snippets to remove matching ID
  - Also remove from expandedSnippetIds if was running
- [ ] Implement `terminateCommand(snippetId: string)` method
  - Get active thread ID from chatStore
  - Call `workspacePresenter.terminateCommand()`
- [ ] Implement `terminateAllRunningCommands()` method
  - Filter snippets with status === 'running'
  - Call `terminateCommand()` for each in parallel
- [ ] Export new state and methods from workspace store

### 2.2 Chat Store Integration with Cancellation
- [ ] Import `useWorkspaceStore` in `stores/chat.ts`
- [ ] Modify `cancelGenerating(threadId: string)` method
  - Call `workspaceStore.terminateAllRunningCommands()` at the beginning
  - Before existing message cancellation logic

---

## Phase 3: UI Component Updates

### 3.1 WorkspaceTerminal Component Refactoring
- [ ] Add ContextMenu component imports
  - `ContextMenu`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator`, `ContextMenuTrigger`
- [ ] Add template ref for output container tracking
  - `expandedOutputRefs` Map<string, HTMLElement>
- [ ] Add computed property `isSnippetExpanded(snippetId: string)`
- [ ] Implement `setOutputRef(snippetId: string)` function for template refs
- [ ] Implement `scrollToBottom(snippetId: string)` function
  - Use nextTick to wait for DOM update
  - Set scrollTop to scrollHeight
- [ ] Implement `handleSnippetClick(snippetId: string)` handler
  - Call store.toggleSnippetExpansion()
  - If expanded, call scrollToBottom()
- [ ] Implement `handleTerminate(snippetId: string)` async handler
  - Call store.terminateCommand()
- [ ] Update template to wrap snippet items in ContextMenu
  - Convert snippet div to button type="button"
  - Add ContextMenuTrigger wrapper
  - Add chevron icon for expand/collapse indicator
- [ ] Add ContextMenuContent with options
  - "Terminate" menu item (only for running commands)
  - "Expand/Collapse" menu items based on current state
- [ ] Add Transition for expandable output section
  - Add max-h-60 class
  - Add overflow-y-auto class
  - Bind template ref for scrolling
- [ ] Display output in expanded section
  - Show truncated message if snippet.truncated
  - Show "No output" if no output
  - Use font-mono for output text
  - Wrap in rounded bg-muted/30 container
- [ ] Add terminal-expand transition styles in `style scoped`
  - Enter/leave-active: transition all 0.2s ease
  - Enter/leave-from: opacity 0, max-height 0, transform translateY(-4px)
  - Enter/leave-to: opacity 1, max-height 15rem, transform translateY(0)

---

## Phase 4: Internationalization

### 4.1 English Translation
- [ ] Add translations to `src/renderer/src/i18n/locales/en-US.yaml`
  - `chat.workspace.terminal.contextMenu.terminate`: "Terminate"
  - `chat.workspace.terminal.contextMenu.expand`: "Expand"
  - `chat.workspace.terminal.contextMenu.collapse`: "Collapse"
  - `chat.workspace.terminal.output.truncated`: "[truncated]"
  - `chat.workspace.terminal.noOutput`: "No output"

### 4.2 Chinese Translation
- [ ] Add translations to `src/renderer/src/i18n/locales/zh-CN.yaml`
  - `chat.workspace.terminal.contextMenu.terminate`: "终止命令"
  - `chat.workspace.terminal.contextMenu.expand`: "展开查看"
  - `chat.workspace.terminal.contextMenu.collapse`: "折叠"
  - `chat.workspace.terminal.output.truncated`: "[已截断]"
  - `chat.workspace.terminal.noOutput`: "无输出"

### 4.3 Japanese Translation
- [ ] Add translations to `src/renderer/src/i18n/locales/ja-JP.yaml`
  - `chat.workspace.terminal.contextMenu.terminate`: "コマンドを停止"
  - `chat.workspace.terminal.contextMenu.expand`: "展開"
  - `chat.workspace.terminal.contextMenu.collapse`: "折りたたむ"
  - `chat.workspace.terminal.output.truncated`: "[切り捨て]"
  - `chat.workspace.terminal.noOutput`: "出力なし"

---

## Testing & Verification

- [ ] Verify all snippets start collapsed by default
- [ ] Test clicking toggles expansion/collapse
- [ ] Test expanded output shows max-height scrollbar
- [ ] Test expanded output scrolls to bottom automatically
- [ ] Test right-click menu shows "Terminate" for running commands only
- [ ] Test clicking "Terminate" removes command from list
- [ ] Test clicking stop button in ChatInput terminates all commands
- [ ] Test truncated output shows truncation indicator
- [ ] Test commands without output show "No output" message
- [ ] Test multiple independent expansions work correctly
- [ ] Verify all locale translations are correct
- [ ] Test with very long-running commands
- [ ] Test with commands that fail to terminate successfully

---

## Files Modified

**Backend (Main Process)**
- `src/shared/types/presenters/workspace.d.ts`
- `src/main/presenter/llmProviderPresenter/agent/agentFileSystemHandler.ts`
- `src/main/presenter/workspacePresenter/index.ts`
- `src/main/presenter/llmProviderPresenter/managers/agentLoopHandler.ts` (optional)

**Renderer (Frontend)**
- `src/renderer/src/stores/workspace.ts`
- `src/renderer/src/stores/chat.ts`
- `src/renderer/src/components/workspace/WorkspaceTerminal.vue`

**Internationalization**
- `src/renderer/src/i18n/locales/en-US.yaml`
- `src/renderer/src/i18n/locales/zh-CN.yaml`
- `src/renderer/src/i18n/locales/ja-JP.yaml`

---

## Implementation Notes

- Phase 1 must be completed before Phase 2
- Phase 2 must be completed before Phase 3
- Phase 3 and Phase 4 can be done in parallel
- All phases must be completed before testing
- Key priority: ensure proper cleanup of child processes to avoid zombie processes
