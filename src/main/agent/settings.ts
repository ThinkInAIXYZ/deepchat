import logger from '@shared/logger'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import type { ModelConfig } from '@shared/types/provider'
import type { AcpAgentConfig } from '@shared/types/acp'
import type {
  AcpAgentInstallState,
  AcpAgentState,
  AcpManualAgent,
  AcpRegistryAgent,
  AcpResolvedLaunchSpec
} from '@shared/types/acp'
import type {
  Agent,
  AgentType,
  CreateDeepChatAgentInput,
  DeepChatAgentConfig,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'
import { DEFAULT_DISABLED_AGENT_TOOLS } from '@shared/agentTools'
import { normalizeDeepChatSubagentConfig } from '@shared/lib/deepchatSubagents'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import type { SettingsStore } from '@/config/settingsStore'
import { AcpCatalogSettings } from '@/agent/acp/catalog/settings'
import { AcpRegistryService } from '@/agent/acp/catalog/acpRegistryService'
import { AcpLaunchSpecService } from '@/agent/acp/launch/acpLaunchSpecService'
import { AgentRepository, BUILTIN_DEEPCHAT_AGENT_ID } from '@/agent/repository'

const UNIFIED_AGENTS_MIGRATION_VERSION = 2
const DEPRECATED_BUILTIN_PROVIDER_IDS = ['qwenlm', 'laoshi'] as const
const MEMORY_MAINTENANCE_TRIGGER_CONFIG_KEYS: readonly (keyof DeepChatAgentConfig)[] = [
  'memoryEnabled',
  'memoryEmbedding',
  'memoryExtractionModel',
  'personaEvolutionEnabled',
  'assistantModel',
  'defaultModelPreset'
]

type ModelSelection = { providerId: string; modelId: string }

export interface AgentSettingsProviderPort {
  getModelConfig(modelId: string, providerId?: string): ModelConfig
  setAcpProviderEnabled(enabled: boolean): void
  clearAcpProviderModels(): void
  clearAcpProviderModelStatus(): void
  refreshAcpProviderAgents(agentIds?: string[]): Promise<void>
}

export interface AgentSettingsEvents {
  publishCatalogChanged(agentIds?: string[]): void
  publishAcpModelsChanged(): void
  publishSessionsUpdated(): void
}

export interface AgentSettingsPort {
  getAcpEnabled(): Promise<boolean>
  setAcpEnabled(enabled: boolean): Promise<void>
  listAcpRegistryAgents(): Promise<AcpRegistryAgent[]>
  refreshAcpRegistry(force?: boolean): Promise<AcpRegistryAgent[]>
  getAcpRegistryIconMarkup(agentId: string, iconUrl?: string): Promise<string | null>
  getAcpAgentState(agentId: string): Promise<AcpAgentState | null>
  setAcpAgentEnabled(agentId: string, enabled: boolean): Promise<void>
  setAcpAgentEnvOverride(agentId: string, env: Record<string, string>): Promise<void>
  ensureAcpAgentInstalled(agentId: string): Promise<AcpAgentInstallState>
  repairAcpAgent(agentId: string): Promise<AcpAgentInstallState>
  uninstallAcpRegistryAgent(agentId: string): Promise<void>
  listManualAcpAgents(): Promise<AcpManualAgent[]>
  addManualAcpAgent(
    agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }
  ): Promise<AcpManualAgent>
  updateManualAcpAgent(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): Promise<AcpManualAgent | null>
  removeManualAcpAgent(agentId: string): Promise<boolean>
  getAcpAgents(): Promise<AcpAgentConfig[]>
  resolveAcpLaunchSpec(agentId: string, workdir?: string): Promise<AcpResolvedLaunchSpec>
  getAcpSharedMcpSelections(): Promise<string[]>
  setAcpSharedMcpSelections(mcpIds: string[]): Promise<void>
  listAgents(): Promise<Agent[]>
  getAgent(agentId: string): Promise<Agent | null>
  getAgentType(agentId: string): Promise<AgentType | null>
  getDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig | null>
  resolveDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig>
  agentSupportsCapability(agentId: string, capability: 'vision'): Promise<boolean>
  createDeepChatAgent(input: CreateDeepChatAgentInput): Promise<Agent>
  updateDeepChatAgent(agentId: string, updates: UpdateDeepChatAgentInput): Promise<Agent | null>
  deleteDeepChatAgent(agentId: string): Promise<boolean>
  deleteDeepChatAgentWithCleanup(
    agentId: string
  ): Promise<{ removed: boolean; cleanupPendingRestart: boolean }>
  getAgentMcpSelections(agentId: string, isBuiltin?: boolean): Promise<string[]>
  setAgentMcpSelections(agentId: string, isBuiltin: boolean, mcpIds: string[]): Promise<void>
  addMcpToAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void>
  removeMcpFromAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void>
  getDefaultModel(): { providerId: string; modelId: string } | undefined
  setDefaultModel(model: { providerId: string; modelId: string } | undefined): void
}

const findChangedAcpRegistryAgentIds = (
  previousAgents: AcpRegistryAgent[],
  nextAgents: AcpRegistryAgent[]
): string[] => {
  const nextById = new Map(nextAgents.map((agent) => [agent.id, agent] as const))
  return previousAgents
    .filter((agent) => !isDeepStrictEqual(agent, nextById.get(agent.id)))
    .map((agent) => agent.id)
}

const withDeepChatAgentDefaults = (config: DeepChatAgentConfig): DeepChatAgentConfig => ({
  ...config,
  disabledAgentTools: Array.isArray(config.disabledAgentTools)
    ? [...config.disabledAgentTools]
    : [...DEFAULT_DISABLED_AGENT_TOOLS]
})

const mergeDefaultDisabledAgentTools = (
  disabledAgentTools: DeepChatAgentConfig['disabledAgentTools']
): string[] =>
  Array.from(
    new Set([
      ...(Array.isArray(disabledAgentTools) ? disabledAgentTools : []),
      ...DEFAULT_DISABLED_AGENT_TOOLS
    ])
  )

const hasMemoryMaintenanceTriggerConfigUpdate = (
  updates: Partial<DeepChatAgentConfig> | null | undefined
): boolean => {
  if (!updates) return false
  return MEMORY_MAINTENANCE_TRIGGER_CONFIG_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(updates, key)
  )
}

const normalizeModelSelection = (value: unknown): ModelSelection | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : ''
  const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : ''
  return providerId && modelId ? { providerId, modelId } : null
}

const isDeprecatedBuiltinModelSelection = (selection: unknown): boolean => {
  const normalized = normalizeModelSelection(selection)
  return Boolean(
    normalized && DEPRECATED_BUILTIN_PROVIDER_IDS.some((id) => id === normalized.providerId)
  )
}

const shouldReplaceBuiltinModelSelection = (selection: unknown): boolean =>
  normalizeModelSelection(selection) === null || isDeprecatedBuiltinModelSelection(selection)

const getLiveLegacyModelSelection = (value: unknown): ModelSelection | null => {
  const normalized = normalizeModelSelection(value)
  return normalized && !isDeprecatedBuiltinModelSelection(normalized) ? normalized : null
}

export class AgentSettings implements AgentSettingsPort {
  private readonly registry: AcpRegistryService
  private readonly launchSpecs: AcpLaunchSpecService

  constructor(
    private readonly settings: SettingsStore,
    private readonly repository: AgentRepository,
    private readonly acpCatalog: AcpCatalogSettings,
    isPrivacyModeEnabled: () => boolean,
    userDataPath: string,
    private readonly provider: AgentSettingsProviderPort,
    private readonly events: AgentSettingsEvents,
    private readonly cleanupDeletedAgent: (
      agentId: string
    ) => Promise<{ cleanupPendingRestart: boolean }>,
    private readonly notifyMemoryConfigChanged: (agentId: string) => void
  ) {
    this.registry = new AcpRegistryService({
      isPrivacyModeEnabled
    })
    this.launchSpecs = new AcpLaunchSpecService(path.join(userDataPath, 'acp-registry'))
  }

  start(): void {
    this.initializeUnifiedAgents()
    this.reconcileLegacyBuiltinAgentSelections()
    this.cleanupDeprecatedBuiltinAgentSelections()
    this.provider.setAcpProviderEnabled(this.acpCatalog.getGlobalEnabled())
    const previousAgents = this.registry.listAgents()
    void this.registry
      .initialize()
      .then(async () => {
        const registryAgents = this.registry.listAgents()
        this.syncRegistryAgentsToRepository()
        const changedAgentIds = findChangedAcpRegistryAgentIds(previousAgents, registryAgents)
        if (changedAgentIds.length > 0) {
          await this.provider.refreshAcpProviderAgents(changedAgentIds)
        }
        this.notifyAcpAgentsChanged()
      })
      .catch((error) => {
        console.error('[ACP] Failed to initialize registry service:', error)
      })
  }

  async getAcpEnabled(): Promise<boolean> {
    return this.acpCatalog.getGlobalEnabled()
  }

  async setAcpEnabled(enabled: boolean): Promise<void> {
    const enabledAgentIds = enabled ? [] : (await this.getAcpAgents()).map((agent) => agent.id)
    const changed = this.acpCatalog.setGlobalEnabled(enabled)
    if (!changed) return

    if (!enabled && enabledAgentIds.length > 0) {
      await this.provider.refreshAcpProviderAgents(enabledAgentIds)
    }
    this.provider.setAcpProviderEnabled(enabled)

    if (!enabled) {
      this.provider.clearAcpProviderModels()
      this.provider.clearAcpProviderModelStatus()
    }
    this.notifyAcpAgentsChanged()
  }

  async listAcpRegistryAgents(): Promise<AcpRegistryAgent[]> {
    this.syncRegistryAgentsToRepository()
    return this.registry.listAgents().map((agent) => {
      const overlay = this.repository.getAcpRegistryOverlay(agent.id) ?? {
        enabled: this.acpCatalog.getRegistryStates()[agent.id]?.enabled ?? false,
        envOverride: this.acpCatalog.getRegistryStates()[agent.id]?.envOverride,
        installState: this.acpCatalog.getInstallStates()[agent.id] ?? null
      }
      return {
        ...agent,
        enabled: overlay.enabled,
        envOverride: overlay.envOverride,
        installState: overlay.installState ?? null
      }
    })
  }

  async refreshAcpRegistry(force = true): Promise<AcpRegistryAgent[]> {
    const previousAgents = this.registry.listAgents()
    const refreshedAgents = await this.registry.refresh(force)
    this.syncRegistryAgentsToRepository()
    const changedAgentIds = findChangedAcpRegistryAgentIds(previousAgents, refreshedAgents)
    if (changedAgentIds.length > 0) {
      await this.provider.refreshAcpProviderAgents(changedAgentIds)
    }
    const agents = await this.listAcpRegistryAgents()
    this.notifyAcpAgentsChanged()
    return agents
  }

  async getAcpRegistryIconMarkup(agentId: string, iconUrl?: string): Promise<string | null> {
    return await this.registry.getIconMarkup(agentId, iconUrl)
  }

  async getAcpAgentState(agentId: string): Promise<AcpAgentState | null> {
    return this.repository.getAcpAgentState(resolveAcpAgentAlias(agentId)) ?? null
  }

  async setAcpAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
    const resolvedId = resolveAcpAgentAlias(agentId)
    this.repository.setAgentEnabled(resolvedId, enabled)
    this.handleAcpAgentsMutated([resolvedId])
    if (enabled) {
      void this.ensureAcpAgentInstalled(resolvedId).catch((error) => {
        console.warn(`[ACP] Failed to preinstall registry agent ${resolvedId}:`, error)
      })
    }
  }

  async setAcpAgentEnvOverride(agentId: string, env: Record<string, string>): Promise<void> {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const installState = this.repository.getAgentInstallState(resolvedId)
    if (installState?.status !== 'installed') {
      throw new Error(`ACP registry agent is not installed: ${resolvedId}`)
    }
    this.repository.setAgentEnvOverride(resolvedId, env)
    this.handleAcpAgentsMutated([resolvedId])
  }

  async ensureAcpAgentInstalled(agentId: string): Promise<AcpAgentInstallState> {
    return await this.installRegistryAgent(agentId, false)
  }

  async repairAcpAgent(agentId: string): Promise<AcpAgentInstallState> {
    return await this.installRegistryAgent(agentId, true)
  }

  async uninstallAcpRegistryAgent(agentId: string): Promise<void> {
    const registryAgent = this.getRegistryAgentOrThrow(agentId)
    if (this.repository.hasAgentSessions(registryAgent.id)) {
      throw new Error(
        'ACP registry agent still has related conversations. Move or delete them first.'
      )
    }
    const currentState = this.repository.getAgentInstallState(registryAgent.id)
    await this.launchSpecs.uninstallRegistryAgent(registryAgent, currentState)
    const updated = this.repository.clearRegistryAcpAgentInstallation(registryAgent.id, {
      status: 'not_installed',
      version: registryAgent.version,
      distributionType: this.launchSpecs.selectRegistryDistribution(registryAgent)?.type,
      lastCheckedAt: Date.now(),
      installedAt: null,
      installDir: null,
      error: null
    })
    if (!updated) {
      throw new Error(
        `ACP registry agent not found or still has related conversations: ${registryAgent.id}`
      )
    }
    this.handleAcpAgentsMutated([registryAgent.id])
  }

  async listManualAcpAgents(): Promise<AcpManualAgent[]> {
    return this.repository.listManualAcpAgents()
  }

  async addManualAcpAgent(
    agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }
  ): Promise<AcpManualAgent> {
    const created = this.repository.createManualAcpAgent(agent)
    this.handleAcpAgentsMutated([created.id])
    return created
  }

  async updateManualAcpAgent(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): Promise<AcpManualAgent | null> {
    const updated = this.repository.updateManualAcpAgent(agentId, updates)
    if (updated) this.handleAcpAgentsMutated([updated.id])
    return updated
  }

  async removeManualAcpAgent(agentId: string): Promise<boolean> {
    const removed = this.repository.removeManualAcpAgent(agentId)
    if (removed) this.handleAcpAgentsMutated([agentId])
    return removed
  }

  async getAcpAgents(): Promise<AcpAgentConfig[]> {
    if (!this.acpCatalog.getGlobalEnabled()) return []
    const [registryAgents, manualAgents] = await Promise.all([
      this.listAcpRegistryAgents(),
      this.listManualAcpAgents()
    ])
    return [
      ...registryAgents
        .filter((agent) => agent.enabled && agent.installState?.status === 'installed')
        .map((agent) => this.buildRegistryAgentConfig(agent)),
      ...manualAgents
        .filter((agent) => agent.enabled)
        .map((agent) => this.buildManualAgentConfig(agent))
    ]
  }

  async resolveAcpLaunchSpec(agentId: string, _workdir?: string): Promise<AcpResolvedLaunchSpec> {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const manualAgent = this.repository.getManualAcpAgent(resolvedId)
    if (manualAgent) return this.launchSpecs.resolveManualLaunchSpec(manualAgent)

    const registryAgent = this.getRegistryAgentOrThrow(resolvedId)
    const installState = this.repository.getAgentInstallState(registryAgent.id)
    const launchSpec = await this.launchSpecs.resolveRegistryLaunchSpec(registryAgent, installState)
    this.repository.setAgentInstallState(resolvedId, {
      status: 'installed',
      distributionType: launchSpec.distributionType,
      version: launchSpec.version,
      lastCheckedAt: Date.now(),
      installedAt: installState?.installedAt ?? Date.now(),
      installDir: launchSpec.installDir ?? null,
      error: null
    })
    return launchSpec
  }

  async getAcpSharedMcpSelections(): Promise<string[]> {
    return this.acpCatalog.getSharedMcpSelections()
  }

  async setAcpSharedMcpSelections(mcpIds: string[]): Promise<void> {
    await this.acpCatalog.setSharedMcpSelections(mcpIds)
    this.handleAcpAgentsMutated()
  }

  async listAgents(): Promise<Agent[]> {
    return this.repository.listAgents()
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    return this.repository.getAgent(agentId)
  }

  async getAgentType(agentId: string): Promise<AgentType | null> {
    return this.repository.getAgentType(agentId)
  }

  async getDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig | null> {
    const config = this.repository.getDeepChatAgentConfig(agentId)
    return config ? withDeepChatAgentDefaults(config) : null
  }

  async resolveDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig> {
    return withDeepChatAgentDefaults(
      this.repository.resolveDeepChatAgentConfig(agentId || BUILTIN_DEEPCHAT_AGENT_ID)
    )
  }

  async agentSupportsCapability(agentId: string, capability: 'vision'): Promise<boolean> {
    if (capability !== 'vision') return false
    const config = await this.resolveDeepChatAgentConfig(agentId)
    const providerId = config.visionModel?.providerId?.trim()
    const modelId = config.visionModel?.modelId?.trim()
    return Boolean(
      providerId && modelId && this.provider.getModelConfig(modelId, providerId).vision
    )
  }

  async createDeepChatAgent(input: CreateDeepChatAgentInput): Promise<Agent> {
    const created = this.repository.createDeepChatAgent(input)
    this.notifyAgentCatalogChanged()
    return created
  }

  async updateDeepChatAgent(
    agentId: string,
    updates: UpdateDeepChatAgentInput
  ): Promise<Agent | null> {
    const updated = this.repository.updateDeepChatAgent(agentId, updates)
    if (updated) {
      if (hasMemoryMaintenanceTriggerConfigUpdate(updates.config)) {
        this.publishMemoryConfigChanged(agentId)
      }
      this.notifyAgentCatalogChanged()
    }
    return updated
  }

  async deleteDeepChatAgent(agentId: string): Promise<boolean> {
    return (await this.deleteDeepChatAgentWithCleanup(agentId)).removed
  }

  async deleteDeepChatAgentWithCleanup(
    agentId: string
  ): Promise<{ removed: boolean; cleanupPendingRestart: boolean }> {
    if (!this.repository.canDeleteDeepChatAgent(agentId)) {
      return { removed: false, cleanupPendingRestart: false }
    }
    const cleanup = await this.cleanupDeletedAgent(agentId)
    const removed = this.repository.deleteDeepChatAgent(agentId)
    if (removed) this.notifyAgentCatalogChanged()
    return {
      removed,
      cleanupPendingRestart: removed && cleanup.cleanupPendingRestart
    }
  }

  async getAgentMcpSelections(agentId: string, isBuiltin?: boolean): Promise<string[]> {
    return await this.acpCatalog.getAgentMcpSelections(agentId, isBuiltin)
  }

  async setAgentMcpSelections(
    agentId: string,
    isBuiltin: boolean,
    mcpIds: string[]
  ): Promise<void> {
    await this.acpCatalog.setAgentMcpSelections(agentId, isBuiltin, mcpIds)
    this.handleAcpAgentsMutated()
  }

  async addMcpToAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void> {
    await this.acpCatalog.addMcpToAgent(agentId, isBuiltin, mcpId)
    this.handleAcpAgentsMutated()
  }

  async removeMcpFromAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void> {
    await this.acpCatalog.removeMcpFromAgent(agentId, isBuiltin, mcpId)
    this.handleAcpAgentsMutated()
  }

  getDefaultModel(): { providerId: string; modelId: string } | undefined {
    const selection = this.getBuiltinDeepChatConfig().defaultModelPreset
    return selection?.providerId && selection?.modelId
      ? { providerId: selection.providerId, modelId: selection.modelId }
      : undefined
  }

  setDefaultModel(model: { providerId: string; modelId: string } | undefined): void {
    this.updateBuiltinDeepChatConfig({
      defaultModelPreset:
        model?.providerId && model?.modelId
          ? { providerId: model.providerId, modelId: model.modelId }
          : null
    })
  }

  notifyAgentCatalogChanged(agentIds?: string[]): void {
    this.events.publishCatalogChanged(agentIds)
    this.events.publishSessionsUpdated()
  }

  private async installRegistryAgent(
    agentId: string,
    repair: boolean
  ): Promise<AcpAgentInstallState> {
    const registryAgent = this.getRegistryAgentOrThrow(agentId)
    const currentState = this.repository.getAgentInstallState(registryAgent.id)
    const installingState: AcpAgentInstallState = {
      status: 'installing',
      version: registryAgent.version,
      distributionType: this.launchSpecs.selectRegistryDistribution(registryAgent)?.type,
      lastCheckedAt: Date.now(),
      installedAt: currentState?.installedAt ?? null,
      installDir: currentState?.installDir ?? null,
      error: null
    }
    this.repository.setAgentInstallState(registryAgent.id, installingState)
    this.notifyAcpAgentsChanged([registryAgent.id])
    if (repair) await this.provider.refreshAcpProviderAgents([registryAgent.id])

    try {
      const installedState = await this.launchSpecs.ensureRegistryAgentInstalled(
        registryAgent,
        currentState,
        repair ? { repair: true } : undefined
      )
      this.repository.setAgentInstallState(registryAgent.id, installedState)
      this.handleAcpAgentsMutated([registryAgent.id])
      return installedState
    } catch (error) {
      const failedState: AcpAgentInstallState = {
        status: 'error',
        version: registryAgent.version,
        distributionType: this.launchSpecs.selectRegistryDistribution(registryAgent)?.type,
        lastCheckedAt: Date.now(),
        installedAt: currentState?.installedAt ?? null,
        installDir: currentState?.installDir ?? null,
        error: error instanceof Error ? error.message : String(error)
      }
      this.repository.setAgentInstallState(registryAgent.id, failedState)
      this.notifyAcpAgentsChanged([registryAgent.id])
      throw error
    }
  }

  private initializeUnifiedAgents(): void {
    this.repository.ensureBuiltinDeepChatAgent({
      name: 'DeepChat',
      config: this.buildLegacyBuiltinDeepChatConfig()
    })

    let migratedVersion = this.settings.get<number>('unifiedAgentsMigrationVersion') ?? 0
    let registryAgentsSynced = false
    if (migratedVersion < 1) {
      this.acpCatalog.getManualAgents().forEach((agent) => {
        this.repository.createManualAcpAgent(agent)
      })
      this.syncRegistryAgentsToRepository(
        this.acpCatalog.getRegistryStates(),
        this.acpCatalog.getInstallStates()
      )
      registryAgentsSynced = true
      migratedVersion = 1
    }

    if (migratedVersion < 2) {
      for (const agent of this.repository.listAgents({ agentType: 'deepchat' })) {
        const config = this.repository.getDeepChatAgentConfig(agent.id) ?? {}
        if (agent.id !== BUILTIN_DEEPCHAT_AGENT_ID && !Array.isArray(config.disabledAgentTools)) {
          continue
        }
        const disabledAgentTools = mergeDefaultDisabledAgentTools(config.disabledAgentTools)
        if (
          !Array.isArray(config.disabledAgentTools) ||
          disabledAgentTools.length !== config.disabledAgentTools.length ||
          disabledAgentTools.some((tool) => !config.disabledAgentTools?.includes(tool))
        ) {
          this.repository.updateDeepChatAgent(agent.id, { config: { disabledAgentTools } })
        }
      }
      this.settings.set('unifiedAgentsMigrationVersion', UNIFIED_AGENTS_MIGRATION_VERSION)
    }
    if (!registryAgentsSynced) this.syncRegistryAgentsToRepository()
  }

  private reconcileLegacyBuiltinAgentSelections(): void {
    const config = this.getBuiltinDeepChatConfig()
    const updates: Partial<DeepChatAgentConfig> = {}
    const legacyDefaultModel = getLiveLegacyModelSelection(this.settings.get('defaultModel'))
    if (legacyDefaultModel && shouldReplaceBuiltinModelSelection(config.defaultModelPreset)) {
      updates.defaultModelPreset = legacyDefaultModel
    }
    const legacyAssistantModel = getLiveLegacyModelSelection(this.settings.get('assistantModel'))
    if (legacyAssistantModel && shouldReplaceBuiltinModelSelection(config.assistantModel)) {
      updates.assistantModel = legacyAssistantModel
    }
    const legacyVisionSelection = this.settings.get('defaultVisionModel')
    const legacyVisionModel = getLiveLegacyModelSelection(legacyVisionSelection)
    if (legacyVisionModel && shouldReplaceBuiltinModelSelection(config.visionModel)) {
      updates.visionModel = legacyVisionModel
    }
    if (Object.keys(updates).length > 0) this.updateBuiltinDeepChatConfig(updates)
    if (legacyVisionSelection !== undefined) this.settings.delete('defaultVisionModel')
  }

  private buildLegacyBuiltinDeepChatConfig(): DeepChatAgentConfig {
    const defaultModel = this.settings.get('defaultModel') as ModelSelection | undefined
    const assistantModel = this.settings.get('assistantModel') as ModelSelection | undefined
    const visionModel = this.settings.get('defaultVisionModel') as ModelSelection | undefined
    const autoCompactionEnabled = this.settings.get('autoCompactionEnabled')
    const autoCompactionTriggerThreshold = this.settings.get('autoCompactionTriggerThreshold')
    const autoCompactionRetainRecentPairs = this.settings.get('autoCompactionRetainRecentPairs')
    return normalizeDeepChatSubagentConfig({
      defaultModelPreset: normalizeModelSelection(defaultModel),
      assistantModel: normalizeModelSelection(assistantModel),
      visionModel: normalizeModelSelection(visionModel),
      systemPrompt: this.settings.get<string>('default_system_prompt') ?? '',
      permissionMode: 'full_access',
      disabledAgentTools: [...DEFAULT_DISABLED_AGENT_TOOLS],
      autoCompactionEnabled:
        typeof autoCompactionEnabled === 'boolean' ? autoCompactionEnabled : true,
      autoCompactionTriggerThreshold:
        typeof autoCompactionTriggerThreshold === 'number' ? autoCompactionTriggerThreshold : 80,
      autoCompactionRetainRecentPairs:
        typeof autoCompactionRetainRecentPairs === 'number' ? autoCompactionRetainRecentPairs : 2
    })
  }

  private syncRegistryAgentsToRepository(
    legacyStateById?: Record<string, AcpAgentState>,
    legacyInstallStateById?: Record<string, AcpAgentInstallState>
  ): void {
    this.repository.syncRegistryAgents(
      this.registry.listAgents(),
      legacyStateById,
      legacyInstallStateById
    )
  }

  private getBuiltinDeepChatConfig(): DeepChatAgentConfig {
    return withDeepChatAgentDefaults(
      this.repository.resolveDeepChatAgentConfig(BUILTIN_DEEPCHAT_AGENT_ID) ?? {}
    )
  }

  private updateBuiltinDeepChatConfig(updates: Partial<DeepChatAgentConfig>): void {
    const updated = this.repository.updateDeepChatAgent(BUILTIN_DEEPCHAT_AGENT_ID, {
      config: updates
    })
    if (updated && hasMemoryMaintenanceTriggerConfigUpdate(updates)) {
      this.publishMemoryConfigChanged(BUILTIN_DEEPCHAT_AGENT_ID)
    }
    this.notifyAgentCatalogChanged()
  }

  private cleanupDeprecatedBuiltinAgentSelections(): void {
    const config = this.getBuiltinDeepChatConfig()
    const updates: Partial<DeepChatAgentConfig> = {}
    if (isDeprecatedBuiltinModelSelection(config.defaultModelPreset)) {
      updates.defaultModelPreset = null
    }
    if (isDeprecatedBuiltinModelSelection(config.assistantModel)) updates.assistantModel = null
    if (isDeprecatedBuiltinModelSelection(config.visionModel)) updates.visionModel = null
    if (isDeprecatedBuiltinModelSelection(config.imageGenerationModel)) {
      updates.imageGenerationModel = null
    }
    if (Object.keys(updates).length > 0) this.updateBuiltinDeepChatConfig(updates)
  }

  private publishMemoryConfigChanged(agentId: string): void {
    try {
      this.notifyMemoryConfigChanged(agentId)
    } catch (error) {
      logger.warn(`[AgentSettings] Memory config callback failed: ${String(error)}`)
    }
  }

  private getRegistryAgentOrThrow(agentId: string): AcpRegistryAgent {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const agent = this.registry.getAgent(resolvedId)
    if (!agent) throw new Error(`ACP registry agent not found: ${resolvedId}`)
    return agent
  }

  private buildRegistryAgentConfig(agent: AcpRegistryAgent): AcpAgentConfig {
    const preview = this.launchSpecs.buildRegistryPreview(agent)
    return {
      id: agent.id,
      name: agent.name,
      command: preview.command,
      args: preview.args,
      description: agent.description,
      icon: agent.icon,
      source: 'registry',
      installState: agent.installState ?? null
    }
  }

  private buildManualAgentConfig(agent: AcpManualAgent): AcpAgentConfig {
    return {
      id: agent.id,
      name: agent.name,
      command: agent.command,
      args: agent.args,
      env: agent.env,
      description: agent.description,
      icon: agent.icon,
      source: 'manual',
      installState: null
    }
  }

  private handleAcpAgentsMutated(agentIds?: string[]): void {
    this.provider.clearAcpProviderModelStatus()
    this.notifyAcpAgentsChanged(agentIds)
    void this.provider.refreshAcpProviderAgents(agentIds).catch((error) => {
      console.warn('[ACP] Failed to refresh agent processes after config change:', error)
    })
  }

  private notifyAcpAgentsChanged(agentIds?: string[]): void {
    this.events.publishCatalogChanged(agentIds)
    this.events.publishAcpModelsChanged()
    this.events.publishSessionsUpdated()
  }
}
