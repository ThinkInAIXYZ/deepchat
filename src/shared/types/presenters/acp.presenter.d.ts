/**
 * ACP Presenter Interface
 */

import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

/**
 * ACP Session 信息（Plain Object，可通过 IPC 传递）
 */
export interface AcpSessionInfo {
  sessionId: string
  agentId: string
  workdir: string
  status: 'active' | 'idle'
  createdAt: number
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModelId?: string
  availableCommands?: Array<{ name: string; description: string }>
}

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

/**
 * 权限响应
 */
export interface AcpPermissionResponse {
  requestId: string
  granted: boolean
  selectedOptionId?: string
}

/**
 * ACP Presenter 接口
 */
export interface IAcpPresenter {
  // 初始化
  initialize(): Promise<void>

  // Agent 管理
  getAgents(): Promise<any[]>
  getAgentById(agentId: string): Promise<any | null>

  // Session 管理
  createSession(agentId: string, workdir: string): Promise<AcpSessionInfo>
  loadSession(agentId: string, sessionId: string, workdir: string): Promise<AcpSessionInfo>
  getSessionInfo(sessionId: string): AcpSessionInfo | null
  closeSession(sessionId: string): Promise<void>
  listSessions(): AcpSessionInfo[]

  // 消息发送
  sendPrompt(sessionId: string, input: AcpPromptInput): Promise<void>
  cancelPrompt(sessionId: string): Promise<void>

  // Mode/Model 管理
  setSessionMode(sessionId: string, modeId: string): Promise<void>
  setSessionModel(sessionId: string, modelId: string): Promise<void>

  // 权限处理
  resolvePermission(response: AcpPermissionResponse): Promise<void>

  // 进程管理
  warmupProcess(agentId: string, workdir: string): Promise<void>
  releaseProcess(agentId: string, workdir: string): Promise<void>

  // 生命周期
  shutdown(): Promise<void>
}
