# Tool Call Rendering + Permission Flow - Tasks

## Task 1: Add Device Platform Caching to Upgrade Store
- **File**: `src/renderer/src/stores/upgrade.ts`
- **Changes**:
  - Import `usePresenter` for `devicePresenter`
  - Add `isWindows` computed property
  - Fetch device info once on store initialization
  - Cache platform value
- **Acceptance**: `upgradeStore.isWindows` returns correct boolean based on `platform === 'win32'`

## Task 2: Refactor MessageBlockToolCall.vue to Use Monaco
- **File**: `src/renderer/src/components/message/MessageBlockToolCall.vue`
- **Changes**:
  - Remove `JsonObject` and `Terminal` imports
  - Add `useMonaco` import from `stream-monaco`
  - Replace params/response rendering with Monaco code blocks
  - Implement lazy initialization (create only when `isExpanded === true`)
  - Dispose editors when collapsed
  - Add copy buttons for params and response
  - Implement language detection (json, plaintext, shell/bash, powershell)
  - Use `upgradeStore.isWindows` for PowerShell detection
- **Acceptance**:
  - Params always render as JSON code block
  - Responses render as JSON if valid JSON, else plaintext
  - Terminal tools use shell/bash (Linux/Mac) or powershell (Windows)
  - Editors created only on expand, disposed on collapse
  - Copy buttons work correctly

## Task 3: Remove Permission Block Rendering in MessageItemAssistant.vue
- **File**: `src/renderer/src/components/message/MessageItemAssistant.vue`
- **Changes**:
  - Remove `MessageBlockPermissionRequest` component usage
  - Remove permission block condition from template
- **Acceptance**: Permission blocks no longer render in assistant messages

## Task 4: Add Permission Block Removal in PermissionHandler
- **File**: `src/main/presenter/agentPresenter/permission/permissionHandler.ts`
- **Changes**:
  - In `handlePermissionResponse()`, after updating permission block status:
    - Remove permission block from `content` array
    - Find corresponding tool_call block by `tool_call.id`
    - Update tool_call block with result
    - Persist via `messageManager.editMessage()`
  - Apply same logic to `generatingState.message.content` if present
- **Acceptance**: Permission blocks removed from message content after resolution; tool_call blocks updated

## Task 5: Add Logging for Think-Content State Changes
- **File**: `src/renderer/src/components/message/MessageBlockThink.vue`
- **Changes**:
  - Add `console.log` in watch for `block.status` and `block.reasoning_time`
  - Log block type, content length, and status changes
- **File**: `src/renderer/src/components/think-content/ThinkContent.vue`
- **Changes**:
  - Add `console.log` for props changes (label, expanded, thinking, content)
  - Log state transitions
- **File**: `src/renderer/src/stores/chat.ts`
- **Changes**:
  - Add `console.log` when `reasoning_content` blocks are created or updated
  - Log block type and content changes during streaming
- **Acceptance**: Console logs capture all state transitions for think-content blocks

## Task 6: Update Tests for Permission Block Removal
- **File**: `test/main/presenter/sessionPresenter/permissionHandler.test.ts` (if exists)
- **Changes**:
  - Add tests for permission block removal logic
  - Verify tool_call block is updated correctly
- **File**: `test/renderer/message/messageBlockSnapshot.test.ts`
- **Changes**:
  - Update snapshots to reflect removed permission blocks
  - Ensure final messages contain only tool_call blocks
- **Acceptance**: Tests pass with new permission block behavior

## Task 7: Format and Typecheck
- Run: `pnpm run format`
- Run: `pnpm run lint`
- Run: `pnpm run typecheck`
- **Acceptance**: All commands pass without errors

## Task 8: Manual Testing
- Test permission flow with grant and deny actions
- Verify permission blocks disappear after resolution
- Verify tool_call blocks show updated status
- Test Monaco code block rendering for various tool calls
- Test copy functionality for params and responses
- Test think-content with logs visible in console
- Test on Windows and Linux/Mac for terminal language detection
- **Acceptance**: All manual tests pass; UI behaves as expected

## Task 9: Update SDD Documentation (Optional)
- Update `docs/specs/toolcall-permission-flow/spec.md` if acceptance criteria change
- Update `docs/specs/toolcall-permission-flow/plan.md` if architecture changes
- **Acceptance**: Documentation reflects implementation reality
