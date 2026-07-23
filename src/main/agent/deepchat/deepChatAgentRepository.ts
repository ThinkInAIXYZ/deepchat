import { nanoid } from 'nanoid'
import type { AgentRowStore } from '@/agent/shared/agentRowStore'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentRow } from '@/agent/data/tables/agents'
import { normalizeDisabledAgentTools } from '@/agent/shared/agentSessionNormalization'
import {
  assertDeepChatSubagentConfigInvariant,
  createDefaultDeepChatSubagentSlots,
  normalizeDeepChatSubagentConfig
} from '@shared/lib/deepchatSubagents'
import type {
  AgentAvatar,
  CreateDeepChatAgentInput,
  DeepChatAgentConfig,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'

export const BUILTIN_DEEPCHAT_AGENT_ID = 'deepchat'

export interface DeepChatAgentRepositoryDependencies {
  rows: AgentRowStore
  listSessionIdsByAgent(agentId: string): AppSessionId[]
  clearMemoryByAgent(agentId: string): number
  clearMemoryAuditByAgent(agentId: string): number
  transaction<T>(operation: () => T): T
}

export interface LegacyDeepChatConfigMaterializationResult {
  materializedAgentIds: string[]
  recoveredAgentIds: string[]
  legacySkillAllowLists: Record<string, string[]>
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

const normalizeExplicitDisabledAgentTools = (config: DeepChatAgentConfig): DeepChatAgentConfig => {
  if (!Object.prototype.hasOwnProperty.call(config, 'disabledAgentTools')) {
    return config
  }

  return {
    ...config,
    disabledAgentTools: normalizeDisabledAgentTools(config.disabledAgentTools)
  }
}

const prepareConfigWrite = (config: DeepChatAgentConfig): DeepChatAgentConfig => {
  const normalized = normalizeExplicitDisabledAgentTools(config)
  assertDeepChatSubagentConfigInvariant(normalized)
  return normalized
}

const createImplicitSubagentPolicyConfig = (): DeepChatAgentConfig =>
  normalizeDeepChatSubagentConfig({})

const createFailClosedSubagentPolicyConfig = (): DeepChatAgentConfig =>
  normalizeDeepChatSubagentConfig({ subagentEnabled: true, subagents: [] })

const parseDeepChatConfigRow = (row?: AgentRow): DeepChatAgentConfig | null => {
  if (!row || row.agent_type !== 'deepchat') return null
  const config = parseJson<DeepChatAgentConfig>(row.config_json)
  return config ? normalizeDeepChatSubagentConfig(config) : null
}

const resolveDeepChatConfigRow = (row?: AgentRow): DeepChatAgentConfig => {
  const config = parseDeepChatConfigRow(row)
  if (config) return config
  if (!row || row.agent_type !== 'deepchat') return {}
  return row.config_json
    ? createFailClosedSubagentPolicyConfig()
    : createImplicitSubagentPolicyConfig()
}

const normalizeNullableStringList = (
  value: string[] | null | undefined
): string[] | null | undefined => {
  if (value === null || value === undefined) return value
  return Array.from(
    new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean))
  )
}

const mergeNullableStringList = (
  baseValue: string[] | null | undefined,
  overrideValue: string[] | null | undefined
): string[] | null | undefined => normalizeNullableStringList(overrideValue ?? baseValue)

const mergeDeepChatConfig = (
  baseConfig: DeepChatAgentConfig,
  overrideConfig: DeepChatAgentConfig
): DeepChatAgentConfig =>
  normalizeDeepChatSubagentConfig({
    defaultModelPreset: overrideConfig.defaultModelPreset ?? baseConfig.defaultModelPreset ?? null,
    assistantModel: overrideConfig.assistantModel ?? baseConfig.assistantModel ?? null,
    visionModel: overrideConfig.visionModel ?? baseConfig.visionModel ?? null,
    imageGenerationModel:
      overrideConfig.imageGenerationModel ?? baseConfig.imageGenerationModel ?? null,
    defaultProjectPath: overrideConfig.defaultProjectPath ?? baseConfig.defaultProjectPath ?? null,
    systemPrompt: overrideConfig.systemPrompt ?? baseConfig.systemPrompt ?? '',
    permissionMode: overrideConfig.permissionMode ?? baseConfig.permissionMode,
    disabledAgentTools: normalizeDisabledAgentTools(
      overrideConfig.disabledAgentTools ?? baseConfig.disabledAgentTools
    ),
    enabledSkillNames: mergeNullableStringList(
      baseConfig.enabledSkillNames,
      overrideConfig.enabledSkillNames
    ),
    enabledMcpServerIds: mergeNullableStringList(
      baseConfig.enabledMcpServerIds,
      overrideConfig.enabledMcpServerIds
    ),
    subagentEnabled: overrideConfig.subagentEnabled ?? baseConfig.subagentEnabled ?? true,
    subagents:
      overrideConfig.subagents ?? baseConfig.subagents ?? createDefaultDeepChatSubagentSlots(),
    autoCompactionEnabled:
      overrideConfig.autoCompactionEnabled ?? baseConfig.autoCompactionEnabled ?? true,
    autoCompactionTriggerThreshold:
      overrideConfig.autoCompactionTriggerThreshold ??
      baseConfig.autoCompactionTriggerThreshold ??
      80,
    autoCompactionRetainRecentPairs:
      overrideConfig.autoCompactionRetainRecentPairs ??
      baseConfig.autoCompactionRetainRecentPairs ??
      2,
    memoryEnabled: overrideConfig.memoryEnabled ?? baseConfig.memoryEnabled ?? false,
    memoryEmbedding: overrideConfig.memoryEmbedding ?? baseConfig.memoryEmbedding ?? null,
    memoryExtractionModel:
      overrideConfig.memoryExtractionModel ?? baseConfig.memoryExtractionModel ?? null,
    memoryRetrieval: overrideConfig.memoryRetrieval ?? baseConfig.memoryRetrieval ?? null,
    memoryInjectionTokenBudget:
      overrideConfig.memoryInjectionTokenBudget ?? baseConfig.memoryInjectionTokenBudget ?? null,
    personaEvolutionEnabled:
      overrideConfig.personaEvolutionEnabled ?? baseConfig.personaEvolutionEnabled ?? false
  })

export class DeepChatAgentRepository {
  constructor(private readonly dependencies: DeepChatAgentRepositoryDependencies) {}

  ensureBuiltin(defaults?: {
    name?: string
    icon?: string | null
    avatar?: AgentAvatar | null
    config?: DeepChatAgentConfig | null
  }): AgentRow {
    const { rows } = this.dependencies
    const existing = rows.get(BUILTIN_DEEPCHAT_AGENT_ID)
    if (!existing) {
      rows.create({
        id: BUILTIN_DEEPCHAT_AGENT_ID,
        agentType: 'deepchat',
        source: 'builtin',
        name: defaults?.name?.trim() || 'DeepChat',
        enabled: true,
        protected: true,
        icon: sanitizeString(defaults?.icon),
        avatarJson: stringifyJson(defaults?.avatar ?? null),
        configJson: stringifyJson(defaults?.config ? prepareConfigWrite(defaults.config) : null)
      })
    } else {
      rows.update(BUILTIN_DEEPCHAT_AGENT_ID, { enabled: true, protected: true })
    }
    return rows.get(BUILTIN_DEEPCHAT_AGENT_ID) as AgentRow
  }

  create(input: CreateDeepChatAgentInput): AgentRow {
    const id = `deepchat-${nanoid(8)}`
    this.dependencies.rows.create({
      id,
      agentType: 'deepchat',
      source: 'manual',
      name: input.name.trim(),
      enabled: input.enabled !== false,
      protected: false,
      description: sanitizeString(input.description),
      icon: sanitizeString(input.icon),
      avatarJson: stringifyJson(input.avatar ?? null),
      configJson: stringifyJson(input.config ? prepareConfigWrite(input.config) : null)
    })
    return this.dependencies.rows.get(id) as AgentRow
  }

  update(agentId: string, updates: UpdateDeepChatAgentInput): AgentRow | null {
    const { rows } = this.dependencies
    const row = rows.get(agentId)
    if (!row || row.agent_type !== 'deepchat') return null

    const currentConfig = parseJson<DeepChatAgentConfig>(row.config_json) ?? {}
    const nextConfig =
      updates.config === undefined
        ? currentConfig
        : prepareConfigWrite({
            ...currentConfig,
            ...clone(updates.config ?? {})
          })
    rows.update(agentId, {
      name: updates.name?.trim() || row.name,
      enabled: updates.enabled ?? row.enabled === 1,
      description:
        updates.description === undefined ? row.description : sanitizeString(updates.description),
      icon: updates.icon === undefined ? row.icon : sanitizeString(updates.icon),
      avatarJson:
        updates.avatar === undefined ? row.avatar_json : stringifyJson(updates.avatar ?? null),
      configJson: updates.config === undefined ? row.config_json : stringifyJson(nextConfig)
    })
    return rows.get(agentId) ?? null
  }

  canDelete(agentId: string): boolean {
    const row = this.dependencies.rows.get(agentId)
    return Boolean(
      row &&
      row.agent_type === 'deepchat' &&
      row.protected !== 1 &&
      this.dependencies.listSessionIdsByAgent(agentId).length === 0
    )
  }

  delete(agentId: string): boolean {
    return this.dependencies.transaction(() => {
      const row = this.dependencies.rows.get(agentId)
      if (!row || row.agent_type !== 'deepchat' || row.protected === 1) return false
      if (this.dependencies.listSessionIdsByAgent(agentId).length > 0) return false
      this.dependencies.clearMemoryByAgent(agentId)
      this.dependencies.clearMemoryAuditByAgent(agentId)
      this.dependencies.rows.delete(agentId)
      return true
    })
  }

  getConfig(agentId: string): DeepChatAgentConfig | null {
    return parseDeepChatConfigRow(this.dependencies.rows.get(agentId))
  }

  resolveConfig(agentId: string): DeepChatAgentConfig {
    return mergeDeepChatConfig({}, resolveDeepChatConfigRow(this.dependencies.rows.get(agentId)))
  }

  listResolvedConfigs(): Array<{ agentId: string; config: DeepChatAgentConfig }> {
    const rows = this.dependencies.rows.list({ agentType: 'deepchat' })
    return rows.map((row) => ({
      agentId: row.id,
      config: mergeDeepChatConfig({}, resolveDeepChatConfigRow(row))
    }))
  }

  materializeLegacyInheritedConfigs(): LegacyDeepChatConfigMaterializationResult {
    return this.dependencies.transaction(() => {
      const { rows } = this.dependencies
      const agentRows = rows.list({ agentType: 'deepchat' })
      const builtin = resolveDeepChatConfigRow(
        agentRows.find((row) => row.id === BUILTIN_DEEPCHAT_AGENT_ID)
      )
      const materializedAgentIds: string[] = []
      const recoveredAgentIds: string[] = []
      const legacySkillAllowLists: Record<string, string[]> = {}

      for (const row of agentRows) {
        if (row.id === BUILTIN_DEEPCHAT_AGENT_ID) continue

        const storedConfig = parseDeepChatConfigRow(row)
        const legacyEffectiveConfig = mergeDeepChatConfig(
          builtin,
          storedConfig ??
            (row.config_json
              ? createFailClosedSubagentPolicyConfig()
              : createImplicitSubagentPolicyConfig())
        )
        if (Array.isArray(legacyEffectiveConfig.enabledSkillNames)) {
          legacySkillAllowLists[row.id] = legacyEffectiveConfig.enabledSkillNames
        }
        if (row.config_json && !storedConfig) {
          recoveredAgentIds.push(row.id)
        }

        rows.update(row.id, { configJson: stringifyJson(legacyEffectiveConfig) })
        materializedAgentIds.push(row.id)
      }

      return { materializedAgentIds, recoveredAgentIds, legacySkillAllowLists }
    })
  }
}
