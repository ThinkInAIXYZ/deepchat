import ElectronStore from 'electron-store'
import { nanoid } from 'nanoid'
import type {
  AcpAgentConfig,
  AcpAgentProfile,
  AcpBuiltinAgent,
  AcpBuiltinAgentId,
  AcpCustomAgent,
  AcpStoreData
} from '@shared/presenter'

const ACP_STORE_VERSION = '2'
const DEFAULT_PROFILE_NAME = 'Default'

const BUILTIN_ORDER: AcpBuiltinAgentId[] = ['kimi-cli', 'claude-code-acp', 'codex-acp']

interface BuiltinTemplate {
  name: string
  defaultProfile: () => Omit<AcpAgentProfile, 'id'>
}

const BUILTIN_TEMPLATES: Record<AcpBuiltinAgentId, BuiltinTemplate> = {
  'kimi-cli': {
    name: 'Kimi CLI',
    defaultProfile: () => ({
      name: DEFAULT_PROFILE_NAME,
      command: 'uv',
      args: ['tool', 'run', '--from', 'kimi-cli', 'kimi', '--acp'],
      env: {}
    })
  },
  'claude-code-acp': {
    name: 'Claude Code ACP',
    defaultProfile: () => ({
      name: DEFAULT_PROFILE_NAME,
      command: 'npx',
      args: ['-y', '@zed-industries/claude-code-acp'],
      env: {}
    })
  },
  'codex-acp': {
    name: 'Codex CLI ACP',
    defaultProfile: () => ({
      name: DEFAULT_PROFILE_NAME,
      command: 'npx',
      args: ['-y', '@zed-industries/codex-acp'],
      env: {}
    })
  }
}

type InternalStore = Partial<AcpStoreData> & {
  agents?: AcpAgentConfig[]
  builtinsVersion?: string
  useBuiltinRuntime?: boolean
}

const deepClone = <T>(value: T): T => {
  if (value === undefined || value === null) {
    return value
  }
  return JSON.parse(JSON.stringify(value))
}

export class AcpConfHelper {
  private store: ElectronStore<InternalStore>

  constructor() {
    this.store = new ElectronStore<InternalStore>({
      name: 'acp_agents',
      defaults: {
        builtins: [],
        customs: [],
        enabled: false,
        useBuiltinRuntime: false,
        version: ACP_STORE_VERSION
      }
    })

    this.migrateLegacyAgents()
    this.ensureStoreInitialized()
  }

  getGlobalEnabled(): boolean {
    return Boolean(this.store.get('enabled'))
  }

  setGlobalEnabled(enabled: boolean): boolean {
    const current = this.getGlobalEnabled()
    if (current === enabled) {
      return false
    }
    this.store.set('enabled', enabled)
    return true
  }

  getUseBuiltinRuntime(): boolean {
    return Boolean(this.store.get('useBuiltinRuntime'))
  }

  setUseBuiltinRuntime(enabled: boolean): void {
    this.store.set('useBuiltinRuntime', enabled)
  }

  getEnabledAgents(): AcpAgentConfig[] {
    const data = this.getData()
    if (!data.enabled) {
      return []
    }

    const builtinAgents: AcpAgentConfig[] = []
    data.builtins.forEach((agent) => {
      if (!agent.enabled) {
        return
      }
      const profile =
        agent.profiles.find((p) => p.id === agent.activeProfileId) || agent.profiles[0]
      if (!profile) {
        return
      }
      const profileLabel = profile.name?.trim() || DEFAULT_PROFILE_NAME
      builtinAgents.push({
        id: agent.id,
        name: `${agent.name} - ${profileLabel}`,
        command: profile.command,
        args: profile.args,
        env: profile.env
      })
    })

    const customAgents = data.customs
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        command: agent.command,
        args: agent.args,
        env: agent.env
      }))

    return [...builtinAgents, ...customAgents]
  }

  getBuiltins(): AcpBuiltinAgent[] {
    return deepClone(this.getData().builtins)
  }

  getCustoms(): AcpCustomAgent[] {
    return deepClone(this.getData().customs)
  }

  addBuiltinProfile(
    agentId: AcpBuiltinAgentId,
    profile: Omit<AcpAgentProfile, 'id'>,
    options?: { activate?: boolean }
  ): AcpAgentProfile {
    let createdProfile: AcpAgentProfile | null = null
    this.mutateBuiltins((builtins) => {
      const target = builtins.find((agent) => agent.id === agentId)
      if (!target) return
      createdProfile = this.createProfile(profile)
      target.profiles.push(createdProfile)
      if ((options?.activate ?? true) || !target.activeProfileId) {
        target.activeProfileId = createdProfile.id
      }
    })

    if (!createdProfile) {
      throw new Error(`Failed to add profile for ACP builtin ${agentId}`)
    }
    return createdProfile
  }

  updateBuiltinProfile(
    agentId: AcpBuiltinAgentId,
    profileId: string,
    updates: Partial<Omit<AcpAgentProfile, 'id'>>
  ): AcpAgentProfile | null {
    let updatedProfile: AcpAgentProfile | null = null
    this.mutateBuiltins((builtins) => {
      const target = builtins.find((agent) => agent.id === agentId)
      if (!target) return
      const index = target.profiles.findIndex((profile) => profile.id === profileId)
      if (index === -1) return
      const merged: AcpAgentProfile | null = this.normalizeProfile({
        ...target.profiles[index],
        ...updates,
        id: profileId
      })
      if (!merged) return
      target.profiles[index] = merged
      updatedProfile = merged
      if (!target.activeProfileId) {
        target.activeProfileId = merged.id
      }
    })
    return updatedProfile
  }

  removeBuiltinProfile(agentId: AcpBuiltinAgentId, profileId: string): boolean {
    let removed = false
    this.mutateBuiltins((builtins) => {
      const target = builtins.find((agent) => agent.id === agentId)
      if (!target) return
      if (target.profiles.length <= 1) return
      const index = target.profiles.findIndex((profile) => profile.id === profileId)
      if (index === -1) return
      target.profiles.splice(index, 1)
      removed = true
      if (target.activeProfileId === profileId) {
        target.activeProfileId = target.profiles[0]?.id ?? null
      }
    })
    return removed
  }

  setBuiltinActiveProfile(agentId: AcpBuiltinAgentId, profileId: string): void {
    this.mutateBuiltins((builtins) => {
      const target = builtins.find((agent) => agent.id === agentId)
      if (!target) return
      if (!target.profiles.some((profile) => profile.id === profileId)) return
      target.activeProfileId = profileId
    })
  }

  setBuiltinEnabled(agentId: AcpBuiltinAgentId, enabled: boolean): void {
    this.mutateBuiltins((builtins) => {
      const target = builtins.find((agent) => agent.id === agentId)
      if (!target) return
      target.enabled = enabled
      if (enabled && !target.activeProfileId) {
        target.activeProfileId = target.profiles[0]?.id ?? null
      }
    })
  }

  addCustomAgent(
    agent: Omit<AcpCustomAgent, 'id' | 'enabled'> & { id?: string; enabled?: boolean }
  ): AcpCustomAgent {
    const normalized = this.normalizeCustomAgent(
      {
        id: agent.id,
        name: agent.name,
        command: agent.command,
        args: agent.args,
        env: agent.env,
        enabled: agent.enabled ?? true
      },
      { enabled: agent.enabled ?? true }
    )
    if (!normalized) {
      throw new Error('Invalid ACP custom agent payload')
    }
    let result = normalized
    this.mutateCustoms((customs) => {
      const existingIndex = customs.findIndex((item) => item.id === normalized.id)
      if (existingIndex !== -1) {
        customs[existingIndex] = normalized
        result = normalized
      } else {
        customs.push(normalized)
        result = normalized
      }
    })
    return result
  }

  updateCustomAgent(
    agentId: string,
    updates: Partial<Omit<AcpCustomAgent, 'id'>>
  ): AcpCustomAgent | null {
    let updated: AcpCustomAgent | null = null
    this.mutateCustoms((customs) => {
      const index = customs.findIndex((agent) => agent.id === agentId)
      if (index === -1) return
      const merged = this.normalizeCustomAgent(
        {
          ...customs[index],
          ...updates,
          id: agentId,
          enabled: updates.enabled ?? customs[index].enabled
        },
        { enabled: updates.enabled ?? customs[index].enabled }
      )
      if (!merged) return
      customs[index] = merged
      updated = merged
    })
    return updated
  }

  removeCustomAgent(agentId: string): boolean {
    let removed = false
    this.mutateCustoms((customs) => {
      const next = customs.filter((agent) => agent.id !== agentId)
      if (next.length === customs.length) return
      customs.splice(0, customs.length, ...next)
      removed = true
    })
    return removed
  }

  setCustomAgentEnabled(agentId: string, enabled: boolean): void {
    this.mutateCustoms((customs) => {
      const target = customs.find((agent) => agent.id === agentId)
      if (!target) return
      target.enabled = enabled
    })
  }

  replaceWithLegacyAgents(agents: AcpAgentConfig[]): AcpAgentConfig[] {
    const sanitized: AcpAgentConfig[] = []
    for (const agent of agents) {
      const normalized = this.normalizeLegacyAgent(agent)
      if (normalized) {
        sanitized.push(normalized)
      }
    }

    const builtinMap = new Map<AcpBuiltinAgentId, AcpBuiltinAgent>()
    for (const id of BUILTIN_ORDER) {
      builtinMap.set(id, this.createDefaultBuiltin(id))
    }

    const customs: AcpCustomAgent[] = []

    sanitized.forEach((agent) => {
      if (this.isBuiltinAgent(agent.id)) {
        const profile = this.createProfile({
          name: agent.name,
          command: agent.command,
          args: agent.args,
          env: agent.env
        })
        const target = builtinMap.get(agent.id)!
        target.enabled = true
        target.profiles = [profile]
        target.activeProfileId = profile.id
      } else {
        const custom = this.normalizeCustomAgent(
          {
            id: agent.id,
            name: agent.name,
            command: agent.command,
            args: agent.args,
            env: agent.env,
            enabled: true
          },
          { enabled: true }
        )
        if (custom) {
          customs.push(custom)
        }
      }
    })

    const builtins = BUILTIN_ORDER.map((id) => builtinMap.get(id)!)
    this.store.set('builtins', builtins)
    this.store.set('customs', customs)
    this.store.set('version', ACP_STORE_VERSION)
    return sanitized
  }

  addLegacyAgent(agent: Omit<AcpAgentConfig, 'id'> & { id?: string }): AcpAgentConfig {
    const normalized = this.normalizeLegacyAgent({ ...agent, id: agent.id ?? nanoid(8) })
    if (!normalized) {
      throw new Error('Invalid ACP agent payload')
    }

    if (this.isBuiltinAgent(normalized.id)) {
      const profile = this.createProfile({
        name: normalized.name,
        command: normalized.command,
        args: normalized.args,
        env: normalized.env
      })
      this.mutateBuiltins((builtins) => {
        const target = builtins.find((item) => item.id === normalized.id)
        if (!target) return
        target.enabled = true
        target.profiles = [profile]
        target.activeProfileId = profile.id
      })
      return normalized
    }

    const custom = this.addCustomAgent({
      id: normalized.id,
      name: normalized.name,
      command: normalized.command,
      args: normalized.args,
      env: normalized.env,
      enabled: true
    })

    return {
      id: custom.id,
      name: custom.name,
      command: custom.command,
      args: custom.args,
      env: custom.env
    }
  }

  updateLegacyAgent(
    agentId: string,
    updates: Partial<Omit<AcpAgentConfig, 'id'>>
  ): AcpAgentConfig | null {
    if (this.isBuiltinAgent(agentId)) {
      let result: AcpAgentConfig | null = null
      this.mutateBuiltins((builtins) => {
        const target = builtins.find((agent) => agent.id === agentId)
        if (!target) return
        const currentProfile = target.profiles.find(
          (profile) => profile.id === target.activeProfileId
        )
        if (!currentProfile) return
        const merged = this.normalizeProfile({
          ...currentProfile,
          ...updates,
          id: currentProfile.id
        })
        if (!merged) return
        target.profiles = [merged]
        target.activeProfileId = merged.id
        target.enabled = true
        result = {
          id: target.id,
          name: merged.name,
          command: merged.command,
          args: merged.args,
          env: merged.env
        }
      })
      return result
    }

    const updated = this.updateCustomAgent(agentId, {
      name: updates.name,
      command: updates.command,
      args: updates.args,
      env: updates.env
    })

    if (!updated) {
      return null
    }

    return {
      id: updated.id,
      name: updated.name,
      command: updated.command,
      args: updated.args,
      env: updated.env
    }
  }

  removeLegacyAgent(agentId: string): boolean {
    if (this.isBuiltinAgent(agentId)) {
      let changed = false
      this.mutateBuiltins((builtins) => {
        const target = builtins.find((agent) => agent.id === agentId)
        if (!target) return
        target.enabled = false
        const defaultProfile = this.createProfile(BUILTIN_TEMPLATES[agentId].defaultProfile())
        target.profiles = [defaultProfile]
        target.activeProfileId = defaultProfile.id
        changed = true
      })
      return changed
    }

    return this.removeCustomAgent(agentId)
  }

  private mutateBuiltins(mutator: (builtins: AcpBuiltinAgent[]) => void): void {
    const data = this.getData()
    mutator(data.builtins)
    const normalized = this.normalizeBuiltins(data.builtins)
    this.store.set('builtins', normalized)
    this.store.set('version', ACP_STORE_VERSION)
  }

  private mutateCustoms(mutator: (customs: AcpCustomAgent[]) => void): void {
    const data = this.getData()
    mutator(data.customs)
    const normalized = this.normalizeCustoms(data.customs)
    this.store.set('customs', normalized)
    this.store.set('version', ACP_STORE_VERSION)
  }

  private migrateLegacyAgents(): void {
    const legacyAgents = this.store.get('agents') as AcpAgentConfig[] | undefined
    if (!legacyAgents || !legacyAgents.length) {
      return
    }

    const sanitized = legacyAgents
      .map((agent) => this.normalizeLegacyAgent(agent))
      .filter((agent): agent is AcpAgentConfig => Boolean(agent))

    const builtinMap = new Map<AcpBuiltinAgentId, AcpBuiltinAgent>()
    BUILTIN_ORDER.forEach((id) => {
      builtinMap.set(id, this.createDefaultBuiltin(id))
    })

    const customs: AcpCustomAgent[] = []

    sanitized.forEach((agent) => {
      if (this.isBuiltinAgent(agent.id)) {
        const profile = this.createProfile({
          name: agent.name,
          command: agent.command,
          args: agent.args,
          env: agent.env
        })
        const target = builtinMap.get(agent.id)!
        target.enabled = true
        target.profiles = [profile]
        target.activeProfileId = profile.id
      } else {
        const custom = this.normalizeCustomAgent(
          {
            id: agent.id,
            name: agent.name,
            command: agent.command,
            args: agent.args,
            env: agent.env,
            enabled: true
          },
          { enabled: true }
        )
        if (custom) {
          customs.push(custom)
        }
      }
    })

    this.store.set(
      'builtins',
      BUILTIN_ORDER.map((id) => builtinMap.get(id)!)
    )
    this.store.set('customs', customs)
    this.store.delete('agents')
    this.store.delete('builtinsVersion')
    this.store.set('version', ACP_STORE_VERSION)
  }

  private ensureStoreInitialized(): void {
    const builtins = this.store.get('builtins') as AcpBuiltinAgent[] | undefined
    const customs = this.store.get('customs') as AcpCustomAgent[] | undefined

    if (!Array.isArray(builtins) || !builtins.length) {
      this.store.set('builtins', this.createDefaultBuiltins())
    } else {
      this.store.set('builtins', this.normalizeBuiltins(builtins))
    }

    this.store.set('customs', this.normalizeCustoms(customs))

    if (!this.store.get('version')) {
      this.store.set('version', ACP_STORE_VERSION)
    }
  }

  private getData(): AcpStoreData {
    return {
      builtins: deepClone(
        (this.store.get('builtins') as AcpBuiltinAgent[]) ?? this.createDefaultBuiltins()
      ),
      customs: deepClone((this.store.get('customs') as AcpCustomAgent[]) ?? []),
      enabled: this.getGlobalEnabled(),
      version: (this.store.get('version') as string | undefined) ?? ACP_STORE_VERSION
    }
  }

  private createDefaultBuiltins(): AcpBuiltinAgent[] {
    return BUILTIN_ORDER.map((id) => this.createDefaultBuiltin(id))
  }

  private createDefaultBuiltin(id: AcpBuiltinAgentId): AcpBuiltinAgent {
    const profile = this.createProfile(BUILTIN_TEMPLATES[id].defaultProfile())
    return {
      id,
      name: BUILTIN_TEMPLATES[id].name,
      enabled: false,
      activeProfileId: profile.id,
      profiles: [profile]
    }
  }

  private normalizeBuiltins(builtins?: AcpBuiltinAgent[]): AcpBuiltinAgent[] {
    const normalizedMap = new Map<AcpBuiltinAgentId, AcpBuiltinAgent>()
    builtins
      ?.filter((agent): agent is AcpBuiltinAgent => Boolean(agent) && this.isBuiltinAgent(agent.id))
      .forEach((agent) => {
        normalizedMap.set(agent.id, this.normalizeBuiltin(agent))
      })

    return BUILTIN_ORDER.map((id) => normalizedMap.get(id) ?? this.createDefaultBuiltin(id))
  }

  private normalizeBuiltin(agent: AcpBuiltinAgent): AcpBuiltinAgent {
    const template = BUILTIN_TEMPLATES[agent.id]
    const profiles = (agent.profiles || [])
      .map((profile) => this.normalizeProfile(profile))
      .filter((profile): profile is AcpAgentProfile => Boolean(profile))

    if (!profiles.length) {
      profiles.push(this.createProfile(template.defaultProfile()))
    }

    let activeProfileId = profiles.find((profile) => profile.id === agent.activeProfileId)?.id
    if (!activeProfileId) {
      activeProfileId = profiles[0].id
    }

    return {
      id: agent.id,
      name: template.name,
      enabled: Boolean(agent.enabled),
      activeProfileId,
      profiles
    }
  }

  private normalizeCustoms(customs?: AcpCustomAgent[]): AcpCustomAgent[] {
    if (!Array.isArray(customs)) {
      return []
    }

    return customs
      .map((agent) =>
        this.normalizeCustomAgent(
          agent,
          typeof agent?.enabled === 'boolean' ? { enabled: agent.enabled } : undefined
        )
      )
      .filter((agent): agent is AcpCustomAgent => Boolean(agent))
  }

  private normalizeProfile(
    profile: Partial<AcpAgentProfile> & { id?: string }
  ): AcpAgentProfile | null {
    const command = profile.command?.toString().trim()
    if (!command) return null
    const name = profile.name?.toString().trim() || DEFAULT_PROFILE_NAME
    return {
      id: profile.id ?? nanoid(10),
      name,
      command,
      args: this.normalizeArgs(profile.args),
      env: this.normalizeEnv(profile.env)
    }
  }

  private createProfile(profile: Omit<AcpAgentProfile, 'id'> & { id?: string }): AcpAgentProfile {
    const normalized = this.normalizeProfile({ ...profile, id: profile.id })
    if (!normalized) {
      throw new Error('Invalid ACP agent profile payload')
    }
    return normalized
  }

  private normalizeCustomAgent(
    agent: Partial<AcpCustomAgent> & { id?: string },
    defaults?: { enabled?: boolean }
  ): AcpCustomAgent | null {
    const name = agent.name?.toString().trim()
    const command = agent.command?.toString().trim()
    if (!name || !command) {
      return null
    }
    const enabled = typeof agent.enabled === 'boolean' ? agent.enabled : (defaults?.enabled ?? true)
    const id = agent.id ?? nanoid(8)
    if (this.isBuiltinAgent(id)) {
      return null
    }
    return {
      id,
      name,
      command,
      args: this.normalizeArgs(agent.args),
      env: this.normalizeEnv(agent.env),
      enabled
    }
  }

  private normalizeLegacyAgent(
    agent?: Partial<AcpAgentConfig> & { id?: string }
  ): AcpAgentConfig | null {
    if (!agent) return null
    const id = agent.id?.toString().trim()
    const name = agent.name?.toString().trim()
    const command = agent.command?.toString().trim()
    if (!id || !name || !command) {
      return null
    }
    return {
      id,
      name,
      command,
      args: this.normalizeArgs(agent.args),
      env: this.normalizeEnv(agent.env)
    }
  }

  private normalizeArgs(args?: string[] | null): string[] | undefined {
    if (!Array.isArray(args)) return undefined
    const cleaned = args
      .map((arg) => arg?.toString().trim())
      .filter((arg): arg is string => Boolean(arg && arg.length > 0))
    return cleaned.length ? cleaned : undefined
  }

  private normalizeEnv(env?: Record<string, string> | null): Record<string, string> | undefined {
    if (!env || typeof env !== 'object') return undefined
    const entries = Object.entries(env)
      .map(([key, value]) => [key?.toString().trim(), value?.toString() ?? ''] as [string, string])
      .filter(([key]) => Boolean(key))
    if (!entries.length) return undefined
    return Object.fromEntries(entries)
  }

  private isBuiltinAgent(id: string): id is AcpBuiltinAgentId {
    return BUILTIN_ORDER.includes(id as AcpBuiltinAgentId)
  }
}
