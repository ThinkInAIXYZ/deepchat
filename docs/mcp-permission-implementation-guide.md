# MCP Permission System Implementation Guide

## Overview

This document provides step-by-step implementation instructions for the MCP Tool Permission Request System in DeepChat.

## Prerequisites

- Understanding of DeepChat's architecture (LLMProviderPresenter, ThreadPresenter, ToolManager)
- Familiarity with Vue 3 Composition API
- Knowledge of TypeScript and event-driven programming

## Implementation Steps

### Step 1: Update Type Definitions

#### 1.1 Add Permission Block Type

In `src/shared/chat.d.ts`, add the new permission block type:

```typescript
export type AssistantMessageBlock = {
  type:
    | 'content'
    | 'search'
    | 'reasoning_content'
    | 'error'
    | 'tool_call'
    | 'action'
    | 'tool_call_permission'  // NEW: Permission request block
    | 'image'
    | 'artifact-thinking'
  // ... existing fields
}
```

#### 1.2 Update Tool Response Types

In `src/shared/presenter.d.ts`, add permission-related types:

```typescript
export interface MCPToolResponse {
  // ... existing fields
  requiresPermission?: boolean
  permissionRequest?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all'
    description: string
  }
}
```

### Step 2: Modify ToolManager

#### 2.1 Update Permission Check Logic

In `src/main/presenter/mcpPresenter/toolManager.ts`:

```typescript
async callTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
  // ... existing code for tool resolution and argument parsing

  // Check permissions
  const hasPermission = this.checkToolPermission(originalName, toolServerName, autoApprove)

  if (!hasPermission) {
    const permissionType = this.determinePermissionType(originalName)
    
    return {
      toolCallId: toolCall.id,
      content: `Permission required: The '${originalName}' operation requires ${permissionType} permissions.`,
      isError: false,
      requiresPermission: true,
      permissionRequest: {
        toolName: originalName,
        serverName: toolServerName,
        permissionType,
        description: `Allow ${originalName} to perform ${permissionType} operations on ${toolServerName}?`
      }
    }
  }

  // ... existing tool execution code
}
```

#### 2.2 Add Permission Management Methods

```typescript
export class ToolManager {
  // ... existing code

  async grantPermission(serverName: string, permissionType: 'read' | 'write' | 'all', remember: boolean = false): Promise<void> {
    if (remember) {
      await this.updateServerPermissions(serverName, permissionType)
    }
  }

  private async updateServerPermissions(serverName: string, permissionType: 'read' | 'write' | 'all'): Promise<void> {
    const servers = await this.configPresenter.getMcpServers()
    const serverConfig = servers[serverName]
    
    if (serverConfig) {
      const autoApprove = [...(serverConfig.autoApprove || [])]
      
      if (permissionType === 'all') {
        autoApprove.length = 0 // Clear existing permissions
        autoApprove.push('all')
      } else if (!autoApprove.includes(permissionType) && !autoApprove.includes('all')) {
        autoApprove.push(permissionType)
      }
      
      await this.configPresenter.updateMcpServer(serverName, {
        ...serverConfig,
        autoApprove
      })
    }
  }
}
```

### Step 3: Update LLMProviderPresenter Agent Loop

#### 3.1 Handle Permission Requests

In `src/main/presenter/llmProviderPresenter/index.ts`, modify the tool execution section:

```typescript
// Inside the agent loop, in tool execution section
try {
  const toolResponse = await presenter.mcpPresenter.callTool(mcpToolInput)

  if (abortController.signal.aborted) break

  // Check if permission is required
  if (toolResponse.requiresPermission) {
    // Create permission request block
    yield {
      type: 'response',
      data: {
        eventId,
        tool_call: 'permission-required',
        tool_call_id: toolCall.id,
        tool_call_name: toolCall.name,
        tool_call_params: toolCall.arguments,
        tool_call_server_name: toolResponse.permissionRequest?.serverName,
        tool_call_server_icons: toolDef.server.icons,
        tool_call_server_description: toolDef.server.description,
        tool_call_response: toolResponse.content,
        permission_request: toolResponse.permissionRequest
      }
    }
    
    // Pause the agent loop
    needContinueConversation = false
    break
  }

  // ... continue with normal tool response handling
} catch (toolError) {
  // ... existing error handling
}
```

### Step 4: Update ThreadPresenter

#### 4.1 Handle Permission Blocks

In `src/main/presenter/threadPresenter/index.ts`, add permission block handling:

```typescript
// In handleLLMAgentResponse method
if (tool_call === 'permission-required') {
  finalizeLastBlock()
  
  const { permission_request } = msg
  
  state.message.content.push({
    type: 'tool_call_permission',
    content: tool_call_response || 'Permission required for this operation',
    status: 'pending',
    timestamp: currentTime,
    tool_call: {
      id: tool_call_id,
      name: tool_call_name,
      params: tool_call_params || '',
      server_name: tool_call_server_name,
      server_icons: tool_call_server_icons,
      server_description: tool_call_server_description
    },
    extra: {
      permissionType: permission_request?.permissionType || 'write',
      serverName: permission_request?.serverName || tool_call_server_name,
      toolName: permission_request?.toolName || tool_call_name,
      needsUserAction: true
    }
  })
}
```

#### 4.2 Add Permission Response Handler

```typescript
export class ThreadPresenter implements IThreadPresenter {
  // ... existing code

  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all',
    remember: boolean = false
  ): Promise<void> {
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      throw new Error('Message not found or not in generating state')
    }

    // Update the permission block
    const permissionBlock = state.message.content.find(
      block => block.type === 'tool_call_permission' && 
               block.tool_call?.id === toolCallId
    )

    if (permissionBlock) {
      permissionBlock.status = granted ? 'granted' : 'denied'
      if (permissionBlock.extra) {
        permissionBlock.extra.needsUserAction = false
        if (granted) {
          permissionBlock.extra.grantedPermissions = [permissionType]
        }
      }
      
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
    }

    if (granted) {
      // Grant permission in ToolManager
      const serverName = permissionBlock?.extra?.serverName as string
      if (serverName) {
        await presenter.mcpPresenter.grantPermission(serverName, permissionType, remember)
      }
      
      // Continue the agent loop
      await this.continueWithPermission(messageId, toolCallId)
    }
  }

  private async continueWithPermission(messageId: string, toolCallId: string): Promise<void> {
    // Resume the agent loop for this specific tool call
    // This involves re-executing the tool and continuing the conversation
    const state = this.generatingMessages.get(messageId)
    if (!state) return

    // Find the tool call that needs to be re-executed
    const permissionBlock = state.message.content.find(
      block => block.type === 'tool_call_permission' && 
               block.tool_call?.id === toolCallId
    )

    if (!permissionBlock?.tool_call) return

    // Re-execute the tool call
    try {
      const mcpToolInput: MCPToolCall = {
        id: permissionBlock.tool_call.id!,
        type: 'function',
        function: {
          name: permissionBlock.tool_call.name!,
          arguments: permissionBlock.tool_call.params!
        },
        server: {
          name: permissionBlock.tool_call.server_name!,
          icons: permissionBlock.tool_call.server_icons!,
          description: permissionBlock.tool_call.server_description!
        }
      }

      const toolResponse = await presenter.mcpPresenter.callTool(mcpToolInput)

      // Send tool result and continue conversation
      eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
        eventId: messageId,
        tool_call: 'end',
        tool_call_id: toolCallId,
        tool_call_name: permissionBlock.tool_call.name,
        tool_call_response: typeof toolResponse.content === 'string' 
          ? toolResponse.content 
          : JSON.stringify(toolResponse.content),
        tool_call_response_raw: toolResponse
      })

      // Resume agent loop by restarting stream completion
      await this.resumeStreamCompletion(state.conversationId, messageId)
      
    } catch (error) {
      console.error('Failed to continue with permission:', error)
    }
  }
}
```

### Step 5: Create Frontend Permission Component

#### 5.1 Create Permission Request Component

Create `src/renderer/src/components/message/MessageBlockPermissionRequest.vue`:

```vue
<template>
  <div class="permission-request-block">
    <div class="permission-header">
      <Icon icon="lucide:shield-alert" class="w-5 h-5 text-amber-500" />
      <h3>Permission Required</h3>
    </div>
    
    <div class="permission-content">
      <div class="tool-info">
        <div class="tool-icon">
          <img v-if="block.tool_call?.server_icons" 
               :src="block.tool_call.server_icons" 
               class="w-8 h-8" />
          <Icon v-else icon="lucide:tool" class="w-8 h-8" />
        </div>
        <div class="tool-details">
          <h4>{{ block.tool_call?.name }}</h4>
          <p>{{ block.tool_call?.server_name }}</p>
          <p class="permission-type">
            Requires {{ block.extra?.permissionType }} permissions
          </p>
        </div>
      </div>
      
      <p class="permission-description">{{ block.content }}</p>
      
      <div v-if="block.extra?.needsUserAction" class="permission-actions">
        <div class="remember-choice">
          <input v-model="rememberChoice" type="checkbox" id="remember" />
          <label for="remember">Remember this choice</label>
        </div>
        
        <div class="action-buttons">
          <button @click="denyPermission" class="deny-btn">Deny</button>
          <button @click="grantPermission" class="grant-btn">Allow</button>
        </div>
      </div>
      
      <div v-else class="permission-result">
        <Icon :icon="block.status === 'granted' ? 'lucide:check-circle' : 'lucide:x-circle'" 
              :class="block.status === 'granted' ? 'text-green-500' : 'text-red-500'" />
        <span>{{ block.status === 'granted' ? 'Permission granted' : 'Permission denied' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { usePresenter } from '@/composables/usePresenter'
import { AssistantMessageBlock } from '@shared/chat'

const props = defineProps<{
  block: AssistantMessageBlock
  messageId: string
  conversationId: string
}>()

const threadPresenter = usePresenter('threadPresenter')
const rememberChoice = ref(false)

const grantPermission = async () => {
  if (!props.block.tool_call?.id || !props.block.extra?.permissionType) return
  
  await threadPresenter.handlePermissionResponse(
    props.messageId,
    props.block.tool_call.id,
    true,
    props.block.extra.permissionType as 'read' | 'write' | 'all',
    rememberChoice.value
  )
}

const denyPermission = async () => {
  if (!props.block.tool_call?.id || !props.block.extra?.permissionType) return
  
  await threadPresenter.handlePermissionResponse(
    props.messageId,
    props.block.tool_call.id,
    false,
    props.block.extra.permissionType as 'read' | 'write' | 'all',
    false
  )
}
</script>

<style scoped>
.permission-request-block {
  @apply border border-amber-200 bg-amber-50 rounded-lg p-4 my-2;
}

.permission-header {
  @apply flex items-center gap-2 mb-3;
}

.permission-header h3 {
  @apply font-semibold text-amber-800;
}

.tool-info {
  @apply flex items-start gap-3 mb-3;
}

.tool-details h4 {
  @apply font-medium;
}

.tool-details p {
  @apply text-sm text-gray-600;
}

.permission-type {
  @apply text-amber-700 font-medium;
}

.permission-actions {
  @apply space-y-3;
}

.remember-choice {
  @apply flex items-center gap-2;
}

.action-buttons {
  @apply flex gap-2;
}

.deny-btn {
  @apply px-4 py-2 border border-gray-300 rounded hover:bg-gray-50;
}

.grant-btn {
  @apply px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600;
}

.permission-result {
  @apply flex items-center gap-2;
}
</style>
```

#### 5.2 Register Component in MessageItemAssistant

In `src/renderer/src/components/message/MessageItemAssistant.vue`:

```vue
<template>
  <!-- ... existing template -->
  
  <MessageBlockPermissionRequest
    v-else-if="block.type === 'tool_call_permission'"
    :block="block"
    :message-id="message.id"
    :conversation-id="currentThreadId"
  />
  
  <!-- ... rest of template -->
</template>

<script setup lang="ts">
// ... existing imports
import MessageBlockPermissionRequest from './MessageBlockPermissionRequest.vue'

// ... existing code
</script>
```

### Step 6: Add Presenter Interface

#### 6.1 Update ThreadPresenter Interface

In `src/shared/presenter.d.ts`:

```typescript
export interface IThreadPresenter {
  // ... existing methods
  
  handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean
  ): Promise<void>
}
```

#### 6.2 Update MCPPresenter Interface

```typescript
export interface IMcpPresenter {
  // ... existing methods
  
  grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean
  ): Promise<void>
}
```

## Testing the Implementation

### Test Cases

1. **Permission Request Flow**
   - Trigger a tool call that requires permissions
   - Verify permission block is created
   - Test grant and deny actions
   - Verify conversation continues after grant

2. **Permission Persistence**
   - Grant permission with "remember" checked
   - Verify subsequent calls don't require permission
   - Test permission management in settings

3. **Error Handling**
   - Test permission denial
   - Test network errors during permission check
   - Test malformed permission requests

### Manual Testing

1. Set up an MCP server without auto-approve permissions
2. Start a conversation that requires tool usage
3. Verify permission request UI appears
4. Test granting and denying permissions
5. Verify conversation flow continues correctly

## Rollout Plan

1. **Phase 1**: Implement core backend logic (Steps 1-4)
2. **Phase 2**: Implement frontend UI (Step 5)
3. **Phase 3**: Add presenter interfaces (Step 6)
4. **Phase 4**: Testing and refinement
5. **Phase 5**: Documentation and deployment

This implementation provides a robust, user-friendly permission system that integrates seamlessly with DeepChat's existing architecture while maintaining security and usability.