/**
 * Skills Sync System Type Definitions
 *
 * This module defines types for synchronizing skills between DeepChat
 * and external AI agent tools (Claude Code, Cursor, Windsurf, etc.)
 */

// ============================================================================
// Canonical Skill Format (Intermediate Format)
// ============================================================================

/**
 * Reference document attached to a skill
 */
export interface SkillReference {
  /** File name */
  name: string
  /** File content */
  content: string
  /** Relative path within skill folder */
  relativePath: string
}

/**
 * Script file attached to a skill
 */
export interface SkillScript {
  /** Script name */
  name: string
  /** Script content */
  content: string
  /** Relative path within skill folder */
  relativePath: string
}

/**
 * Source information for imported skills
 */
export interface SkillSource {
  /** Source tool identifier */
  tool: string
  /** Original file/folder path */
  originalPath: string
  /** Original format type */
  originalFormat: string
}

/**
 * Canonical Skill format - unified intermediate format for conversion
 * All external tool formats are converted to/from this format
 */
export interface CanonicalSkill {
  // Basic metadata
  /** Unique identifier */
  name: string
  /** Description text */
  description: string

  // Content
  /** Main instruction content (Markdown) */
  instructions: string

  // Optional metadata
  /** Tool restrictions */
  allowedTools?: string[]
  /** Specified model */
  model?: string
  /** Tags/categories */
  tags?: string[]

  // Attached resources
  /** Reference documents */
  references?: SkillReference[]
  /** Script files */
  scripts?: SkillScript[]

  // Source information
  /** Original source info (for imported skills) */
  source?: SkillSource
}

// ============================================================================
// External Tool Configuration
// ============================================================================

/**
 * Format capabilities - what features a format supports
 */
export interface FormatCapabilities {
  /** Has YAML frontmatter */
  hasFrontmatter: boolean
  /** Supports name field */
  supportsName: boolean
  /** Supports description field */
  supportsDescription: boolean
  /** Supports tool restrictions */
  supportsTools: boolean
  /** Supports model specification */
  supportsModel: boolean
  /** Supports subfolder structure (references/, scripts/) */
  supportsSubfolders: boolean
  /** Supports references/ folder */
  supportsReferences: boolean
  /** Supports scripts/ folder */
  supportsScripts: boolean
}

/**
 * External tool configuration
 * Defines how to find and parse skills from an external tool
 */
export interface ExternalToolConfig {
  /** Tool unique identifier */
  id: string
  /** Display name */
  name: string
  /** Skills directory path (relative to HOME or project root) */
  skillsDir: string
  /** File matching pattern (glob) */
  filePattern: string
  /** Format type identifier */
  format: string
  /** Format capabilities */
  capabilities: FormatCapabilities
  /** Whether this is a project-level tool (vs user-level) */
  isProjectLevel?: boolean
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Information about a skill discovered in an external tool
 */
export interface ExternalSkillInfo {
  /** Skill name */
  name: string
  /** Skill description (if available) */
  description?: string
  /** File or folder path */
  path: string
  /** Detected format type */
  format: string
  /** Last modified time */
  lastModified: Date
}

/**
 * Result of scanning an external tool
 */
export interface ScanResult {
  /** Tool identifier */
  toolId: string
  /** Tool display name */
  toolName: string
  /** Whether the directory exists */
  available: boolean
  /** Full path to skills directory */
  skillsDir: string
  /** Discovered skills */
  skills: ExternalSkillInfo[]
  /** Scan error (if any) */
  error?: string
}

export type AgentSkillOwner = 'deepchat' | 'agent' | 'external-link' | 'broken-link' | 'unknown'

export type AgentSkillStatus =
  | 'linked'
  | 'agent-owned'
  | 'linked-out'
  | 'broken-link'
  | 'conflict'
  | 'empty'

export type AgentSkillAction = 'adopt' | 'resolve-conflict' | 'repair-link' | 'remove-link' | 'open'

export interface AgentSkillLinkInfo {
  isSymlink: boolean
  targetPath?: string
  targetExists?: boolean
  targetInsideDeepChat?: boolean
  createdByDeepChat?: boolean
}

export interface AgentSkillDeepChatInfo {
  exists: boolean
  path?: string
  disabled?: boolean
  sameContent?: boolean
}

export interface AgentSkillItem {
  name: string
  description?: string
  path: string
  owner: AgentSkillOwner
  status: AgentSkillStatus
  action?: AgentSkillAction
  link?: AgentSkillLinkInfo
  deepchat?: AgentSkillDeepChatInfo
}

export interface SkillDetail {
  name: string
  description: string
  sourcePath: string
  markdown: string
  mutable: boolean
}

export interface InstalledSkillAgent {
  id: string
  name: string
  skillsDir: string
  isCustom: boolean
  supportsLinkManagement: boolean
  skillsCount: number
  linkedCount: number
  agentOwnedCount: number
  conflictCount: number
  brokenLinkCount: number
  status: 'ready' | 'detected-no-skills-dir' | 'permission-denied'
}

export interface InstalledSkillAgentDetail extends InstalledSkillAgent {
  skills: AgentSkillItem[]
}

export interface AdoptAgentSkillInput {
  agentId: string
  skillName: string
  targetName?: string
}

export interface AdoptAgentSkillPreview {
  agentId: string
  agentName: string
  skillName: string
  targetName: string
  sourcePath: string
  agentPath: string
  targetPath: string
  backupRoot: string
  conflict: boolean
  warnings: string[]
}

export interface AdoptAgentSkillResult {
  success: boolean
  skillName?: string
  targetPath?: string
  agentPath?: string
  backupPath?: string
  error?: string
}

export interface LinkDeepChatSkillsInput {
  agentId: string
  skillNames: string[]
}

export type LinkDeepChatSkillPreviewStatus = 'ready' | 'already-linked' | 'conflict' | 'missing'

export interface LinkDeepChatSkillPreviewItem {
  skillName: string
  sourcePath?: string
  targetPath: string
  status: LinkDeepChatSkillPreviewStatus
  message?: string
}

export interface LinkDeepChatSkillsPreview {
  agentId: string
  agentName: string
  skillsDir: string
  items: LinkDeepChatSkillPreviewItem[]
}

export interface LinkDeepChatSkillResult {
  success: boolean
  skillName?: string
  agentPath?: string
  targetPath?: string
  error?: string
}

export interface LinkDeepChatSkillsResult {
  success: boolean
  linked: number
  skipped: number
  failed: Array<{ skillName: string; reason: string }>
}

export interface AgentSkillLinkInput {
  agentId: string
  skillName: string
}

/**
 * Conflict handling strategy
 */
export enum ConflictStrategy {
  /** Skip the conflicting item */
  SKIP = 'skip',
  /** Overwrite the existing item */
  OVERWRITE = 'overwrite',
  /** Rename with suffix */
  RENAME = 'rename',
  /** Merge (only for specific scenarios) */
  MERGE = 'merge'
}

/**
 * Import preview - shows what will happen when importing
 */
export interface ImportPreview {
  /** Converted skill */
  skill: CanonicalSkill
  /** Source information */
  source: ExternalSkillInfo
  /** Conflict information (if any) */
  conflict?: {
    /** Existing skill with same name */
    existingSkillName: string
    /** Suggested strategy */
    strategy: ConflictStrategy
  }
  /** Conversion warnings (e.g., lost features) */
  warnings: string[]
}

/**
 * Export preview - shows what will happen when exporting
 */
export interface ExportPreview {
  /** Skill name to export */
  skillName: string
  /** Target tool identifier */
  targetTool: string
  /** Target file path */
  targetPath: string
  /** Converted content preview */
  convertedContent: string
  /** Conversion warnings */
  warnings: string[]
  /** Conflict information (if any) */
  conflict?: {
    /** Existing file path */
    existingPath: string
    /** Suggested strategy */
    strategy: ConflictStrategy
  }
  /** Tool-specific export options (e.g., KiroExportOptions) */
  exportOptions?: Record<string, unknown>
}

/**
 * Sync operation result
 */
export interface SyncResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Number of successfully imported items */
  imported: number
  /** Number of successfully exported items */
  exported: number
  /** Number of skipped items */
  skipped: number
  /** Failed items with reasons */
  failed: Array<{
    skill: string
    reason: string
  }>
}

// ============================================================================
// Kiro-specific Export Options
// ============================================================================

/**
 * Kiro inclusion mode
 */
export type KiroInclusionMode = 'always' | 'conditional' | 'on-demand'

/**
 * Kiro-specific export options
 */
export interface KiroExportOptions {
  /** Inclusion mode */
  inclusion?: KiroInclusionMode
  /** File patterns for conditional inclusion */
  filePatterns?: string[]
}

// ============================================================================
// Format Adapter Interface
// ============================================================================

/**
 * Parse context - additional info for parsing
 */
export interface ParseContext {
  /** Tool identifier */
  toolId: string
  /** File path being parsed */
  filePath: string
  /** Folder path (for tools with subfolder support) */
  folderPath?: string
}

/**
 * Format adapter interface - implemented by each tool adapter
 */
export interface IFormatAdapter {
  /** Adapter identifier */
  readonly id: string
  /** Adapter display name */
  readonly name: string

  /**
   * Parse external format to CanonicalSkill
   */
  parse(content: string, context: ParseContext): CanonicalSkill

  /**
   * Serialize CanonicalSkill to external format
   */
  serialize(skill: CanonicalSkill, options?: Record<string, unknown>): string

  /**
   * Detect if content matches this format
   */
  detect(content: string): boolean

  /**
   * Get format capabilities
   */
  getCapabilities(): FormatCapabilities
}

// ============================================================================
// Scan Cache Types (for incremental discovery)
// ============================================================================

/**
 * Cached skill info for comparison
 */
export interface CachedSkillInfo {
  /** Skill name */
  name: string
  /** Last modified timestamp (ISO string) */
  lastModified: string
}

/**
 * Cached tool scan result
 */
export interface CachedToolScan {
  /** Tool identifier */
  toolId: string
  /** Whether the directory existed */
  available: boolean
  /** List of skills found */
  skills: CachedSkillInfo[]
}

/**
 * Complete scan cache stored in config
 */
export interface ScanCache {
  /** When this cache was created (ISO string) */
  timestamp: string
  /** Cached results per tool */
  tools: CachedToolScan[]
}

/**
 * New discovery result after comparing with cache and current skills
 */
export interface NewDiscovery {
  /** Tool identifier */
  toolId: string
  /** Tool display name */
  toolName: string
  /** Newly discovered skills (not in cache and not in DeepChat) */
  newSkills: ExternalSkillInfo[]
}

// ============================================================================
// Skill Sync Presenter Interface
// ============================================================================

/**
 * Skill Sync Presenter interface for main process
 * Coordinates scanning, conversion, and sync operations
 */
export interface ISkillSyncPresenter {
  // Initialization
  /**
   * Initialize the sync presenter runtime and caches.
   */
  initialize(): Promise<void>

  // Scanning
  /**
   * Scan all registered external tools
   */
  scanExternalTools(): Promise<ScanResult[]>

  /**
   * Scan a specific external tool
   */
  scanTool(toolId: string): Promise<ScanResult>

  // Cache and Discovery
  /**
   * Get cached scan results
   */
  getScanCache(): Promise<ScanCache | null>

  /**
   * Run a full discovery scan and return newly discovered skills.
   */
  scanAndDetectNewDiscoveries(): Promise<NewDiscovery[]>

  /**
   * Get new discoveries (skills not in cache and not in DeepChat)
   */
  getNewDiscoveries(): Promise<NewDiscovery[]>

  /**
   * Get both scan results and new discoveries in a single call
   */
  getToolsAndDiscoveries(): Promise<{ tools: ScanResult[]; discoveries: NewDiscovery[] }>

  /**
   * Mark current discoveries as acknowledged (update cache)
   */
  acknowledgeDiscoveries(): Promise<void>

  // Import (External Tool → DeepChat)
  /**
   * Preview import operation
   */
  previewImport(toolId: string, skillNames: string[]): Promise<ImportPreview[]>

  /**
   * Execute import operation
   */
  executeImport(
    previews: ImportPreview[],
    strategies: Record<string, ConflictStrategy>
  ): Promise<SyncResult>

  // Export (DeepChat → External Tool)
  /**
   * Preview export operation
   */
  previewExport(
    skillNames: string[],
    targetToolId: string,
    options?: Record<string, unknown>
  ): Promise<ExportPreview[]>

  /**
   * Execute export operation
   */
  executeExport(
    previews: ExportPreview[],
    strategies: Record<string, ConflictStrategy>
  ): Promise<SyncResult>

  // Tool configuration
  /**
   * Get all registered external tools
   */
  getRegisteredTools(): ExternalToolConfig[]

  scanSkillAgents(): Promise<InstalledSkillAgent[]>

  scanSkillAgent(input: { agentId: string }): Promise<InstalledSkillAgentDetail>

  getAgentSkillDetail(input: { agentId: string; skillName: string }): Promise<SkillDetail>

  previewAdoptAgentSkill(input: AdoptAgentSkillInput): Promise<AdoptAgentSkillPreview>

  executeAdoptAgentSkill(input: AdoptAgentSkillInput): Promise<AdoptAgentSkillResult>

  previewLinkDeepChatSkills(input: LinkDeepChatSkillsInput): Promise<LinkDeepChatSkillsPreview>

  executeLinkDeepChatSkills(input: LinkDeepChatSkillsInput): Promise<LinkDeepChatSkillsResult>

  repairAgentSkillLink(input: AgentSkillLinkInput): Promise<LinkDeepChatSkillResult>

  removeAgentSkillLink(input: AgentSkillLinkInput): Promise<LinkDeepChatSkillResult>

  /**
   * Check if a tool's directory exists
   */
  isToolAvailable(toolId: string): Promise<boolean>
}
