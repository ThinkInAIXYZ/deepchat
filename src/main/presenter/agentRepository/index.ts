import { nanoid } from 'nanoid'
import type {
  AcpAgentConfig,
  AcpAgentInstallState,
  AcpAgentState,
  AcpManualAgent,
  AcpRegistryAgent
} from '@shared/presenter'
import type {
  Agent,
  AgentAvatar,
  DeepChatAgentConfig,
  CreateDeepChatAgentInput,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { AgentRow } from '../sqlitePresenter/tables/agents'

type StoredAgentState = {
  envOverride?: Record<string, string>
  installState?: AcpAgentInstallState | null
}

type StoredAcpManualConfig = {
  command: string
  args?: string[]
  env?: Record<string, string>
}

type StoredAcpRegistryConfig = {
  version?: string
  distribution?: AcpRegistryAgent['distribution']
}

const BUILTIN_DEEPCHAT_AGENT_ID = 'deepchat'

const parseJson = <T>(raw?: string | null): T | null => {
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const stringifyJson = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  return JSON.stringify(value)
}

const sanitizeString = (value?: string | null): string | null => {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const mergeDeepChatConfig = (
  baseConfig: DeepChatAgentConfig,
  overrideConfig: DeepChatAgentConfig
): DeepChatAgentConfig => ({
  defaultModelPreset: overrideConfig.defaultModelPreset ?? baseConfig.defaultModelPreset ?? null,
  assistantModel: overrideConfig.assistantModel ?? baseConfig.assistantModel ?? null,
  visionModel: overrideConfig.visionModel ?? baseConfig.visionModel ?? null,
  systemPrompt: overrideConfig.systemPrompt ?? baseConfig.systemPrompt ?? '',
  permissionMode: overrideConfig.permissionMode ?? baseConfig.permissionMode ?? 'full_access',
  disabledAgentTools: overrideConfig.disabledAgentTools ?? baseConfig.disabledAgentTools ?? [],
  autoCompactionEnabled:
    overrideConfig.autoCompactionEnabled ?? baseConfig.autoCompactionEnabled ?? true,
  autoCompactionTriggerThreshold:
    overrideConfig.autoCompactionTriggerThreshold ??
    baseConfig.autoCompactionTriggerThreshold ??
    80,
  autoCompactionRetainRecentPairs:
    overrideConfig.autoCompactionRetainRecentPairs ??
    baseConfig.autoCompactionRetainRecentPairs ??
    2
})

export class AgentRepository {
  constructor(private readonly sqlitePresenter: SQLitePresenter) {}

  listAgents(filters?: { agentType?: 'deepchat' | 'acp'; enabled?: boolean }): Agent[] {
    const rows = this.sqlitePresenter.agentsTable.list({
      agentType: filters?.agentType,
      enabled: filters?.enabled
    })
    return rows.map((row) => this.toAgent(row))
  }

  getAgent(agentId: string): Agent | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    return row ? this.toAgent(row) : null
  }

  getAgentType(agentId: string): 'deepchat' | 'acp' | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    return row?.agent_type ?? null
  }

  ensureBuiltinDeepChatAgent(defaults?: {
    name?: string
    icon?: string | null
    avatar?: AgentAvatar | null
    config?: DeepChatAgentConfig | null
  }): Agent {
    const existing = this.sqlitePresenter.agentsTable.get(BUILTIN_DEEPCHAT_AGENT_ID)
    if (!existing) {
      this.sqlitePresenter.agentsTable.create({
        id: BUILTIN_DEEPCHAT_AGENT_ID,
        agentType: 'deepchat',
        source: 'builtin',
        name: defaults?.name?.trim() || 'DeepChat',
        enabled: true,
        protected: true,
        icon: sanitizeString(defaults?.icon),
        avatarJson: stringifyJson(defaults?.avatar ?? null),
        configJson: stringifyJson(defaults?.config ?? null)
      })
      return this.getAgent(BUILTIN_DEEPCHAT_AGENT_ID) as Agent
    }

    this.sqlitePresenter.agentsTable.update(BUILTIN_DEEPCHAT_AGENT_ID, {
      enabled: true,
      protected: true
    })
    return this.getAgent(BUILTIN_DEEPCHAT_AGENT_ID) as Agent
  }

  createDeepChatAgent(input: CreateDeepChatAgentInput): Agent {
    const id = `deepchat-${nanoid(8)}`
    this.sqlitePresenter.agentsTable.create({
      id,
      agentType: 'deepchat',
      source: 'manual',
      name: input.name.trim(),
      enabled: input.enabled !== false,
      protected: false,
      description: sanitizeString(input.description),
      icon: sanitizeString(input.icon),
      avatarJson: stringifyJson(input.avatar ?? null),
      configJson: stringifyJson(input.config ?? null)
    })
    return this.getAgent(id) as Agent
  }

  updateDeepChatAgent(agentId: string, updates: UpdateDeepChatAgentInput): Agent | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'deepchat') {
      return null
    }

    const currentConfig = parseJson<DeepChatAgentConfig>(row.config_json) ?? {}
    const nextConfig =
      updates.config === undefined
        ? currentConfig
        : { ...currentConfig, ...clone(updates.config ?? {}) }

    this.sqlitePresenter.agentsTable.update(agentId, {
      name: updates.name?.trim() || row.name,
      enabled: updates.enabled ?? row.enabled === 1,
      description:
        updates.description === undefined ? row.description : sanitizeString(updates.description),
      icon: updates.icon === undefined ? row.icon : sanitizeString(updates.icon),
      avatarJson:
        updates.avatar === undefined ? row.avatar_json : stringifyJson(updates.avatar ?? null),
      configJson: updates.config === undefined ? row.config_json : stringifyJson(nextConfig)
    })

    return this.getAgent(agentId)
  }

  deleteDeepChatAgent(agentId: string): boolean {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'deepchat' || row.protected === 1) {
      return false
    }

    this.sqlitePresenter.newSessionsTable.reassignAgentId(agentId, BUILTIN_DEEPCHAT_AGENT_ID)
    this.sqlitePresenter.agentsTable.delete(agentId)
    return true
  }

  getDeepChatAgentConfig(agentId: string): DeepChatAgentConfig | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'deepchat') {
      return null
    }
    return parseJson<DeepChatAgentConfig>(row.config_json)
  }

  resolveDeepChatAgentConfig(agentId: string): DeepChatAgentConfig {
    const builtin = this.getDeepChatAgentConfig(BUILTIN_DEEPCHAT_AGENT_ID) ?? {}
    if (agentId === BUILTIN_DEEPCHAT_AGENT_ID) {
      return mergeDeepChatConfig({}, builtin)
    }

    const current = this.getDeepChatAgentConfig(agentId) ?? {}
    return mergeDeepChatConfig(builtin, current)
  }

  listManualAcpAgents(): AcpManualAgent[] {
    return this.sqlitePresenter.agentsTable
      .list({ agentType: 'acp', source: 'manual' })
      .map((row) => this.toAcpManualAgent(row))
      .filter((agent): agent is AcpManualAgent => Boolean(agent))
  }

  getManualAcpAgent(agentId: string): AcpManualAgent | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'manual') {
      return null
    }
    return this.toAcpManualAgent(row)
  }

  createManualAcpAgent(
    agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }
  ): AcpManualAgent {
    const id = agent.id?.trim() || nanoid(8)
    this.sqlitePresenter.agentsTable.upsert({
      id,
      agentType: 'acp',
      source: 'manual',
      name: agent.name.trim(),
      enabled: agent.enabled,
      protected: false,
      description: sanitizeString(agent.description),
      icon: sanitizeString(agent.icon),
      configJson: stringifyJson({
        command: agent.command,
        args: agent.args,
        env: agent.env
      } satisfies StoredAcpManualConfig),
      stateJson: stringifyJson({})
    })
    return this.getManualAcpAgent(id) as AcpManualAgent
  }

  updateManualAcpAgent(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): AcpManualAgent | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'manual') {
      return null
    }

    const currentConfig = parseJson<StoredAcpManualConfig>(row.config_json) ?? { command: '' }
    const nextConfig: StoredAcpManualConfig = {
      command: updates.command?.trim() || currentConfig.command,
      args: updates.args ?? currentConfig.args,
      env: updates.env ?? currentConfig.env
    }

    this.sqlitePresenter.agentsTable.update(agentId, {
      name: updates.name?.trim() || row.name,
      enabled: updates.enabled ?? row.enabled === 1,
      description:
        updates.description === undefined ? row.description : sanitizeString(updates.description),
      icon: updates.icon === undefined ? row.icon : sanitizeString(updates.icon),
      configJson: stringifyJson(nextConfig)
    })

    return this.getManualAcpAgent(agentId)
  }

  removeManualAcpAgent(agentId: string): boolean {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'manual') {
      return false
    }
    this.sqlitePresenter.agentsTable.delete(agentId)
    return true
  }

  syncRegistryAgents(
    agents: AcpRegistryAgent[],
    legacyStateById?: Record<string, AcpAgentState>,
    legacyInstallStateById?: Record<string, AcpAgentInstallState>
  ): void {
    for (const agent of agents) {
      const currentRow = this.sqlitePresenter.agentsTable.get(agent.id)
      const currentState = parseJson<StoredAgentState>(currentRow?.state_json) ?? {}
      const legacyState = legacyStateById?.[agent.id]
      const legacyInstallState = legacyInstallStateById?.[agent.id]
      const mergedState: StoredAgentState = {
        envOverride: currentState.envOverride ?? legacyState?.envOverride,
        installState: currentState.installState ?? legacyInstallState ?? null
      }

      this.sqlitePresenter.agentsTable.upsert({
        id: agent.id,
        agentType: 'acp',
        source: 'registry',
        name: agent.name,
        enabled: currentRow ? currentRow.enabled === 1 : (legacyState?.enabled ?? false),
        protected: false,
        description: sanitizeString(agent.description),
        icon: sanitizeString(agent.icon),
        configJson: stringifyJson({
          version: agent.version,
          distribution: agent.distribution
        } satisfies StoredAcpRegistryConfig),
        stateJson: stringifyJson(mergedState),
        createdAt: currentRow?.created_at,
        updatedAt: Date.now()
      })
    }
  }

  getAcpAgentState(agentId: string): AcpAgentState | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp') {
      return null
    }

    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    return {
      agentId: row.id,
      enabled: row.enabled === 1,
      envOverride: state.envOverride,
      updatedAt: row.updated_at
    }
  }

  setAgentEnabled(agentId: string, enabled: boolean): boolean {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row) {
      return false
    }
    this.sqlitePresenter.agentsTable.update(agentId, { enabled })
    return true
  }

  setAgentEnvOverride(agentId: string, env: Record<string, string>): boolean {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp') {
      return false
    }

    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    this.sqlitePresenter.agentsTable.update(agentId, {
      stateJson: stringifyJson({
        ...state,
        envOverride: clone(env)
      } satisfies StoredAgentState)
    })
    return true
  }

  getAgentInstallState(agentId: string): AcpAgentInstallState | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp') {
      return null
    }
    return parseJson<StoredAgentState>(row.state_json)?.installState ?? null
  }

  setAgentInstallState(agentId: string, installState: AcpAgentInstallState | null): boolean {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp') {
      return false
    }

    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    this.sqlitePresenter.agentsTable.update(agentId, {
      stateJson: stringifyJson({
        ...state,
        installState
      } satisfies StoredAgentState)
    })
    return true
  }

  toAcpAgentConfig(
    agentId: string,
    preview?: Pick<AcpAgentConfig, 'command' | 'args'>
  ): AcpAgentConfig | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp') {
      return null
    }

    if (row.source === 'manual') {
      const manual = this.toAcpManualAgent(row)
      if (!manual) {
        return null
      }
      return {
        id: manual.id,
        name: manual.name,
        command: manual.command,
        args: manual.args,
        env: manual.env,
        description: manual.description,
        icon: manual.icon,
        source: 'manual',
        installState: null
      }
    }

    if (!preview) {
      return null
    }

    return {
      id: row.id,
      name: row.name,
      command: preview.command,
      args: preview.args,
      description: row.description ?? undefined,
      icon: row.icon ?? undefined,
      source: 'registry',
      installState: this.getAgentInstallState(row.id)
    }
  }

  getAcpRegistryOverlay(agentId: string): {
    enabled: boolean
    envOverride?: Record<string, string>
    installState?: AcpAgentInstallState | null
  } | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'registry') {
      return null
    }
    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    return {
      enabled: row.enabled === 1,
      envOverride: state.envOverride,
      installState: state.installState ?? null
    }
  }

  private toAcpManualAgent(row: AgentRow): AcpManualAgent | null {
    const config = parseJson<StoredAcpManualConfig>(row.config_json)
    if (!config?.command) {
      return null
    }

    return {
      id: row.id,
      name: row.name,
      command: config.command,
      args: config.args,
      env: config.env,
      enabled: row.enabled === 1,
      description: row.description ?? undefined,
      icon: row.icon ?? undefined,
      source: 'manual'
    }
  }

  private toAgent(row: AgentRow): Agent {
    return {
      id: row.id,
      name: row.name,
      type: row.agent_type,
      agentType: row.agent_type,
      enabled: row.enabled === 1,
      protected: row.protected === 1,
      icon: row.icon ?? undefined,
      description: row.description ?? undefined,
      source: row.source,
      avatar: parseJson<AgentAvatar>(row.avatar_json),
      config:
        row.agent_type === 'deepchat'
          ? (parseJson<DeepChatAgentConfig>(row.config_json) ?? null)
          : null,
      installState: this.getAgentInstallState(row.id)
    }
  }
}

export { BUILTIN_DEEPCHAT_AGENT_ID }
