/**
 * Skills System Type Definitions
 *
 * Skills are file-based knowledge modules that provide specialized expertise
 * and behavioral guidance to AI agents. They support progressive loading
 * (metadata first, full content on activation) and hot-reloading.
 */

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
  errorCode?: 'conflict' | 'invalid_skill' | 'not_found' | 'io_error'
  skillName?: string
  existingSkillName?: string
}

/**
 * Skill installation options
 */
export interface SkillInstallOptions {
  overwrite?: boolean
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
  description: string
  category?: string | null
  platforms?: string[]
  metadata?: Record<string, unknown>
  isPinned: boolean
  active?: boolean
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
  draftPath?: string
  content?: string
  filePath?: string
  fileContent?: string
}

export interface SkillManageResult {
  success: boolean
  action: SkillManageAction
  draftPath?: string
  filePath?: string
  skillName?: string
  error?: string
}

/**
 * Skill Presenter interface for main process
 */
export interface ISkillPresenter {
  // Discovery and listing
  getSkillsDir(): Promise<string>
  discoverSkills(): Promise<SkillMetadata[]>
  getMetadataList(): Promise<SkillMetadata[]>
  getMetadataPrompt(): Promise<string>

  // Content loading
  loadSkillContent(name: string): Promise<SkillContent | null>
  viewSkill(
    name: string,
    options?: {
      filePath?: string
      conversationId?: string
    }
  ): Promise<SkillViewResult>
  manageDraftSkill(conversationId: string, request: SkillManageRequest): Promise<SkillManageResult>

  // Installation and uninstallation
  installBuiltinSkills(): Promise<void>
  installFromFolder(folderPath: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  installFromZip(zipPath: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  installFromUrl(url: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  uninstallSkill(name: string): Promise<SkillInstallResult>

  // File operations
  readSkillFile(name: string): Promise<string>
  updateSkillFile(name: string, content: string): Promise<SkillInstallResult>
  saveSkillWithExtension(
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult>
  getSkillFolderTree(name: string): Promise<SkillFolderNode[]>
  openSkillsFolder(): Promise<void>
  getSkillExtension(name: string): Promise<SkillExtensionConfig>
  saveSkillExtension(name: string, config: SkillExtensionConfig): Promise<void>
  listSkillScripts(name: string): Promise<SkillScriptDescriptor[]>

  // Session state management
  getActiveSkills(conversationId: string): Promise<string[]>
  setActiveSkills(conversationId: string, skills: string[]): Promise<void>
  clearNewAgentSessionSkills?(conversationId: string): Promise<void>
  validateSkillNames(names: string[]): Promise<string[]>

  // Tool integration
  getActiveSkillsAllowedTools(conversationId: string): Promise<string[]>

  // Hot reload
  watchSkillFiles(): void
  stopWatching(): void
}
