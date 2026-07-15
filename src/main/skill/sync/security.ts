/**
 * Security Module for Skill Sync Operations
 *
 * This module provides security validations for:
 * - Path safety (symlink-aware traversal prevention)
 * - File size limits (prevent resource exhaustion)
 * - Permission checks (read/write access verification)
 * - Content validation (name sanitization, tool ID validation)
 */

import * as fs from 'fs'
import * as path from 'path'
import { ConflictStrategy, type ExternalToolConfig } from '@shared/types/skillSync'
import { EXTERNAL_TOOLS } from './toolScanner'

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum file size in bytes (10 MB)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024

/**
 * Maximum total size for skill folder (50 MB)
 */
export const MAX_SKILL_FOLDER_SIZE = 50 * 1024 * 1024

/**
 * Maximum file size for individual reference/script files (5 MB)
 */
export const MAX_SUBFOLDER_FILE_SIZE = 5 * 1024 * 1024

/**
 * Characters that are not allowed in skill names
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

// ============================================================================
// Path Security Functions
// ============================================================================

/**
 * Resolve a path with symlink resolution and containment validation.
 * Returns null if the path is unsafe or escapes the base directory.
 *
 * This follows the pattern from workspacePresenter/pathResolver.ts
 * to properly handle symlink-based directory traversal attacks.
 *
 * @param targetPath - The path to validate
 * @param baseDir - The base directory the path must be contained within
 * @returns The resolved real path if safe, null otherwise
 */
export function resolveSafePath(targetPath: string, baseDir: string): string | null {
  try {
    // Resolve the target path (handles relative paths)
    const absoluteTarget = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(baseDir, targetPath)
    const normalizedTarget = path.normalize(absoluteTarget)

    // Get real paths (resolves symlinks)
    let realPath: string
    let realBaseDir: string

    try {
      realPath = fs.realpathSync(normalizedTarget)
      realBaseDir = fs.realpathSync(baseDir)
    } catch {
      // Path doesn't exist or is inaccessible
      // For non-existent paths (e.g., export targets), check the parent
      const parentDir = path.dirname(normalizedTarget)
      try {
        const realParent = fs.realpathSync(parentDir)
        realBaseDir = fs.realpathSync(baseDir)
        // Check if parent is within base
        const baseDirWithSep = realBaseDir.endsWith(path.sep)
          ? realBaseDir
          : `${realBaseDir}${path.sep}`
        if (realParent === realBaseDir || realParent.startsWith(baseDirWithSep)) {
          return normalizedTarget // Return the normalized path for creation
        }
      } catch {
        return null
      }
      return null
    }

    // Ensure the real path is within the base directory
    const baseDirWithSep = realBaseDir.endsWith(path.sep)
      ? realBaseDir
      : `${realBaseDir}${path.sep}`

    if (realPath === realBaseDir || realPath.startsWith(baseDirWithSep)) {
      return realPath
    }

    return null
  } catch {
    return null
  }
}

/**
 * Check if a filename is safe (no path components or special characters)
 */
export function isFilenameSafe(filename: string): boolean {
  // Reject empty names
  if (!filename || filename.trim() === '') {
    return false
  }

  // Reject names with path separators
  if (filename.includes('/') || filename.includes('\\')) {
    return false
  }

  // Reject names that could traverse (., ..)
  if (filename === '.' || filename === '..') {
    return false
  }

  // Reject names with null bytes or control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(filename)) {
    return false
  }

  return true
}

/**
 * Check if a directory is safely within the expected base path.
 * Uses symlink-aware path resolution.
 */
export function isPathWithinBase(targetPath: string, baseDir: string): boolean {
  return resolveSafePath(targetPath, baseDir) !== null
}

// ============================================================================
// File Size Validation
// ============================================================================

/**
 * Validate file size before reading
 *
 * @param filePath - Path to the file
 * @param maxSize - Maximum allowed size in bytes
 * @returns Object with valid status and file size
 */
export async function validateFileSize(
  filePath: string,
  maxSize: number = MAX_FILE_SIZE
): Promise<{ valid: boolean; size: number; error?: string }> {
  try {
    const stats = await fs.promises.stat(filePath)

    if (!stats.isFile()) {
      return { valid: false, size: 0, error: 'Not a file' }
    }

    if (stats.size > maxSize) {
      return {
        valid: false,
        size: stats.size,
        error: `File too large: ${stats.size} bytes exceeds limit of ${maxSize} bytes`
      }
    }

    return { valid: true, size: stats.size }
  } catch (error) {
    return {
      valid: false,
      size: 0,
      error: error instanceof Error ? error.message : 'Failed to stat file'
    }
  }
}

/**
 * Validate total folder size before importing
 *
 * @param folderPath - Path to the folder
 * @param maxSize - Maximum allowed total size
 * @returns Object with valid status and total size
 */
export async function validateFolderSize(
  folderPath: string,
  maxSize: number = MAX_SKILL_FOLDER_SIZE
): Promise<{ valid: boolean; totalSize: number; error?: string }> {
  let totalSize = 0

  async function calculateSize(dirPath: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)

        if (entry.isFile()) {
          const stats = await fs.promises.stat(fullPath)
          totalSize += stats.size

          // Early exit if already over limit
          if (totalSize > maxSize) {
            throw new Error('Size limit exceeded')
          }
        } else if (entry.isDirectory()) {
          await calculateSize(fullPath)
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Size limit exceeded') {
        throw error
      }
      // Ignore other errors (permission issues, etc.)
    }
  }

  try {
    await calculateSize(folderPath)
    return { valid: true, totalSize }
  } catch (error) {
    if (error instanceof Error && error.message === 'Size limit exceeded') {
      return {
        valid: false,
        totalSize,
        error: `Folder too large: exceeds limit of ${maxSize} bytes`
      }
    }
    return { valid: true, totalSize }
  }
}

// ============================================================================
// Permission Checks
// ============================================================================

/**
 * Check read permission for a path
 */
export async function checkReadPermission(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Check write permission for a path (or its nearest existing ancestor)
 */
export async function checkWritePermission(targetPath: string): Promise<boolean> {
  try {
    // Try to check the path itself
    await fs.promises.access(targetPath, fs.constants.W_OK)
    return true
  } catch {
    // If path doesn't exist, recursively check parent directories
    // until we find one that exists
    let currentDir = path.dirname(targetPath)
    const root = path.parse(currentDir).root

    while (currentDir !== root) {
      try {
        // Check if directory exists
        const stats = await fs.promises.stat(currentDir)
        if (stats.isDirectory()) {
          // Directory exists, check write permission
          await fs.promises.access(currentDir, fs.constants.W_OK)
          return true
        }
      } catch {
        // Directory doesn't exist, go up one level
        currentDir = path.dirname(currentDir)
        continue
      }
      // If we reach here, stat succeeded but access failed
      return false
    }

    // Reached filesystem root without finding writable directory
    return false
  }
}

/**
 * Check if a directory exists and is accessible
 */
export async function isDirectoryAccessible(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(dirPath)
    if (!stats.isDirectory()) {
      return false
    }
    await fs.promises.access(dirPath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate tool ID against registered tools
 */
export function isValidToolId(toolId: string): boolean {
  return EXTERNAL_TOOLS.some((t) => t.id === toolId)
}

/**
 * Get a validated tool configuration
 */
export function getValidatedTool(toolId: string): ExternalToolConfig | null {
  if (!toolId || typeof toolId !== 'string') {
    return null
  }
  return EXTERNAL_TOOLS.find((t) => t.id === toolId) || null
}

/**
 * Validate conflict strategy value
 */
export function isValidConflictStrategy(strategy: unknown): strategy is ConflictStrategy {
  return (
    strategy === ConflictStrategy.SKIP ||
    strategy === ConflictStrategy.OVERWRITE ||
    strategy === ConflictStrategy.RENAME
  )
}

/**
 * Sanitize a skill name for safe use in file paths
 * Returns a safe version of the name, or null if it can't be sanitized
 */
export function sanitizeSkillName(name: string): string | null {
  if (!name || typeof name !== 'string') {
    return null
  }

  // Trim whitespace
  let sanitized = name.trim()

  // Return null for empty names
  if (!sanitized) {
    return null
  }

  // Remove unsafe characters
  sanitized = sanitized.replace(UNSAFE_NAME_CHARS, '-')

  // Replace multiple consecutive hyphens with single hyphen
  sanitized = sanitized.replace(/-+/g, '-')

  // Remove leading/trailing hyphens
  sanitized = sanitized.replace(/^-+|-+$/g, '')

  // Return null if result is empty or just dots
  if (!sanitized || /^\.+$/.test(sanitized)) {
    return null
  }

  // Limit length
  if (sanitized.length > 100) {
    sanitized = sanitized.slice(0, 100)
  }

  return sanitized
}

/**
 * Validate that a skill name is safe for use
 */
export function isValidSkillName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false
  }

  const trimmed = name.trim()

  // Check length
  if (trimmed.length === 0 || trimmed.length > 100) {
    return false
  }

  // Check for path components
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return false
  }

  // Check for reserved names
  if (trimmed === '.' || trimmed === '..') {
    return false
  }

  // Check for control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) {
    return false
  }

  return true
}

// ============================================================================
// Content Validation
// ============================================================================

/**
 * Validate file content encoding (UTF-8 check)
 */
export function isValidUtf8(content: string): boolean {
  try {
    // Check for replacement character which indicates encoding issues
    return !content.includes('\uFFFD')
  } catch {
    return false
  }
}

/**
 * Check if content contains BOM (Byte Order Mark)
 */
export function hasBOM(content: string): boolean {
  return content.charCodeAt(0) === 0xfeff
}

/**
 * Remove BOM from content if present
 */
export function stripBOM(content: string): string {
  if (hasBOM(content)) {
    return content.slice(1)
  }
  return content
}

// ============================================================================
// Security Result Types
// ============================================================================

export interface SecurityCheckResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Perform comprehensive security validation for an import operation
 */
export async function validateImportOperation(
  sourcePath: string,
  toolId: string,
  skillName: string,
  baseDir: string
): Promise<SecurityCheckResult> {
  const result: SecurityCheckResult = {
    valid: true,
    errors: [],
    warnings: []
  }

  // 1. Validate tool ID
  if (!isValidToolId(toolId)) {
    result.valid = false
    result.errors.push(`Invalid tool ID: ${toolId}`)
  }

  // 2. Validate skill name
  if (!isValidSkillName(skillName)) {
    result.valid = false
    result.errors.push(`Invalid skill name: ${skillName}`)
  }

  // 3. Validate source path is within expected base
  if (!isPathWithinBase(sourcePath, baseDir)) {
    result.valid = false
    result.errors.push(`Source path escapes allowed directory: ${sourcePath}`)
  }

  // 4. Check read permission
  if (!(await checkReadPermission(sourcePath))) {
    result.valid = false
    result.errors.push(`No read permission for: ${sourcePath}`)
  }

  // 5. Check file size
  try {
    const stats = await fs.promises.stat(sourcePath)
    if (stats.isFile()) {
      const sizeResult = await validateFileSize(sourcePath)
      if (!sizeResult.valid) {
        result.valid = false
        result.errors.push(sizeResult.error || 'File too large')
      }
    } else if (stats.isDirectory()) {
      const folderResult = await validateFolderSize(sourcePath)
      if (!folderResult.valid) {
        result.valid = false
        result.errors.push(folderResult.error || 'Folder too large')
      }
    }
  } catch (error) {
    result.valid = false
    result.errors.push(
      `Cannot access source: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  return result
}

/**
 * Perform comprehensive security validation for an export operation
 */
export async function validateExportOperation(
  targetPath: string,
  toolId: string,
  skillName: string,
  baseDir: string
): Promise<SecurityCheckResult> {
  const result: SecurityCheckResult = {
    valid: true,
    errors: [],
    warnings: []
  }

  // 1. Validate tool ID
  if (!isValidToolId(toolId)) {
    result.valid = false
    result.errors.push(`Invalid tool ID: ${toolId}`)
  }

  // 2. Validate skill name
  if (!isValidSkillName(skillName)) {
    result.valid = false
    result.errors.push(`Invalid skill name: ${skillName}`)
  }

  // 3. Validate target path is within expected base
  if (!isPathWithinBase(targetPath, baseDir)) {
    result.valid = false
    result.errors.push(`Target path escapes allowed directory: ${targetPath}`)
  }

  // 4. Check write permission for target or its parent
  if (!(await checkWritePermission(targetPath))) {
    result.valid = false
    result.errors.push(`No write permission for: ${targetPath}`)
  }

  return result
}
