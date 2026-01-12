/**
 * SkillSyncPresenter Internal Types
 *
 * Internal types used by SkillSyncPresenter implementation
 */

import type { CanonicalSkill, ConflictStrategy, ExternalSkillInfo } from '@shared/types/skillSync'

/**
 * Parsed external skill with full content
 */
export interface ParsedExternalSkill {
  /** External skill info */
  info: ExternalSkillInfo
  /** Parsed canonical skill */
  skill: CanonicalSkill
  /** Raw file content */
  rawContent: string
}

/**
 * Import operation item
 */
export interface ImportItem {
  /** External skill info */
  source: ExternalSkillInfo
  /** Parsed skill */
  skill: CanonicalSkill
  /** Whether there's a conflict */
  hasConflict: boolean
  /** Conflict strategy to apply */
  strategy?: ConflictStrategy
  /** Target skill name (may be different if renamed) */
  targetName: string
}

/**
 * Export operation item
 */
export interface ExportItem {
  /** Skill name */
  skillName: string
  /** Skill content */
  skill: CanonicalSkill
  /** Target tool ID */
  targetToolId: string
  /** Target file path */
  targetPath: string
  /** Whether there's a conflict */
  hasConflict: boolean
  /** Conflict strategy to apply */
  strategy?: ConflictStrategy
}

/**
 * Skill sync operation context
 */
export interface SyncContext {
  /** Project root for project-level tools */
  projectRoot?: string
  /** Current working directory */
  cwd?: string
}
