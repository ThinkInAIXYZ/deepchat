import type { SkillExtensionConfig } from './skill'

export type SkillSourceType =
  | 'builtin'
  | 'created'
  | 'folder-install'
  | 'zip-install'
  | 'url-install'
  | 'git-install'
  | 'adopted'
  | 'imported'

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
  source: SkillSource
  agentLinks?: Record<string, AgentLinkInfo>
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

export interface SkillManagementMigrationState {
  targetAgentIds?: string[]
  completedAgentIds: string[]
  legacySkillAllowLists?: Record<string, string[]>
  completedAt?: string
}

export interface SkillManagementState {
  version: 2
  agents: Record<string, AgentSkillManagementState>
  sync?: SkillSyncDirectoryConfig
  migration?: SkillManagementMigrationState
}

/** Read-only compatibility shape for settings written before Agent-owned Skill roots. */
export interface LegacySkillManagementState {
  version: 1
  skills: Record<string, LegacySkillManagementItem>
  sync?: SkillSyncDirectoryConfig
  migration?: SkillManagementMigrationState
}

export type StoredSkillManagementState = SkillManagementState | LegacySkillManagementState

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
  disabled: boolean
  /** @deprecated Renderer compatibility during the scoped-Skill migration. */
  deepchatDisabled: boolean
  agentLinks: Record<string, AgentLinkInfo>
  mutable: boolean
}
