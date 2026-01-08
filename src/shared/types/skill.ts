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

/**
 * Skill installation result
 */
export interface SkillInstallResult {
  success: boolean
  error?: string
  skillName?: string
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
  /** Set of activated skill names */
  activeSkills: string[]
}

/**
 * Skill list tool response item
 */
export interface SkillListItem {
  name: string
  description: string
  active: boolean
}

/**
 * Skill control action type
 */
export type SkillControlAction = 'activate' | 'deactivate'

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

  // Installation and uninstallation
  installBuiltinSkills(): Promise<void>
  installFromFolder(folderPath: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  installFromZip(zipPath: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  installFromUrl(url: string, options?: SkillInstallOptions): Promise<SkillInstallResult>
  uninstallSkill(name: string): Promise<SkillInstallResult>

  // File operations
  updateSkillFile(name: string, content: string): Promise<SkillInstallResult>
  getSkillFolderTree(name: string): Promise<SkillFolderNode[]>
  openSkillsFolder(): Promise<void>

  // Session state management
  getActiveSkills(conversationId: string): Promise<string[]>
  setActiveSkills(conversationId: string, skills: string[]): Promise<void>
  validateSkillNames(names: string[]): Promise<string[]>

  // Tool integration
  getActiveSkillsAllowedTools(conversationId: string): Promise<string[]>

  // Hot reload
  watchSkillFiles(): void
  stopWatching(): void
}
