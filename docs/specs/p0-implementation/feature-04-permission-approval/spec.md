# Permission Approval Flow - Specification

## Overview

Implement the permission approval flow where the backend pauses on permission requests and waits for user approval/denial before resuming tool execution. This provides security boundaries while maintaining usability.

## User Stories

- As a user, I want to approve or deny tool calls that require permissions
- As a user, I need clear information about what the tool is trying to do
- As a user, I want the option to remember my choice for similar requests
- As a user, I need the system to pause safely while waiting for my decision

## Acceptance Criteria

### Functional Requirements

- [ ] Backend pauses when permission is required
- [ ] Permission request shown to user with clear details
- [ ] User can approve or deny the request
- [ ] User can choose to remember decision
- [ ] Backend resumes on approval
- [ ] Backend returns error on denial
- [ ] Session status shows 'paused' during wait
- [ ] Timeout mechanism for abandoned requests

### Technical Requirements

- [ ] Backend emits permission request event
- [ ] Frontend shows permission dialog
- [ ] Frontend sends approval/denial response
- [ ] Backend handles permission response
- [ ] Whitelist storage for remembered decisions
- [ ] Session status management (generating → paused → generating)

## Architecture

### Backend Changes

**New/Modified Files:**
1. `src/main/presenter/deepchatAgentPresenter/permissionChecker.ts` - Permission logic
2. `src/main/presenter/deepchatAgentPresenter/dispatch.ts` - Integrate permission check
3. `src/main/presenter/newAgentPresenter/index.ts` - Add handlePermissionResponse IPC

### Frontend Changes

**New/Modified Files:**
1. `src/renderer/src/components/chat/PermissionDialog.vue` - Permission UI
2. `src/renderer/src/stores/permission.ts` - Permission state management

### State Management

```
Tool call requested
  ↓
PermissionChecker.check()
  ↓
If needs permission: emit PERMISSION_REQUEST
  ↓
Frontend: Show dialog, pause UI
  ↓
Backend: Set session.status = 'paused'
  ↓
User: Approve/Deny
  ↓
Frontend: send handlePermissionResponse(approved, remember)
  ↓
Backend: If approved, add to whitelist (if remember)
  ↓
Backend: Resume tool execution (or return error)
```

## Event Flow

```
Agent calls tool
  ↓
PermissionChecker.check(toolName, path)
  ↓
If needs permission:
  ↓
eventBus.send(PERMISSION_EVENTS.REQUEST, { sessionId, toolName, path, action })
  ↓
Frontend shows PermissionDialog
  ↓
Backend: session.status = 'paused'
  ↓
User clicks Approve/Deny
  ↓
Frontend: newAgentPresenter.handlePermissionResponse(sessionId, approved, remember)
  ↓
Backend: If approved && remember → add to whitelist
  ↓
Backend: Resume or reject tool call
  ↓
Backend: session.status = 'generating' or 'idle'
```

## Edge Cases

### 1. User Closes Dialog Without Decision

**Handling:**
- Timeout after X minutes
- Auto-deny on timeout
- Clean up pending state

### 2. User Switches Sessions During Permission Wait

**Handling:**
- Permission dialog stays for original session
- Other session interactions blocked
- Clear session indicator in dialog

### 3. Multiple Permission Requests

**Handling:**
- Queue requests
- Show one at a time
- Process in order

### 4. Network Disconnection During Permission Wait

**Handling:**
- Backend has timeout
- Auto-deny on timeout
- Frontend shows disconnected state

## Testing Checklist

### Unit Tests

- [ ] PermissionChecker correctly identifies when permission needed
- [ ] Whitelist matching works correctly
- [ ] Full access mode bypasses permission
- [ ] Default mode requires permission

### Integration Tests

- [ ] Tool call triggers permission request
- [ ] Approval resumes execution
- [ ] Denial returns error
- [ ] Remember decision adds to whitelist
- [ ] Session status updates correctly

### Manual Tests

- [ ] Trigger file read outside workspace
- [ ] Approve → tool executes
- [ ] Deny → error shown
- [ ] Check "remember" → second time auto-approves
- [ ] Switch permission mode → behavior changes

## Dependencies

### Internal Dependencies

- **Feature 1:** Generating Session IDs Tracking (status management)
- **Feature 2:** Input Box Disable + Stop Button (may disable during permission wait)

### External Dependencies

- None

## Related Features

- **Feature 2:** Input Box Disable + Stop Button
- **Feature 5:** Session List Auto-Refresh

---

**Status:** 📝 Spec Complete  
**Priority:** P0  
**Estimated Implementation:** 2-3 days  
**Risk Level:** Medium
