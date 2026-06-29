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
  deepchat: {
    disabled: boolean
  }
  extension: SkillExtensionConfig
  source: SkillSource
  agentLinks?: Record<string, AgentLinkInfo>
}

export interface SkillSyncDirectoryConfig {
  skillsDirectory: string
  layout: 'multi-skill-repo'
  lastExportAt?: string | null
  lastImportAt?: string | null
}

export interface SkillManagementState {
  version: 1
  skills: Record<string, SkillManagementItem>
  sync?: SkillSyncDirectoryConfig
}

export interface UnifiedSkillItem {
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
  deepchatDisabled: boolean
  agentLinks: Record<string, AgentLinkInfo>
  mutable: boolean
}
