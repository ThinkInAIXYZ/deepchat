# Permission Approval Flow - Plan

## Implementation Status Sync (2026-03-04)

**Status:** 🟡 Partial  
Permission request/response interaction loop is live; remember persistence and stricter P0 safety closure are still pending.

## Current State

**What exists today:**

1. No permission checking in new architecture
2. Tools execute without permission validation
3. No permission dialog UI
4. No whitelist storage mechanism
5. Security gap: tools can access any file

## Target State

**What we want after implementation:**

1. PermissionChecker validates all tool calls
2. Permission dialog shown when needed
3. Whitelist stores remembered decisions
4. Full access mode respects projectDir boundary
5. Default mode requires explicit approval

## Implementation Phases

### Phase 1: Backend PermissionChecker

1. Create PermissionChecker class
2. Implement check() method
3. Add whitelist storage/query
4. Add projectDir boundary check

### Phase 2: Integrate with Tool Execution

1. Modify dispatch.ts executeTools()
2. Add permission check before tool call
3. Emit permission request event
4. Pause stream processing

### Phase 3: Frontend Permission Dialog

1. Create PermissionDialog component
2. Show tool details and path
3. Add Approve/Deny/Remember options
4. Send response to backend

### Phase 4: Backend Response Handler

1. Add handlePermissionResponse IPC
2. Process approval/denial
3. Update whitelist if needed
4. Resume or reject tool call

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/main/presenter/deepchatAgentPresenter/permissionChecker.ts` | Create | Permission checking logic |
| `src/main/presenter/deepchatAgentPresenter/dispatch.ts` | Modify | Integrate permission check |
| `src/main/presenter/newAgentPresenter/index.ts` | Modify | Add handlePermissionResponse |
| `src/renderer/src/components/chat/PermissionDialog.vue` | Create | Permission UI |
| `src/renderer/src/stores/permission.ts` | Create | Permission state |

## Testing Strategy

### Unit Tests

```typescript
test('PermissionChecker requires permission for external paths', () => {
  const checker = new PermissionChecker(session)
  const needsPerm = checker.needsPermission('read_file', '/etc/passwd')
  expect(needsPerm).toBe(true)
})

test('PermissionChecker auto-approves within projectDir in full mode', () => {
  session.permission_mode = 'full'
  session.projectDir = '/home/user/project'
  const checker = new PermissionChecker(session)
  const needsPerm = checker.needsPermission('read_file', '/home/user/project/file.txt')
  expect(needsPerm).toBe(false)
})
```

### Integration Tests

```typescript
test('Permission flow works end-to-end', async () => {
  // Trigger tool call requiring permission
  await agentPresenter.sendMessage('session-1', 'Read /etc/hosts')
  
  // Wait for permission request
  const permRequest = await waitForPermissionRequest()
  
  // Approve
  await sessionStore.handlePermissionResponse(permRequest.sessionId, true, false)
  
  // Verify tool executed
  const message = await messageStore.getLastMessage('session-1')
  expect(message.content).toContain('127.0.0.1')
})
```

## Rollback Plan

If issues found:
1. Disable permission checking in dispatch.ts
2. Revert to unrestricted tool execution
3. Security risk: temporary only

---

**Status:** 📝 Plan Complete  
**Priority:** P0  
**Complexity:** Medium  
**Risk:** Medium
