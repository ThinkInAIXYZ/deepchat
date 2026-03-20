import ElectronStore from 'electron-store'
import { nanoid } from 'nanoid'
import type {
  AcpAgentConfig,
  AcpAgentInstallState,
  AcpAgentProfile,
  AcpAgentState,
  AcpBuiltinAgent,
  AcpCustomAgent,
  AcpLegacyBuiltinAgentId,
  AcpManualAgent
} from '@shared/presenter'
import { McpConfHelper } from './mcpConfHelper'
import { ACP_LEGACY_AGENT_ID_ALIASES, resolveAcpAgentAlias } from './acpRegistryConstants'

const ACP_STORE_VERSION = '4'

type InternalStore = {
  enabled?: boolean
  version?: string
  registryStates?: Record<string, AcpAgentState>
  manualAgents?: AcpManualAgent[]
  installStates?: Record<string, AcpAgentInstallState>
  sharedMcpSelections?: string[]
  builtins?: AcpBuiltinAgent[]
  customs?: AcpCustomAgent[]
  agents?: AcpAgentConfig[]
  builtinsVersion?: string
  useBuiltinRuntime?: boolean
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const normalizeArgs = (args?: string[] | null): string[] | undefined => {
  if (!Array.isArray(args)) {
    return undefined
  }

  const cleaned = args
    .map((arg) => (typeof arg === 'string' ? arg.trim() : String(arg).trim()))
    .filter((arg) => arg.length > 0)

  return cleaned.length > 0 ? cleaned : undefined
}

const normalizeEnv = (env?: Record<string, string> | null): Record<string, string> | undefined => {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return undefined
  }

  const entries = Object.entries(env)
    .map(([key, value]) => [key.trim(), typeof value === 'string' ? value : String(value)])
    .filter(([key]) => key.length > 0)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const normalizeMcpSelections = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item).trim()))
    .filter((item) => item.length > 0)

  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined
}

const normalizeInstallState = (value: unknown): AcpAgentInstallState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const status = typeof record.status === 'string' ? record.status : ''
  if (!['not_installed', 'installing', 'installed', 'error'].includes(status)) {
    return null
  }

  return {
    status: status as AcpAgentInstallState['status'],
    distributionType:
      typeof record.distributionType === 'string'
        ? (record.distributionType as AcpAgentInstallState['distributionType'])
        : undefined,
    version: typeof record.version === 'string' ? record.version : undefined,
    installedAt: typeof record.installedAt === 'number' ? record.installedAt : undefined,
    lastCheckedAt: typeof record.lastCheckedAt === 'number' ? record.lastCheckedAt : undefined,
    installDir: typeof record.installDir === 'string' ? record.installDir : undefined,
    error: typeof record.error === 'string' ? record.error : undefined
  }
}

const normalizeRegistryState = (
  agentId: string,
  value: unknown,
  defaults?: Partial<AcpAgentState>
): AcpAgentState => {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  return {
    agentId,
    enabled:
      typeof record.enabled === 'boolean' ? record.enabled : Boolean(defaults?.enabled ?? false),
    envOverride: normalizeEnv(record.envOverride as Record<string, string> | undefined),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
  }
}

const normalizeManualAgent = (
  agent: Partial<AcpManualAgent> & { id?: string },
  defaults?: { enabled?: boolean }
): AcpManualAgent | null => {
  const id = agent.id?.toString().trim() || nanoid(8)
  const name = agent.name?.toString().trim()
  const command = agent.command?.toString().trim()

  if (!name || !command) {
    return null
  }

  return {
    id,
    name,
    command,
    args: normalizeArgs(agent.args),
    env: normalizeEnv(agent.env),
    enabled:
      typeof agent.enabled === 'boolean' ? agent.enabled : Boolean(defaults?.enabled ?? true),
    description: agent.description?.toString().trim() || undefined,
    icon: agent.icon?.toString().trim() || undefined,
    source: 'manual'
  }
}

const mergeMcpSelections = (...groups: Array<unknown>): string[] => {
  const merged: string[] = []
  const seen = new Set<string>()

  groups.forEach((group) => {
    const normalized = normalizeMcpSelections(group)
    normalized?.forEach((selection) => {
      if (seen.has(selection)) {
        return
      }
      seen.add(selection)
      merged.push(selection)
    })
  })

  return merged
}

const getActiveLegacyProfile = (agent: AcpBuiltinAgent): AcpAgentProfile | null => {
  return (
    agent.profiles.find((profile) => profile.id === agent.activeProfileId) ??
    agent.profiles[0] ??
    null
  )
}

export class AcpConfHelper {
  private readonly store: ElectronStore<InternalStore>
  private readonly mcpConfHelper: McpConfHelper

  constructor(options?: { mcpConfHelper?: McpConfHelper }) {
    this.mcpConfHelper = options?.mcpConfHelper ?? new McpConfHelper()
    this.store = new ElectronStore<InternalStore>({
      name: 'acp_agents',
      defaults: {
        enabled: false,
        version: ACP_STORE_VERSION,
        registryStates: {},
        manualAgents: [],
        installStates: {},
        sharedMcpSelections: []
      }
    })

    this.ensureStoreInitialized()
  }

  getGlobalEnabled(): boolean {
    return Boolean(this.store.get('enabled'))
  }

  setGlobalEnabled(enabled: boolean): boolean {
    if (this.getGlobalEnabled() === enabled) {
      return false
    }
    this.store.set('enabled', enabled)
    return true
  }

  getRegistryStates(): Record<string, AcpAgentState> {
    const raw = this.store.get('registryStates')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(raw).map(([agentId, value]) => [
        resolveAcpAgentAlias(agentId),
        normalizeRegistryState(resolveAcpAgentAlias(agentId), value)
      ])
    )
  }

  getAgentState(agentId: string): AcpAgentState | null {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const manual = this.getManualAgents().find((agent) => agent.id === resolvedId)
    if (manual) {
      return {
        agentId: manual.id,
        enabled: manual.enabled,
        updatedAt: Date.now()
      }
    }

    const state = this.getRegistryStates()[resolvedId]
    return state ? clone(state) : null
  }

  setAgentEnabled(agentId: string, enabled: boolean): void {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const manualAgents = this.getManualAgents()
    const manualIndex = manualAgents.findIndex((agent) => agent.id === resolvedId)
    if (manualIndex !== -1) {
      manualAgents[manualIndex].enabled = enabled
      this.store.set('manualAgents', manualAgents)
      return
    }

    const states = this.getRegistryStates()
    states[resolvedId] = normalizeRegistryState(resolvedId, states[resolvedId], { enabled })
    states[resolvedId].enabled = enabled
    states[resolvedId].updatedAt = Date.now()
    this.store.set('registryStates', states)
  }

  setAgentEnvOverride(agentId: string, env: Record<string, string>): void {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const states = this.getRegistryStates()
    states[resolvedId] = normalizeRegistryState(resolvedId, states[resolvedId])
    states[resolvedId].envOverride = normalizeEnv(env)
    states[resolvedId].updatedAt = Date.now()
    this.store.set('registryStates', states)
  }

  getAgentEnvOverride(agentId: string): Record<string, string> | undefined {
    return this.getRegistryStates()[resolveAcpAgentAlias(agentId)]?.envOverride
  }

  getManualAgents(): AcpManualAgent[] {
    const raw = this.store.get('manualAgents')
    if (!Array.isArray(raw)) {
      return []
    }

    return raw
      .map((agent) =>
        normalizeManualAgent(agent, { enabled: agent?.enabled as boolean | undefined })
      )
      .filter((agent): agent is AcpManualAgent => Boolean(agent))
      .map((agent) => clone(agent))
  }

  getSharedMcpSelections(): string[] {
    return normalizeMcpSelections(this.store.get('sharedMcpSelections')) ?? []
  }

  async setSharedMcpSelections(mcpIds: string[]): Promise<void> {
    const validated = await this.validateMcpSelections(mcpIds)
    this.store.set('sharedMcpSelections', validated)
  }

  addManualAgent(agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }): AcpManualAgent {
    const normalized = normalizeManualAgent(
      {
        ...agent,
        id: agent.id ?? nanoid(8)
      },
      { enabled: agent.enabled }
    )

    if (!normalized) {
      throw new Error('Invalid ACP manual agent payload')
    }

    const manualAgents = this.getManualAgents()
    const next = manualAgents.filter((item) => item.id !== normalized.id)
    next.push(normalized)
    this.store.set('manualAgents', next)
    return normalized
  }

  updateManualAgent(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): AcpManualAgent | null {
    const manualAgents = this.getManualAgents()
    const index = manualAgents.findIndex((agent) => agent.id === agentId)
    if (index === -1) {
      return null
    }

    const normalized = normalizeManualAgent(
      {
        ...manualAgents[index],
        ...updates,
        id: agentId
      },
      { enabled: updates.enabled ?? manualAgents[index].enabled }
    )

    if (!normalized) {
      return null
    }

    manualAgents[index] = normalized
    this.store.set('manualAgents', manualAgents)
    return normalized
  }

  removeManualAgent(agentId: string): boolean {
    const manualAgents = this.getManualAgents()
    const next = manualAgents.filter((agent) => agent.id !== agentId)
    if (next.length === manualAgents.length) {
      return false
    }
    this.store.set('manualAgents', next)
    return true
  }

  getInstallState(agentId: string): AcpAgentInstallState | null {
    const installStates = this.getInstallStates()
    return installStates[resolveAcpAgentAlias(agentId)] ?? null
  }

  setInstallState(agentId: string, state: AcpAgentInstallState | null): void {
    const resolvedId = resolveAcpAgentAlias(agentId)
    const installStates = this.getInstallStates()
    if (!state) {
      delete installStates[resolvedId]
    } else {
      installStates[resolvedId] = state
    }
    this.store.set('installStates', installStates)
  }

  getInstallStates(): Record<string, AcpAgentInstallState> {
    const raw = this.store.get('installStates')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {}
    }

    const entries = Object.entries(raw)
      .map(
        ([agentId, value]) => [resolveAcpAgentAlias(agentId), normalizeInstallState(value)] as const
      )
      .filter(([, value]) => Boolean(value))

    return Object.fromEntries(entries) as Record<string, AcpAgentInstallState>
  }

  async getAgentMcpSelections(agentId: string, _isBuiltin?: boolean): Promise<string[]> {
    void agentId
    return this.getSharedMcpSelections()
  }

  async setAgentMcpSelections(
    agentId: string,
    _isBuiltin: boolean,
    mcpIds: string[]
  ): Promise<void> {
    void agentId
    await this.setSharedMcpSelections(mcpIds)
  }

  async addMcpToAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void> {
    const current = await this.getAgentMcpSelections(agentId, isBuiltin)
    await this.setSharedMcpSelections(Array.from(new Set([...current, mcpId])))
  }

  async removeMcpFromAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void> {
    const current = await this.getAgentMcpSelections(agentId, isBuiltin)
    await this.setSharedMcpSelections(current.filter((item) => item !== mcpId))
  }

  private ensureStoreInitialized(): void {
    if (this.store.get('version') !== ACP_STORE_VERSION) {
      this.migrateStore()
    }

    this.store.set('registryStates', this.getRegistryStates())
    this.store.set('manualAgents', this.getManualAgents())
    this.store.set('installStates', this.getInstallStates())
    this.store.set('sharedMcpSelections', this.getSharedMcpSelections())
    this.store.set('version', ACP_STORE_VERSION)
  }

  private migrateStore(): void {
    const registryStates: Record<string, AcpAgentState> = {}
    const manualAgents: AcpManualAgent[] = []
    const sharedMcpSelections: string[] = []
    const rawSharedMcpSelections = this.store.get('sharedMcpSelections')
    const pushSelections = (...groups: Array<unknown>) => {
      sharedMcpSelections.splice(
        0,
        sharedMcpSelections.length,
        ...mergeMcpSelections(sharedMcpSelections, ...groups)
      )
    }

    const rawRegistryStates = this.store.get('registryStates')
    if (
      rawRegistryStates &&
      typeof rawRegistryStates === 'object' &&
      !Array.isArray(rawRegistryStates)
    ) {
      Object.entries(rawRegistryStates).forEach(([agentId, value]) => {
        const resolvedId = resolveAcpAgentAlias(agentId)
        registryStates[resolvedId] = normalizeRegistryState(resolvedId, value)
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          pushSelections((value as unknown as Record<string, unknown>).mcpSelections)
        }
      })
    }

    const rawManualAgents = this.store.get('manualAgents')
    if (Array.isArray(rawManualAgents)) {
      rawManualAgents.forEach((agent) => {
        const normalized = normalizeManualAgent(agent, {
          enabled: (agent as AcpManualAgent)?.enabled
        })
        if (normalized) {
          manualAgents.push(normalized)
        }
        if (agent && typeof agent === 'object' && !Array.isArray(agent)) {
          pushSelections((agent as unknown as Record<string, unknown>).mcpSelections)
        }
      })
    }

    const legacyBuiltins = this.store.get('builtins')
    if (Array.isArray(legacyBuiltins)) {
      legacyBuiltins.forEach((builtin) => {
        if (!builtin || typeof builtin !== 'object') {
          return
        }

        const agent = builtin as AcpBuiltinAgent
        const mappedId = ACP_LEGACY_AGENT_ID_ALIASES[agent.id as AcpLegacyBuiltinAgentId]
        if (!mappedId) {
          return
        }

        const activeProfile = getActiveLegacyProfile(agent)
        registryStates[mappedId] = {
          agentId: mappedId,
          enabled: Boolean(agent.enabled),
          envOverride: normalizeEnv(activeProfile?.env),
          updatedAt: Date.now()
        }
        pushSelections(agent.mcpSelections)
      })
    }

    const legacyCustoms = this.store.get('customs')
    if (Array.isArray(legacyCustoms)) {
      legacyCustoms.forEach((custom) => {
        const normalized = normalizeManualAgent(custom as AcpCustomAgent, {
          enabled: (custom as AcpCustomAgent)?.enabled
        })
        if (normalized) {
          manualAgents.push(normalized)
        }
        pushSelections((custom as AcpCustomAgent)?.mcpSelections)
      })
    }

    const legacyAgents = this.store.get('agents')
    if (Array.isArray(legacyAgents)) {
      legacyAgents.forEach((agent) => {
        if (!agent || typeof agent !== 'object') {
          return
        }

        const legacy = agent as AcpAgentConfig
        const mappedId = ACP_LEGACY_AGENT_ID_ALIASES[legacy.id as AcpLegacyBuiltinAgentId]
        if (mappedId) {
          registryStates[mappedId] = {
            agentId: mappedId,
            enabled: true,
            envOverride: normalizeEnv(legacy.env),
            updatedAt: Date.now()
          }
          return
        }

        const normalized = normalizeManualAgent(
          {
            id: legacy.id,
            name: legacy.name,
            command: legacy.command,
            args: legacy.args,
            env: legacy.env,
            enabled: true
          },
          { enabled: true }
        )
        if (normalized) {
          manualAgents.push(normalized)
        }
      })
    }

    this.store.set('registryStates', registryStates)
    this.store.set(
      'manualAgents',
      Array.from(new Map(manualAgents.map((agent) => [agent.id, agent])).values())
    )
    this.store.set('installStates', this.getInstallStates())
    this.store.set(
      'sharedMcpSelections',
      mergeMcpSelections(rawSharedMcpSelections, sharedMcpSelections)
    )
    this.store.set('version', ACP_STORE_VERSION)
    this.store.delete('builtins')
    this.store.delete('customs')
    this.store.delete('agents')
    this.store.delete('builtinsVersion')
    this.store.delete('useBuiltinRuntime')
  }

  private async validateMcpSelections(selections: string[]): Promise<string[]> {
    if (!selections.length) {
      return []
    }

    const servers = await this.mcpConfHelper.getMcpServers()
    const validServerNames = new Set(
      Object.entries(servers)
        .filter(([, config]) => config?.type !== 'inmemory')
        .map(([name]) => name)
    )

    return selections.filter((selection) => validServerNames.has(selection))
  }
}
