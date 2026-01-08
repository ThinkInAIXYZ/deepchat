# Tool Call Rendering + Permission Flow - Implementation Plan

## Architecture Decisions

### Monaco-Based Code Blocks
- Replace `JsonObject` component and xterm terminal with `useMonaco` from `stream-monaco`
- Follow pattern from `CodeArtifact.vue` and `TraceDialog.vue`
- Lazy initialization: create editor only when `isExpanded === true`, dispose when collapsed
- Separate editors for params and response to allow independent updates

### Language Detection Strategy
- **Params**: Always use `json` language (raw string display)
- **Response**:
  1. Try `JSON.parse(response)` → valid? use `json`
  2. Fallback to `plaintext`
- **Terminal tools**:
  - Detection: name/server_name contains `terminal|command|exec` (excluding `run_shell_command` from `powerpack`)
  - Language: `powershell` if Windows, otherwise `shell`/`bash`

### Permission Block Lifecycle
- **Main layer** (`ToolCallHandler`, `PermissionHandler`):
  - Permission block created with `action_type: 'tool_call_permission'` when permission required
  - On `permission-granted`/`permission-denied` events:
    - Remove permission block from `state.message.content`
    - Find and update corresponding `tool_call` block by `tool_call.id`
    - Persist updated content via `messageManager.editMessage()`
- **Renderer layer**:
  - Remove `MessageBlockPermissionRequest` rendering for resolved permissions
  - Only render tool_call blocks in final message content

### Device Platform Caching
- Store platform detection in `upgrade.ts` store to avoid repeated `devicePresenter.getDeviceInfo()` calls
- Add `isWindows` computed property based on `platform === 'win32'`
- Call `devicePresenter.getDeviceInfo()` once on store initialization

### Think-Content Logging
- Add `console.log` statements at key points:
  - Block creation/updates in `chat.ts` store
  - Type/content changes in `MessageBlockThink.vue` and `ThinkContent.vue`
  - Focus on transient state during streaming
- Keep logs minimal and debug-focused

## Event Flow

### Permission Resolution Flow
```
User grants/denies permission
→ MessageBlockPermissionRequest.vue calls agentPresenter.handlePermissionResponse()
→ PermissionHandler.handlePermissionResponse()
  → Update permission block status (granted/denied)
  → Remove permission block from content
  → Update tool_call block by tool_call_id
  → messageManager.editMessage() to persist
  → Trigger resume of agent loop
```

### Tool Call Rendering Flow
```
Stream event: tool_call=start
→ Chat store creates tool_call block (status: loading)
→ MessageBlockToolCall.vue renders collapsed view

User expands block
→ isExpanded becomes true
→ Monaco editors created for params/response
→ Code displayed with syntax highlighting

User collapses block
→ isExpanded becomes false
→ Monaco editors disposed
→ No code rendering (performance optimization)
```

## Data Model Changes

### AssistantMessageBlock
- No type changes
- `action_type: 'tool_call_permission'` blocks removed from final content

### Upgrade Store
- Add `isWindows` computed property
- Cache device platform info once

## IPC Surface
- No new IPC channels needed
- Reuse existing `agentPresenter.handlePermissionResponse`

## Test Strategy

### Unit Tests
- Test permission block removal logic in `PermissionHandler`
- Test tool_call block update by ID
- Test language detection logic (json/plaintext/powershell/shell)
- Test device platform caching

### Integration Tests
- Test full permission flow (request → grant → block removal → tool_call update)
- Test Monaco editor lifecycle (create on expand, dispose on collapse)
- Test think-content state logging captures transient changes

### Manual Testing
- Verify Monaco code blocks render correctly for complex params/responses
- Verify copy buttons work for params and response
- Verify permission blocks disappear after resolution
- Verify Windows vs Linux terminal language detection
- Verify no performance degradation with many collapsed tool calls
- Verify console logs help debug think-content state toggling

## Risks and Mitigations

### Performance Risk
- **Risk**: Creating too many Monaco editors with many expanded blocks
- **Mitigation**: Lazy initialization and disposal when collapsed; limit max height with `max-h-64`

### Data Integrity Risk
- **Risk**: Removing permission blocks could break historical message rendering
- **Mitigation**: Only affects new/active messages; old messages with permission blocks remain readable (won't occur with new flow)

### Platform Detection Race Condition
- **Risk**: Device info not loaded when tool call renders
- **Mitigation**: Initialize device info in upgrade store early; provide fallback to `shell` if not ready
