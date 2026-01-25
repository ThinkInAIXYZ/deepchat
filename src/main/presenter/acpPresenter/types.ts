/**
 * ACP Presenter Type Definitions
 *
 * 独立的 ACP 服务层类型定义
 * 不依赖 LLM Provider 体系
 */

import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { ClientSideConnection } from '@agentclientprotocol/sdk'

// ============================================================================
// Session Types (Plain Objects - 可通过 IPC 传递)
// ============================================================================

/**
 * ACP Session 信息（返回给 UI 的 Plain Object）
 * 注意：不包含 connection 等不可序列化的对象
 */
export interface AcpSessionInfo {
  sessionId: string // Agent 生成的 Session ID
  agentId: string
  workdir: string // 不可变
  status: 'active' | 'idle'
  createdAt: number

  // Agent 提供的能力（Plain Data）
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModelId?: string
  availableCommands?: Array<{ name: string; description: string }>
}

/**
 * ACP Session 记录（内部使用，包含 connection）
 * 注意：只在内存中维护，不持久化
 */
export interface AcpSessionRecord extends AcpSessionInfo {
  connection: ClientSideConnection // 内部使用，不暴露给 UI
  processId: string // 关联的进程 ID
  detachHandlers: Array<() => void> // 事件监听器清理函数
}

// ============================================================================
// Input Types (多模态输入支持)
// ============================================================================

/**
 * 多模态输入接口
 */
export interface AcpPromptInput {
  text?: string
  images?: Array<{
    type: 'url' | 'base64' | 'file'
    data: string
  }>
  files?: Array<{
    path: string
    name: string
  }>
}

// ============================================================================
// Process Types
// ============================================================================

/**
 * ACP 进程句柄
 */
export interface AcpProcessHandle {
  agentId: string
  workdir: string
  pid?: number
  status: 'spawning' | 'ready' | 'error'
  connection?: ClientSideConnection
  createdAt: number
  lastHeartbeatAt?: number
}

// ============================================================================
// Permission Types
// ============================================================================

/**
 * 权限请求上下文
 */
export interface AcpPermissionRequest {
  requestId: string
  sessionId: string
  agentId: string
  params: schema.RequestPermissionRequest
}

/**
 * 权限响应
 */
export interface AcpPermissionResponse {
  requestId: string
  granted: boolean
  selectedOptionId?: string
}

// ============================================================================
// Event Payload Types
// ============================================================================

/**
 * Session 更新事件 Payload
 */
export interface AcpSessionUpdatePayload {
  sessionId: string
  notification: schema.SessionNotification
}

/**
 * 权限请求事件 Payload
 */
export interface AcpPermissionRequestPayload {
  requestId: string
  sessionId: string
  agentId: string
  title?: string
  description?: string
  options: Array<{
    optionId: string
    label?: string
    kind?: string
    description?: string
  }>
}

/**
 * 错误事件 Payload
 */
export interface AcpErrorPayload {
  sessionId?: string
  agentId?: string
  error: string
  code?: string
}

// ============================================================================
// Manager Options
// ============================================================================

/**
 * Process Manager 配置选项
 */
export interface AcpProcessManagerOptions {
  getUseBuiltinRuntime: () => boolean
  getNpmRegistry: () => Promise<string | null>
  getUvRegistry: () => Promise<string | null>
}

/**
 * Session Manager 配置选项
 */
export interface AcpSessionManagerOptions {
  processManager: any // 将在实现时指定具体类型
}
