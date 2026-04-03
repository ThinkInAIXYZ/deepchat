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

export interface ConfigQueryPort {
  getProviderModels(providerId: string): ModelIdentity[]
  getCustomModels(providerId: string): ModelIdentity[]
  getAgentType(agentId: string): Promise<'deepchat' | 'acp' | null>
}

export interface SessionRuntimePort {
  refreshSessionUi(): void
  clearSessionPermissions(sessionId: string): void
  approvePermission(sessionId: string, permission: SessionPermissionRequest): Promise<void>
}

export interface WindowRoutingPort {
  createSettingsWindow(): Promise<number>
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): void
}
