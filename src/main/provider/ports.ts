import type { AcpConfigState, AcpDebugRequest, AcpDebugRunResult } from '@shared/types/acp'

type ModelIdentity = {
  id: string
  name?: string | null
}

export interface ProviderCatalogPort {
  getProviderModels(providerId: string): ModelIdentity[]
  getCustomModels(providerId: string): ModelIdentity[]
  getAgentType(agentId: string): Promise<'deepchat' | 'acp' | null>
}

export interface ProviderLocalePort {
  getLanguage(): string
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
