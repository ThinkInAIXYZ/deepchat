# Permission Approval Flow - Tasks

## Task List

### Task 1: Create PermissionChecker Class

**File:** `src/main/presenter/deepchatAgentPresenter/permissionChecker.ts`

**Required Change:**
```typescript
export class PermissionChecker {
  constructor(private session: Session) {}

  async needsPermission(toolName: string, path?: string): Promise<boolean> {
    // Full access mode: only check projectDir boundary
    if (this.session.permission_mode === 'full') {
      if (path && !this.isWithinProjectDir(path)) {
        throw new Error('Operation outside project directory')
      }
      return false // Auto-approve within boundary
    }

    // Default mode: check whitelist
    const whitelisted = await this.isWhitelisted(toolName, path)
    return !whitelisted
  }

  async addToWhitelist(toolName: string, pathPattern: string): Promise<void> {
    // Add to permission_whitelists table
  }

  private isWithinProjectDir(path: string): boolean {
    const normalized = path.resolve(path)
    const projectDir = path.resolve(this.session.projectDir)
    return normalized.startsWith(projectDir)
  }
}
```

---

### Task 2: Integrate Permission Check in dispatch.ts

**File:** `src/main/presenter/deepchatAgentPresenter/dispatch.ts`

**Required Change:**
```typescript
async executeTools(toolCall: ToolCall) {
  const checker = new PermissionChecker(this.session)
  
  // Check if permission needed
  const needsPerm = await checker.needsPermission(toolCall.name, toolCall.path)
  
  if (needsPerm) {
    // Emit permission request
    eventBus.sendToRenderer(PERMISSION_EVENTS.REQUEST, {
      sessionId: this.session.id,
      toolName: toolCall.name,
      path: toolCall.path,
      action: toolCall.action
    })
    
    // Pause stream processing
    this.session.status = 'paused'
    
    // Wait for response (set up promise)
    const approved = await this.waitForPermissionResponse()
    
    if (!approved) {
      return { error: 'Permission denied' }
    }
    
    this.session.status = 'generating'
  }
  
  // Execute tool
  return await this.callTool(toolCall)
}
```

---

### Task 3: Create PermissionDialog Component

**File:** `src/renderer/src/components/chat/PermissionDialog.vue`

**Required Change:**
```vue
<template>
  <div class="permission-dialog">
    <h3>Permission Required</h3>
    <p>Tool: {{ request.toolName }}</p>
    <p>Path: {{ request.path }}</p>
    <p>Action: {{ request.action }}</p>
    
    <label>
      <input type="checkbox" v-model="remember" />
      Remember this decision
    </label>
    
    <button @click="handleApprove">Approve</button>
    <button @click="handleDeny">Deny</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { usePresenter } from '@/composables/usePresenter'

const request = ref<PermissionRequest | null>(null)
const remember = ref(false)

const newAgentPresenter = usePresenter('newAgent')

function handleApprove() {
  newAgentPresenter.handlePermissionResponse(request.value.sessionId, true, remember.value)
}

function handleDeny() {
  newAgentPresenter.handlePermissionResponse(request.value.sessionId, false, remember.value)
}
</script>
```

---

### Task 4: Backend handlePermissionResponse

**File:** `src/main/presenter/newAgentPresenter/index.ts`

**Required Change:**
```typescript
async handlePermissionResponse(
  sessionId: string,
  approved: boolean,
  remember: boolean
): Promise<void> {
  const session = await this.sessionManager.getSession(sessionId)
  
  if (approved && remember) {
    // Add to whitelist
    await this.permissionChecker.addToWhitelist(
      session.pendingPermission.toolName,
      session.pendingPermission.path
    )
  }
  
  // Resolve the waiting promise
  session.permissionResolver(approved)
}
```

---

## Implementation Order

1. Task 1: PermissionChecker - Priority: High
2. Task 2: Integrate in dispatch.ts - Priority: High
3. Task 3: PermissionDialog - Priority: High
4. Task 4: handlePermissionResponse - Priority: High

## Definition of Done

- [ ] All tasks completed
- [ ] Permission flow works end-to-end
- [ ] Whitelist persistence works
- [ ] Full access mode respects boundaries
- [ ] Default mode requires approval
- [ ] Tests passing
- [ ] Manual testing completed

---

**Status:** 📝 Tasks Defined  
**Estimated Time:** 2-3 days  
**Risk Level:** Medium
