import type { SkillExtensionConfig } from './skill'

export const SKILL_SOURCE_TYPES = [
  'builtin',
  'created',
  'folder-install',
  'zip-install',
  'url-install',
  'git-install',
  'adopted',
  'imported'
] as const

export type SkillSourceType = (typeof SKILL_SOURCE_TYPES)[number]

export function isSkillSourceType(value: unknown): value is SkillSourceType {
  return typeof value === 'string' && SKILL_SOURCE_TYPES.some((sourceType) => sourceType === value)
}

export type SkillRepoFormat = 'single-skill' | 'multi-skill'

export interface SkillSource {
  type: SkillSourceType
  repoUrl?: string
  repoFormat?: SkillRepoFormat
  agentId?: string
  originalPath?: string
  importedFrom?: string
  installedAt?: string
  importedAt?: string
  adoptedAt?: string
}

export interface AgentLinkInfo {
  path: string
  state: 'linked' | 'missing' | 'broken' | 'conflict' | 'permission-denied'
  createdByDeepChat: boolean
  linkedAt?: string
}

export interface SkillManagementItem {
  name: string
  canonicalPath: string
  disabled: boolean
  extension: SkillExtensionConfig
  /** Opaque revision for external runtime environment values; never contains those values. */
  runtimeBindingId?: string
  source: SkillSource
  agentLinks?: Record<string, AgentLinkInfo>
}

export interface SharedSkillManagementItem {
  name: string
  canonicalPath: string
  source: SkillSource
}

export interface AgentSkillBinding {
  assigned: boolean
  extension: SkillExtensionConfig
  /** Opaque revision for external runtime environment values; never contains those values. */
  runtimeBindingId?: string
}

export interface AgentSkillBindingState {
  bindings: Record<string, AgentSkillBinding>
}

export interface LegacySkillManagementItem extends Omit<SkillManagementItem, 'disabled'> {
  deepchat: {
    disabled: boolean
  }
}

export interface SkillSyncDirectoryConfig {
  skillsDirectory: string
  layout: 'multi-skill-repo'
  lastExportAt?: string | null
  lastImportAt?: string | null
}

export interface AgentSkillManagementState {
  skills: Record<string, SkillManagementItem>
  migratedAt?: string
}

export interface LegacySkillManagementMigrationState {
  targetAgentIds?: string[]
  completedAgentIds: string[]
  legacySkillAllowLists?: Record<string, string[]>
  completedAt?: string
}

export interface LegacySkillManagementStateV2 {
  version: 2
  agents: Record<string, AgentSkillManagementState>
  sync?: SkillSyncDirectoryConfig
  migration?: LegacySkillManagementMigrationState
}

export interface SharedSkillMigrationState {
  sourceVersion: 1 | 2
  status: 'planned' | 'committing' | 'completed'
  startedAt: string
  completedAt?: string
  /** Maps an Agent's legacy Skill name to its canonical global name. */
  agentSkillNames: Record<string, Record<string, string>>
}

export interface SkillManagementState {
  version: 3
  skills: Record<string, SharedSkillManagementItem>
  agents: Record<string, AgentSkillBindingState>
  sync?: SkillSyncDirectoryConfig
  migration?: SharedSkillMigrationState
}

/** Read-only compatibility shape for settings written before Agent-owned Skill roots. */
export interface LegacySkillManagementState {
  version: 1
  skills: Record<string, LegacySkillManagementItem>
  sync?: SkillSyncDirectoryConfig
  migration?: LegacySkillManagementMigrationState
}

export type StoredSkillManagementState =
  | SkillManagementState
  | LegacySkillManagementStateV2
  | LegacySkillManagementState

export interface UnifiedSkillItem {
  agentId: string
  name: string
  description: string
  path: string
  skillRoot: string
  category?: string | null
  platforms?: string[]
  metadata?: Record<string, unknown>
  allowedTools?: string[]
  ownerPluginId?: string
  canonicalPath: string
  sourceType: SkillSourceType
  /** True when this item belongs to the requested Agent's derived catalog. */
  assigned: boolean
  /** Populated for global views; empty for callers that do not request enabled Agent impact. */
  assignedAgentIds: string[]
  disabled: boolean
  /** @deprecated Renderer compatibility during the scoped-Skill migration. */
  deepchatDisabled: boolean
  agentLinks: Record<string, AgentLinkInfo>
  mutable: boolean
}

export interface SkillDeleteResult extends SkillInstallResultLike {
  affectedAgentIds?: string[]
}

interface SkillInstallResultLike {
  success: boolean
  skillName?: string
  error?: string
  errorCode?:
    | 'not_found'
    | 'conflict'
    | 'invalid_skill'
    | 'permission_denied'
    | 'target_locked'
    | 'io_error'
    | 'stale_impact'
}
