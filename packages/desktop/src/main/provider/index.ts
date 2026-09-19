import { ProviderRuntimeCore } from '@deepchat/provider'
import type { ProviderSettingsPort } from './settings'
import type { ProviderLocalePort } from '@deepchat/shared/provider/locale'
import type { AgentSettingsPort } from '@/agent/settings'
import type { McpSettings } from '@/mcp/settings'
import type { AcpRuntimeOwner } from '@/agent/acp/client'
import type { AcpSessionPersistence } from '@/agent/acp/runtime'
import type { DeepchatEventPublisher } from '@deepchat/shared/contracts/events'
import type { AcpConfigState, AcpDebugRequest, AcpDebugRunResult } from '@deepchat/shared/types/acp'
import type {
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult,
  OllamaModel,
  ProviderRuntimePort
} from '@deepchat/shared/types/provider'
import type { ShowResponse } from 'ollama'
import { ModelScopeSyncManager } from './managers/modelScopeSyncManager'
import { OllamaManager } from './managers/ollamaManager'
import { AcpProvider } from './providers/acpProvider'
import { GithubCopilotProvider } from './providers/githubCopilotProvider'
import { OllamaProvider } from './providers/ollamaProvider'
import { createDesktopProviderHost } from './desktopHost'

export class ProviderRuntime extends ProviderRuntimeCore implements ProviderRuntimePort {
  private readonly ollamaManager: OllamaManager
  private readonly modelScopeSyncManager: ModelScopeSyncManager
  constructor(
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort,
    agentSettings: Pick<AgentSettingsPort, 'getAcpEnabled' | 'getAcpAgents'>,
    mcpSettings: McpSettings,
    acpRuntimeOwner: AcpRuntimeOwner,
    private readonly acpSessionPersistence: AcpSessionPersistence,
    publishEvent: DeepchatEventPublisher
  ) {
    const host = createDesktopProviderHost(locale)
    super(providerSettings, host, publishEvent, (provider) => {
      if (provider.id === 'acp')
        return new AcpProvider(
          provider,
          providerSettings,
          locale,
          agentSettings,
          acpRuntimeOwner,
          publishEvent
        )
      if (provider.id === 'github-copilot')
        return new GithubCopilotProvider(provider, providerSettings, locale)
      if (provider.id === 'ollama' || provider.apiType === 'ollama')
        return new OllamaProvider(provider, providerSettings, locale)
      return undefined
    })
    this.ollamaManager = new OllamaManager({
      getProviderInstance: this.getProviderInstance.bind(this),
      publishEvent
    })
    this.modelScopeSyncManager = new ModelScopeSyncManager({ providerSettings, mcpSettings })
  }
  async clearAcpSession(conversationId: string): Promise<void> {
    const acpProvider = this.getExistingProviderInstance('acp') as
      | { clearSession?: (conversationId: string) => Promise<void> }
      | undefined
    if (acpProvider?.clearSession) {
      await acpProvider.clearSession(conversationId)
    }
  }

  getOllamaProviderInstance(providerId: string): OllamaProvider | null {
    return this.ollamaManager.getOllamaProviderInstance(providerId)
  }
  // ollama api
  listOllamaModels(providerId: string): Promise<OllamaModel[]> {
    return this.ollamaManager.listOllamaModels(providerId)
  }
  showOllamaModelInfo(providerId: string, modelName: string): Promise<ShowResponse> {
    return this.ollamaManager.showOllamaModelInfo(providerId, modelName)
  }
  listOllamaRunningModels(providerId: string): Promise<OllamaModel[]> {
    return this.ollamaManager.listOllamaRunningModels(providerId)
  }
  pullOllamaModels(providerId: string, modelName: string): Promise<boolean> {
    return this.ollamaManager.pullOllamaModels(providerId, modelName)
  }
  async syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult> {
    return this.modelScopeSyncManager.syncModelScopeMcpServers(providerId, syncOptions)
  }

  async setAcpWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    const provider = this.getAcpProviderInstance()
    if (provider) {
      await provider.updateAcpWorkdir(conversationId, agentId, workdir)
      return
    }

    const requestedWorkdir = workdir?.trim() ? workdir.trim() : null
    const trimmed =
      requestedWorkdir && this.acpSessionPersistence.isWorkdirUsable(requestedWorkdir)
        ? requestedWorkdir
        : null
    if (requestedWorkdir && !trimmed) {
      console.warn(
        `[ACP] Ignoring unavailable ACP workdir "${requestedWorkdir}" for conversation ${conversationId} (agent ${agentId}); using default workdir.`
      )
    }
    await this.acpSessionPersistence.updateWorkdir(conversationId, agentId, trimmed)
  }

  async warmupAcpProcess(agentId: string, workdir?: string): Promise<void> {
    const provider = this.getAcpProviderInstance()
    if (!provider) return
    try {
      await provider.warmupProcess(agentId, workdir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('shutting down')) {
        console.warn(
          `[ACP] Cannot warmup process for agent ${agentId}: process manager is shutting down`
        )
        return
      }
      throw error
    }
  }

  async getAcpProcessConfigOptions(
    agentId: string,
    workdir?: string
  ): Promise<AcpConfigState | null> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      return null
    }
    return provider.getProcessConfigOptions(agentId, workdir)
  }

  async getAcpSessionConfigOptions(conversationId: string): Promise<AcpConfigState | null> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      return null
    }
    return await provider.getSessionConfigOptions(conversationId)
  }

  async setAcpSessionConfigOption(
    conversationId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      throw new Error('[ACP] ACP provider not found')
    }
    return await provider.setSessionConfigOption(conversationId, configId, value)
  }

  async getAcpSessionCommands(conversationId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  > {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      return []
    }
    return await provider.getSessionCommands(conversationId)
  }

  async runAcpDebugAction(request: AcpDebugRequest): Promise<AcpDebugRunResult> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      throw new Error('ACP provider unavailable')
    }
    return await provider.runDebugAction(request)
  }

  async resolveAgentPermission(requestId: string, granted: boolean): Promise<void> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      throw new Error('ACP provider unavailable')
    }
    await provider.resolvePermissionRequest(requestId, granted)
  }

  private getAcpProviderInstance(): AcpProvider | null {
    try {
      const instance = this.getProviderInstance('acp')
      return instance instanceof AcpProvider ? (instance as AcpProvider) : null
    } catch (error) {
      console.warn('[ProviderRuntime] ACP provider unavailable:', error)
      return null
    }
  }
}
