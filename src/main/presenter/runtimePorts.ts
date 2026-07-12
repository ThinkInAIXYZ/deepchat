import type { AcpConfigState, AcpDebugRequest, AcpDebugRunResult } from '@shared/presenter'

type ModelIdentity = {
  id: string
  name?: string | null
}

export type SessionPermissionRequest = {
  permissionType: 'read' | 'write' | 'all' | 'command'
  serverName?: string
  toolName?: string
  command?: string
  commandSignature?: string
  paths?: string[]
  commandInfo?: {
    command: string
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
    suggestion: string
    signature?: string
    baseCommand?: string
  }
}

export interface ProviderCatalogPort {
  getProviderModels(providerId: string): ModelIdentity[]
  getCustomModels(providerId: string): ModelIdentity[]
  getAgentType(agentId: string): Promise<'deepchat' | 'acp' | null>
}

export interface AcpAsLlmProviderSessionControlPort {
  setAcpWorkdir(conversationId: string, agentId: string, workdir: string | null): Promise<void>
  getAcpSessionConfigOptions(conversationId: string): Promise<AcpConfigState | null>
  setAcpSessionConfigOption(
    conversationId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null>
  getAcpSessionCommands(conversationId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  >
  clearAcpSession(conversationId: string): Promise<void>
}

export interface AcpAsLlmProviderPermissionPort {
  resolveAgentPermission(requestId: string, granted: boolean): Promise<void>
}

export interface AcpProviderAdminPort {
  warmupAcpProcess(agentId: string, workdir?: string): Promise<void>
  getAcpProcessConfigOptions(agentId: string, workdir?: string): Promise<AcpConfigState | null>
  runAcpDebugAction(request: AcpDebugRequest): Promise<AcpDebugRunResult>
}

export interface SessionPermissionPort {
  clearSessionPermissions(sessionId: string): void
  approvePermission(sessionId: string, permission: SessionPermissionRequest): Promise<void>
}

export interface SessionUiPort {
  refreshSessionUi(): void
}

export interface WindowRoutingPort {
  createSettingsWindow(): Promise<number>
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): void
}
