import { nanoid } from 'nanoid'
import type { AcpRegistryReference } from '@/agent/shared/agentDescriptors'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentRowStore } from '@/agent/shared/agentRowStore'
import type { AgentRow } from '@/presenter/sqlitePresenter/tables/agents'
import type {
  AcpAgentConfig,
  AcpAgentInstallState,
  AcpAgentState,
  AcpManualAgent,
  AcpRegistryAgent
} from '@shared/presenter'

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

export interface AcpAgentRepositoryDependencies {
  rows: AgentRowStore
  listSessionIdsByAgent(agentId: string): AppSessionId[]
}

const parseJson = <T>(raw?: string | null): T | null => {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const stringifyJson = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value)

const sanitizeString = (value?: string | null): string | null => {
  const normalized = value?.trim()
  return normalized || null
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class AcpAgentRepository {
  constructor(private readonly dependencies: AcpAgentRepositoryDependencies) {}

  listManual(): AcpManualAgent[] {
    return this.dependencies.rows
      .list({ agentType: 'acp', source: 'manual' })
      .map((row) => this.toManual(row))
      .filter((agent): agent is AcpManualAgent => Boolean(agent))
  }

  getManual(agentId: string): AcpManualAgent | null {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'manual') return null
    return this.toManual(row)
  }

  createManual(agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }): AcpManualAgent {
    const id = agent.id?.trim() || nanoid(8)
    this.dependencies.rows.upsert({
      id,
      agentType: 'acp',
      source: 'manual',
      name: agent.name.trim(),
      enabled: agent.enabled,
      protected: false,
      description: sanitizeString(agent.description),
      icon: sanitizeString(agent.icon),
      configJson: stringifyJson({ command: agent.command, args: agent.args, env: agent.env }),
      stateJson: stringifyJson({})
    })
    return this.getManual(id) as AcpManualAgent
  }

  updateManual(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): AcpManualAgent | null {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'manual') return null
    const currentConfig = parseJson<StoredAcpManualConfig>(row.config_json) ?? { command: '' }
    const nextConfig: StoredAcpManualConfig = {
      command: updates.command?.trim() || currentConfig.command,
      args: updates.args ?? currentConfig.args,
      env: updates.env ?? currentConfig.env
    }
    this.dependencies.rows.update(agentId, {
      name: updates.name?.trim() || row.name,
      enabled: updates.enabled ?? row.enabled === 1,
      description:
        updates.description === undefined ? row.description : sanitizeString(updates.description),
      icon: updates.icon === undefined ? row.icon : sanitizeString(updates.icon),
      configJson: stringifyJson(nextConfig)
    })
    return this.getManual(agentId)
  }

  removeManual(agentId: string): boolean {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'manual') return false
    if (this.hasSessions(agentId)) return false
    this.dependencies.rows.delete(agentId)
    return true
  }

  hasSessions(agentId: string): boolean {
    return this.dependencies.listSessionIdsByAgent(agentId).length > 0
  }

  syncRegistry(
    agents: AcpRegistryAgent[],
    legacyStateById?: Record<string, AcpAgentState>,
    legacyInstallStateById?: Record<string, AcpAgentInstallState>
  ): void {
    for (const agent of agents) {
      const currentRow = this.dependencies.rows.get(agent.id)
      const currentState = parseJson<StoredAgentState>(currentRow?.state_json) ?? {}
      const legacyState = legacyStateById?.[agent.id]
      const mergedState: StoredAgentState = {
        envOverride: currentState.envOverride ?? legacyState?.envOverride,
        installState: currentState.installState ?? legacyInstallStateById?.[agent.id] ?? null
      }
      this.dependencies.rows.upsert({
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

  getState(agentId: string): AcpAgentState | null {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp') return null
    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    return {
      agentId: row.id,
      enabled: row.enabled === 1,
      envOverride: state.envOverride,
      updatedAt: row.updated_at
    }
  }

  setEnvOverride(agentId: string, env: Record<string, string>): boolean {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp') return false
    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    this.dependencies.rows.update(agentId, {
      stateJson: stringifyJson({ ...state, envOverride: clone(env) } satisfies StoredAgentState)
    })
    return true
  }

  getInstallState(agentId: string): AcpAgentInstallState | null {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp') return null
    return parseJson<StoredAgentState>(row.state_json)?.installState ?? null
  }

  setInstallState(agentId: string, installState: AcpAgentInstallState | null): boolean {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp') return false
    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    this.dependencies.rows.update(agentId, {
      stateJson: stringifyJson({ ...state, installState } satisfies StoredAgentState)
    })
    return true
  }

  clearRegistryInstallation(agentId: string, installState: AcpAgentInstallState): boolean {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'registry') return false
    if (this.hasSessions(agentId)) return false
    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    this.dependencies.rows.update(agentId, {
      enabled: false,
      stateJson: stringifyJson({ ...state, installState } satisfies StoredAgentState)
    })
    return true
  }

  toConfig(
    agentId: string,
    preview?: Pick<AcpAgentConfig, 'command' | 'args'>
  ): AcpAgentConfig | null {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp') return null
    if (row.source === 'manual') {
      const manual = this.toManual(row)
      return manual
        ? {
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
        : null
    }
    if (!preview) return null
    return {
      id: row.id,
      name: row.name,
      command: preview.command,
      args: preview.args,
      description: row.description ?? undefined,
      icon: row.icon ?? undefined,
      source: 'registry',
      installState: this.getInstallState(row.id)
    }
  }

  getRegistryReference(agentId: string): AcpRegistryReference | null {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'registry') return null
    const config = parseJson<StoredAcpRegistryConfig>(row.config_json)
    if (
      !config ||
      typeof config !== 'object' ||
      Array.isArray(config) ||
      typeof config.version !== 'string' ||
      !config.version ||
      !config.distribution ||
      typeof config.distribution !== 'object' ||
      Array.isArray(config.distribution)
    ) {
      return null
    }
    return { id: row.id, version: config.version, distribution: config.distribution }
  }

  getRegistryOverlay(agentId: string): {
    enabled: boolean
    envOverride?: Record<string, string>
    installState?: AcpAgentInstallState | null
  } | null {
    const row = this.dependencies.rows.get(agentId)
    if (!row || row.agent_type !== 'acp' || row.source !== 'registry') return null
    const state = parseJson<StoredAgentState>(row.state_json) ?? {}
    return {
      enabled: row.enabled === 1,
      envOverride: state.envOverride,
      installState: state.installState ?? null
    }
  }

  private toManual(row: AgentRow): AcpManualAgent | null {
    const config = parseJson<StoredAcpManualConfig>(row.config_json)
    if (!config?.command) return null
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
}
