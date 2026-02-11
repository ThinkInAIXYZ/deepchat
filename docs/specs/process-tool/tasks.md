# Process Tool Implementation Tasks

## Phase 1: Core Infrastructure

### Task 1.1: Create BackgroundExecSessionManager
**File:** `src/main/presenter/agentPresenter/acp/backgroundExecSessionManager.ts`

**Subtasks:**
- [ ] Define BackgroundSession and SessionMeta interfaces
- [ ] Implement session storage Map structure
- [ ] Implement `start()` method with process spawning
- [ ] Implement output handling (buffer → file offload)
- [ ] Implement `poll()` method (recent output only)
- [ ] Implement `log()` method (pagination support)
- [ ] Implement `write()` method (stdin writing)
- [ ] Implement `kill()` method (SIGTERM → SIGKILL)
- [ ] Implement `clear()` method (buffer/file clearing)
- [ ] Implement `remove()` method (complete cleanup)
- [ ] Implement `list()` method (session metadata)
- [ ] Implement TTL cleanup timer
- [ ] Add environment variable config support
- [ ] Export singleton instance

**Acceptance:**
- Can start a background process
- Can poll output
- Can kill process
- Cleanup works correctly

---

### Task 1.2: Export from acp/index.ts
**File:** `src/main/presenter/agentPresenter/acp/index.ts`

**Subtasks:**
- [ ] Add export for BackgroundExecSessionManager
- [ ] Add export for backgroundExecSessionManager singleton

---

## Phase 2: Tool Integration

### Task 2.1: Modify AgentBashHandler
**File:** `src/main/presenter/agentPresenter/acp/agentBashHandler.ts`

**Subtasks:**
- [ ] Update ExecuteCommandArgsSchema with `background` and `yieldMs` params
- [ ] Modify `executeCommand()` to detect background mode
- [ ] Add `executeCommandBackground()` method
- [ ] Import and use BackgroundExecSessionManager
- [ ] Return `{status: "running", sessionId}` for background mode

**Acceptance:**
- `execute_command` with `background: true` returns sessionId
- Foreground mode unchanged

---

### Task 2.2: Add Process Tool to AgentToolManager
**File:** `src/main/presenter/agentPresenter/acp/agentToolManager.ts`

**Subtasks:**
- [ ] Add process tool schema definition
- [ ] Add process tool to `getAllToolDefinitions()`
- [ ] Add `isProcessTool()` helper
- [ ] Add `callProcessTool()` method
- [ ] Route process tool in `callTool()` switch
- [ ] Import BackgroundExecSessionManager

**Process Actions to Implement:**
- [ ] `list` - return session list
- [ ] `poll` - return recent output
- [ ] `log` - return paginated output
- [ ] `write` - write to stdin
- [ ] `kill` - terminate process
- [ ] `clear` - clear output
- [ ] `remove` - delete session

**Acceptance:**
- process tool appears in tool list
- All actions work correctly
- Proper error handling

---

## Phase 3: Polish & Quality

### Task 3.1: Add i18n Strings
**Files:**
- `src/renderer/src/i18n/en-US.json`
- `src/renderer/src/i18n/zh-CN.json`

**Subtasks:**
- [ ] Add error message keys for process tool
- [ ] Add tool description strings

---

### Task 3.2: Write Tests
**File:** `test/main/presenter/agentPresenter/acp/backgroundExecSessionManager.test.ts`

**Subtasks:**
- [ ] Test session start
- [ ] Test poll output
- [ ] Test log pagination
- [ ] Test write to stdin
- [ ] Test kill process
- [ ] Test clear/remove
- [ ] Test list sessions
- [ ] Test TTL cleanup
- [ ] Test offload behavior

---

### Task 3.3: Code Quality
**Command:**
```bash
pnpm run format
pnpm run lint
pnpm run typecheck
```

---

## Task Dependencies

```
Task 1.1 ──┬──→ Task 2.1 ──┬──→ Task 2.2
           │               │
           └──→ Task 1.2 ──┘

Task 2.2 ──┬──→ Task 3.1
           ├──→ Task 3.2
           └──→ Task 3.3
```

## Definition of Done

- [ ] All tasks complete
- [ ] Tests passing
- [ ] Lint/format/typecheck passing
- [ ] Spec/plan documents complete
- [ ] Manual testing verified
