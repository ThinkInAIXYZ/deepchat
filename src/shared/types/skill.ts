/**
 * Skills System Type Definitions
 *
 * Skills are file-based knowledge modules that provide specialized expertise
 * and behavioral guidance to AI agents. They support progressive loading
 * (metadata first, full content on activation) and hot-reloading.
 */

import type {
  SkillDeleteResult,
  SkillManagementState,
  SkillSyncDirectoryConfig,
  SkillSourceType,
  UnifiedSkillItem
} from './skillManagement'

export const SKILL_ARCHIVE_MAX_INPUT_BYTES = 200 * 1024 * 1024
export const SKILL_NAME_MAX_LENGTH = 255
export const SKILL_EFFECTIVE_CONTENT_MAX_BYTES = 512 * 1024
export const SKILL_EFFECTIVE_CONTENT_MAX_BATCH_BYTES = 2 * 1024 * 1024
export const SKILL_RUNTIME_VIEW_RESULT_MAX_BYTES = SKILL_EFFECTIVE_CONTENT_MAX_BYTES + 256 * 1024
export const SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES = 512 * 1024
export const SKILL_EXECUTION_PACKAGE_MAX_FILES = 256
export const SKILL_EXECUTION_PACKAGE_MAX_BYTES = 4 * 1024 * 1024
export const SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES = 256
export const SKILL_EXECUTION_PACKAGE_MAX_DEPTH = 16
export const SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES = 4096
export const SKILL_EXECUTION_PACKAGE_MAX_SUPPORT_PATHS = 16
export const SKILL_EXECUTION_PACKAGE_MAX_BATCH_BYTES = 16 * 1024 * 1024
export const SKILL_EXECUTION_PACKAGE_MAX_ENCODED_BYTES = 7 * 1024 * 1024
export const SKILL_EXECUTION_PACKAGE_MAX_BATCH_ENCODED_BYTES = 28 * 1024 * 1024
export const SKILL_RUN_MAX_ARGUMENTS = 128
export const SKILL_RUN_MAX_ARGUMENT_CHARS = 8 * 1024
export const SKILL_RUN_MAX_TOTAL_ARGUMENT_CHARS = 24 * 1024
export const SKILL_RUN_MAX_STDIN_CHARS = 1024 * 1024
export const SKILL_RUN_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/**
 * Skill metadata extracted from SKILL.md frontmatter.
 * Always kept in memory for quick access and semantic matching.
 */
export interface SkillMetadata {
  /** Unique identifier (must match directory name) */
  name: string
  /** Short description for semantic matching */
  description: string
  /** Full path to SKILL.md file */
  path: string
  /** Skill root directory path */
  skillRoot: string
  /** Optional category path derived from nested folders under the skills root */
  category?: string | null
  /** Optional platform restrictions declared in SKILL.md */
  platforms?: string[]
  /** Optional arbitrary metadata declared in SKILL.md */
  metadata?: Record<string, unknown>
  /** Optional additional tools required by this skill */
  allowedTools?: string[]
  /** Explicit non-executable paths required by scripts at runtime. */
  executionSupportPaths?: string[]
  /** Plugin owner id when the skill is contributed by a plugin */
  ownerPluginId?: string
  /** DeepChat-owned resource exposed read-only without copying into an Agent Skill root */
  readOnly?: boolean
}

/**
 * Full skill content loaded when activated.
 * Injected into system prompt.
 */
export interface SkillContent {
  /** Skill name */
  name: string
  /** Full SKILL.md content (body after frontmatter) */
  content: string
}

/** Canonical main-process identity for a Skill body materialized from disk. */
export interface EffectiveSkillContentIdentity {
  agentId: string
  sourceType: SkillSourceType
  sourceId: string
  skillName: string
}

/** Main-process-only source snapshot used to materialize a bounded Skill execution package. */
export interface EffectiveSkillExecutionPackage {
  files: Array<{
    relativePath: string
    base64: string
    byteCount: number
    sha256: string
  }>
  executables: Array<{
    relativePath: string
    runtime: SkillScriptRuntime
    enabled: boolean
  }>
  runtimePolicy: SkillRuntimePolicy
  /**
   * Opaque version of an external environment binding. Secret values remain in Skill settings and
   * execution must fail closed when the current binding no longer matches this identifier.
   */
  environmentBindingId: string | null
}

/** Fresh canonical Skill content and evidence used by internal runtime materializers. */
export interface EffectiveSkillContentResolution {
  identity: EffectiveSkillContentIdentity
  effectiveContent: string
  builderVersion: string
  renderedManifestHash: string
  scriptInventoryHash: string
  executionPackage: EffectiveSkillExecutionPackage
}

export type SkillRuntimePreference = 'auto' | 'system' | 'builtin'

export interface SkillRuntimePolicy {
  python: SkillRuntimePreference
  node: SkillRuntimePreference
}

export interface SkillScriptOverride {
  enabled?: boolean
  description?: string
}

export interface SkillExtensionConfig {
  version: 1
  env: Record<string, string>
  runtimePolicy: SkillRuntimePolicy
  scriptOverrides: Record<string, SkillScriptOverride>
}

export type SkillScriptRuntime = 'python' | 'node' | 'shell'

export interface SkillScriptDescriptor {
  name: string
  relativePath: string
  absolutePath: string
  runtime: SkillScriptRuntime
  enabled: boolean
  description?: string
}

/**
 * Skill installation result
 */
export interface SkillInstallResult {
  success: boolean
  error?: string
  errorCode?:
    | 'conflict'
    | 'invalid_skill'
    | 'not_found'
    | 'io_error'
    | 'target_locked'
    | 'permission_denied'
    | 'stale_impact'
  /** Original selected name when a bulk import may rename the installed Skill. */
  sourceSkillName?: string
  skillName?: string
  existingSkillName?: string
  targetPath?: string
}

/**
 * Skill installation options
 */
export interface SkillInstallOptions {
  overwrite?: boolean
  /** Validated destination name used by snapshot import/rename flows. */
  targetName?: string
  /** Required by shared-content workflows that previewed current assignment impact. */
  acknowledgedAgentIds?: string[]
}

export interface SkillImportProvenance {
  importedFrom: string
  sourceAgentId?: string
}

export type SkillInstallConflictStrategy = 'rename' | 'overwrite' | 'skip'

export type GitSkillRepoFormat = 'single-skill' | 'multi-skill'

export interface GitSkillRepoScanItem {
  name: string
  description: string
  relativePath: string
  conflict: boolean
  valid: boolean
  error?: string
}

export interface GitSkillRepoScanResult {
  repoUrl: string
  repoFormat: GitSkillRepoFormat
  skills: GitSkillRepoScanItem[]
}

export interface GitSkillInstallInput {
  repoUrl: string
  skillNames: string[]
  strategy?: SkillInstallConflictStrategy
}

export type SyncDirectorySkillState = 'new' | 'same' | 'modified' | 'conflict' | 'invalid'

export interface SkillSyncDirectoryPreviewItem {
  name: string
  state: SyncDirectorySkillState
  sourcePath: string
  targetPath: string
  error?: string
}

export interface SkillSyncDirectoryExportInput {
  skillNames: string[]
  includeDisabled?: boolean
}

export interface SkillSyncDirectoryImportInput {
  skillNames: string[]
  strategy?: SkillInstallConflictStrategy
}

export interface SkillSyncDirectoryExportPreview {
  skillsDirectory: string
  items: SkillSyncDirectoryPreviewItem[]
}

export interface SkillSyncDirectoryImportPreview {
  skillsDirectory: string
  items: SkillSyncDirectoryPreviewItem[]
}

export interface SkillSyncDirectoryResult {
  success: boolean
  exported?: number
  imported?: number
  skipped: number
  failed: Array<{ skillName: string; reason: string }>
}

/**
 * Folder tree node for displaying skill directory structure
 */
export interface SkillFolderNode {
  name: string
  type: 'file' | 'directory'
  path: string
  children?: SkillFolderNode[]
}

/**
 * Skill state associated with a conversation session.
 * Persisted in the database.
 */
export interface SkillState {
  /** Associated conversation ID */
  conversationId: string
  /** Persisted pinned skill names (legacy field name kept for compatibility) */
  activeSkills: string[]
}

/**
 * Skill list tool response item
 */
export interface SkillListItem {
  name: string
  description?: string
  category?: string
  platforms?: string[]
  sessionActive: boolean
  activeForExecution: boolean
  /** @deprecated Use sessionActive. */
  isPinned: boolean
  /** @deprecated Use activeForExecution. */
  active: boolean
}

export interface SkillListInput {
  query?: string
  cursor?: string
  limit?: number
}

export interface SkillListResult {
  skills: SkillListItem[]
  sessionActiveCount: number
  activeForExecutionCount: number
  /** @deprecated Use sessionActiveCount. */
  pinnedCount: number
  /** @deprecated Use activeForExecutionCount. */
  activeCount: number
  totalCount: number
  totalMatched: number
  omittedCount: number
  nextCursor?: string
}

export interface SkillLinkedFile {
  path: string
  kind: 'reference' | 'template' | 'script' | 'asset' | 'other'
}

export interface SkillViewResult {
  success: boolean
  name?: string
  category?: string | null
  skillRoot?: string
  filePath?: string | null
  content?: string
  platforms?: string[]
  metadata?: Record<string, unknown>
  linkedFiles?: SkillLinkedFile[]
  isPinned?: boolean
  error?: string
}

export type SkillManageAction = 'create' | 'edit' | 'write_file' | 'remove_file' | 'delete'

export interface SkillManageRequest {
  action: SkillManageAction
  draftId?: string
  content?: string
  filePath?: string
  fileContent?: string
}

export interface SkillManageResult {
  success: boolean
  action: SkillManageAction
  draftId?: string
  filePath?: string
  skillName?: string
  draftStatus?: 'created' | 'updated' | 'deleted' | 'installed' | 'viewed'
  content?: string
  error?: string
}

export type SkillDraftUserAction = 'view' | 'install' | 'discard'

export interface SkillDraftActionResult {
  success: boolean
  action: SkillDraftUserAction
  draftId: string
  skillName?: string
  content?: string
  installedSkillName?: string
  error?: string
}

/** Main-process Skill operations. */
export interface SkillServicePort {
  initialize(): Promise<void>

  // Discovery and listing
  getSkillsDir(): Promise<string>
  getSkillsDir(agentId: string): Promise<string>
  discoverSkills(): Promise<SkillMetadata[]>
  discoverSkills(agentId: string): Promise<SkillMetadata[]>
  refreshAgentCatalog(agentId: string): Promise<SkillMetadata[]>
  getMetadataList(): Promise<SkillMetadata[]>
  getMetadataList(agentId: string): Promise<SkillMetadata[]>
  getUnifiedSkillCatalog(): Promise<UnifiedSkillItem[]>
  getUnifiedSkillCatalog(agentId: string): Promise<UnifiedSkillItem[]>
  getAllSkills(): Promise<UnifiedSkillItem[]>
  getSkillManagementState(): Promise<SkillManagementState>
  setSkillDeepChatDisabled(name: string, disabled: boolean): Promise<void>
  setSkillDisabledForAgent(agentId: string, name: string, disabled: boolean): Promise<void>
  setSkillAssignment(agentId: string, name: string, assigned: boolean): Promise<void>
  setSkillAssignmentForAgents(agentIds: string[], name: string, assigned: boolean): Promise<void>
  setSkillAssignments(agentId: string, skillNames: string[]): Promise<string[]>

  // Content loading
  loadSkillContent(name: string): Promise<SkillContent | null>
  loadSkillContent(agentId: string, name: string): Promise<SkillContent | null>
  resolveFreshEffectiveSkillContents(
    agentId: string,
    names: readonly string[]
  ): Promise<EffectiveSkillContentResolution[]>
  viewSkillForAgent(
    agentId: string,
    name: string,
    options?: {
      filePath?: string
      conversationId?: string
      activeSkillNames?: readonly string[]
    }
  ): Promise<SkillViewResult>
  viewSkill(
    name: string,
    options?: {
      filePath?: string
      conversationId?: string
    }
  ): Promise<SkillViewResult>
  viewDraftSkill(conversationId: string, draftId: string): Promise<SkillDraftActionResult>
  installDraftSkill(conversationId: string, draftId: string): Promise<SkillDraftActionResult>
  discardDraftSkill(conversationId: string, draftId: string): Promise<SkillDraftActionResult>
  manageDraftSkill(
    conversationId: string,
    request: SkillManageRequest,
    options?: { beforeMutation?: () => void }
  ): Promise<SkillManageResult>

  // Installation and uninstallation
  installBuiltinSkills(): Promise<void>
  installFromFolder(folderPath: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  installFromFolderForAgent(
    agentId: string,
    folderPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult>
  installImportedSkill(
    agentIds: string[],
    folderPath: string,
    provenance: SkillImportProvenance,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult>
  installFromZip(zipPath: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  installFromZipForAgent(
    agentId: string,
    zipPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult>
  installFromUrl(url: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  installFromUrlForAgent(
    agentId: string,
    url: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult>
  scanGitSkillRepo(repoUrl: string): Promise<GitSkillRepoScanResult>
  scanGitSkillRepoForAgent(agentId: string, repoUrl: string): Promise<GitSkillRepoScanResult>
  installSkillsFromGit(input: GitSkillInstallInput): Promise<SkillInstallResult[]>
  installSkillsFromGitForAgent(
    agentId: string,
    input: GitSkillInstallInput
  ): Promise<SkillInstallResult[]>
  getSkillsSyncConfig(): Promise<SkillSyncDirectoryConfig | null>
  setSkillsSyncDirectory(input: { skillsDirectory: string }): Promise<SkillSyncDirectoryConfig>
  previewSyncDirectoryExport(
    input: SkillSyncDirectoryExportInput
  ): Promise<SkillSyncDirectoryExportPreview>
  executeSyncDirectoryExport(
    input: SkillSyncDirectoryExportInput
  ): Promise<SkillSyncDirectoryResult>
  previewSyncDirectoryImport(): Promise<SkillSyncDirectoryImportPreview>
  executeSyncDirectoryImport(
    input: SkillSyncDirectoryImportInput
  ): Promise<SkillSyncDirectoryResult>
  uninstallSkill(name: string): Promise<SkillInstallResult>
  uninstallSkillForAgent(agentId: string, name: string): Promise<SkillInstallResult>
  deleteSkill(name: string, acknowledgedAgentIds: string[]): Promise<SkillDeleteResult>
  cleanupAgentSkills(agentId: string): Promise<void>
  registerPluginSkill(input: {
    ownerPluginId: string
    id: string
    skillRoot: string
    pluginRoot?: string
  }): Promise<void> | void
  unregisterPluginSkillsByOwner(ownerPluginId: string): Promise<void> | void

  // File operations
  readSkillFile(name: string): Promise<string>
  readSkillFileForAgent(agentId: string, name: string): Promise<string>
  updateSkillFile(name: string, content: string): Promise<SkillInstallResult>
  updateSkillFileForAgent(
    agentId: string,
    name: string,
    content: string
  ): Promise<SkillInstallResult>
  saveSkillWithExtension(
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult>
  saveSkillWithExtensionForAgent(
    agentId: string,
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult>
  getSkillFolderTree(name: string): Promise<SkillFolderNode[]>
  getSkillFolderTreeForAgent(agentId: string, name: string): Promise<SkillFolderNode[]>
  openSkillsFolder(): Promise<void>
  openSkillsFolderForAgent(agentId: string): Promise<void>
  getSkillExtension(name: string): Promise<SkillExtensionConfig>
  getSkillExtensionForAgent(agentId: string, name: string): Promise<SkillExtensionConfig>
  resolveSkillRuntimeEnvironmentBinding(
    agentId: string,
    name: string,
    expectedBindingId: string | null
  ): Promise<Record<string, string>>
  saveSkillExtension(name: string, config: SkillExtensionConfig): Promise<void>
  saveSkillExtensionForAgent(
    agentId: string,
    name: string,
    config: SkillExtensionConfig
  ): Promise<void>
  listSkillScripts(name: string): Promise<SkillScriptDescriptor[]>
  listSkillScriptsForAgent(agentId: string, name: string): Promise<SkillScriptDescriptor[]>

  // Session state management
  getActiveSkills(conversationId: string): Promise<string[]>
  setActiveSkills(conversationId: string, skills: string[]): Promise<string[]>
  removeActiveSkill(conversationId: string, skill: string): Promise<string[]>
  clearNewAgentSessionSkills(conversationId: string): Promise<void>
  completeNewAgentSessionSkillsDeletion(conversationId: string): void
  resolveSessionAgentId(conversationId: string): Promise<string | null>
  revalidateActiveSkillsForAgent(conversationId: string, agentId: string): Promise<string[]>
  validateSkillNames(names: string[]): Promise<string[]>
  validateSkillNames(agentId: string, names: string[]): Promise<string[]>

  // Tool integration
  getActiveSkillsAllowedTools(
    conversationId: string,
    activeSkillNames?: string[]
  ): Promise<string[]>

  // Hot reload
  watchSkillFiles(): Promise<void>
  stopWatching(): Promise<void>
  destroy(): Promise<void>
}
