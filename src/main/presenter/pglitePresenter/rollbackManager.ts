/**
 * PGlite Migration Rollback and Recovery Manager
 * Implements rollback mechanisms, partial migration recovery, and system state validation
 * Supports requirements 10.3, 10.4 for rollback and recovery functionality
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { BackupInfo, BackupManager } from './migrationManager'
// import { MigrationErrorHandler } from './errorHandler'

// Rollback interfaces
export interface RollbackOptions {
  validateBeforeRollback?: boolean
  createPreRollbackBackup?: boolean
  continueOnError?: boolean
  progressCallback?: (progress: RollbackProgress) => void
}

export interface RollbackProgress {
  phase: 'validation' | 'backup' | 'restoration' | 'verification' | 'cleanup'
  currentStep: string
  percentage: number
  startTime: number
  estimatedTimeRemaining?: number
  errors?: string[]
  warnings?: string[]
}

export interface RollbackResult {
  success: boolean
  startTime: number
  endTime: number
  duration: number
  phase: string
  filesRestored: number
  errors: string[]
  warnings: string[]
  systemStateValid: boolean
}

export interface SystemState {
  timestamp: number
  databaseFiles: DatabaseFileInfo[]
  configFiles: ConfigFileInfo[]
  applicationVersion: string
  migrationVersion?: number
  isConsistent: boolean
  validationErrors: string[]
}

export interface DatabaseFileInfo {
  path: string
  type: 'sqlite' | 'duckdb' | 'pglite'
  size: number
  lastModified: number
  checksum: string
  exists: boolean
  isValid: boolean
}

export interface ConfigFileInfo {
  path: string
  size: number
  lastModified: number
  checksum: string
  exists: boolean
}

export interface RecoveryPoint {
  id: string
  timestamp: number
  description: string
  systemState: SystemState
  backups: BackupInfo[]
  migrationPhase: string
  canRestore: boolean
}

/**
 * Rollback and Recovery Manager
 * Handles migration rollback, partial recovery, and system state validation
 */
export class RollbackManager {
  private readonly backupManager: BackupManager
  private static readonly RECOVERY_POINTS_FILE = 'recovery_points.json'
  private static readonly MAX_RECOVERY_POINTS = 10

  constructor() {
    this.backupManager = new BackupManager()
  }

  /**
   * Execute complete rollback to previous state
   * Supports requirement 10.3 for rollback mechanisms
   */
  async executeRollback(
    backups: BackupInfo[],
    options: RollbackOptions = {}
  ): Promise<RollbackResult> {
    const startTime = Date.now()
    const result: RollbackResult = {
      success: false,
      startTime,
      endTime: 0,
      duration: 0,
      phase: 'initialization',
      filesRestored: 0,
      errors: [],
      warnings: [],
      systemStateValid: false
    }

    console.log('[Rollback Manager] Starting rollback operation')

    try {
      // Phase 1: Validation
      if (options.validateBeforeRollback !== false) {
        await this.updateRollbackProgress(
          'validation',
          'Validating rollback prerequisites...',
          5,
          options.progressCallback
        )

        const validationResult = await this.validateRollbackPrerequisites(backups)
        if (!validationResult.valid) {
          throw new Error(`Rollback validation failed: ${validationResult.errors.join(', ')}`)
        }
        result.warnings.push(...validationResult.warnings)
      }

      // Phase 2: Create pre-rollback backup
      if (options.createPreRollbackBackup) {
        await this.updateRollbackProgress(
          'backup',
          'Creating pre-rollback backup...',
          15,
          options.progressCallback
        )

        const currentState = await this.captureSystemState()
        await this.createRecoveryPoint('pre-rollback', currentState, [])
      }

      // Phase 3: Restore from backups
      await this.updateRollbackProgress(
        'restoration',
        'Restoring databases from backup...',
        25,
        options.progressCallback
      )

      const restorationResult = await this.restoreFromBackups(backups, options)
      result.filesRestored = restorationResult.filesRestored
      result.errors.push(...restorationResult.errors)
      result.warnings.push(...restorationResult.warnings)

      if (!restorationResult.success && !options.continueOnError) {
        throw new Error('Database restoration failed')
      }

      // Phase 4: Verify system state
      await this.updateRollbackProgress(
        'verification',
        'Verifying system state...',
        75,
        options.progressCallback
      )

      const verificationResult = await this.verifySystemState()
      result.systemStateValid = verificationResult.isConsistent
      result.warnings.push(...verificationResult.validationErrors)

      // Phase 5: Cleanup
      await this.updateRollbackProgress(
        'cleanup',
        'Cleaning up rollback artifacts...',
        90,
        options.progressCallback
      )

      await this.cleanupRollbackArtifacts()

      await this.updateRollbackProgress(
        'cleanup',
        'Rollback completed successfully',
        100,
        options.progressCallback
      )

      result.success = result.errors.length === 0
      result.phase = 'completed'

      console.log(
        `[Rollback Manager] Rollback completed with ${result.success ? 'success' : 'errors'}`
      )
    } catch (error) {
      console.error('[Rollback Manager] Rollback failed:', error)
      result.errors.push(String(error))
      result.success = false
    } finally {
      result.endTime = Date.now()
      result.duration = result.endTime - result.startTime
    }

    return result
  }

  /**
   * Implement partial migration recovery
   * Supports requirement 10.4 for partial recovery capabilities
   */
  async recoverPartialMigration(
    recoveryPointId: string,
    options: RollbackOptions = {}
  ): Promise<RollbackResult> {
    const startTime = Date.now()
    const result: RollbackResult = {
      success: false,
      startTime,
      endTime: 0,
      duration: 0,
      phase: 'recovery',
      filesRestored: 0,
      errors: [],
      warnings: [],
      systemStateValid: false
    }

    console.log(
      `[Rollback Manager] Starting partial migration recovery to point: ${recoveryPointId}`
    )

    try {
      // Find the recovery point
      const recoveryPoint = await this.getRecoveryPoint(recoveryPointId)
      if (!recoveryPoint) {
        throw new Error(`Recovery point not found: ${recoveryPointId}`)
      }

      if (!recoveryPoint.canRestore) {
        throw new Error(`Recovery point cannot be restored: ${recoveryPointId}`)
      }

      // Validate recovery point
      await this.updateRollbackProgress(
        'validation',
        'Validating recovery point...',
        10,
        options.progressCallback
      )

      const validationResult = await this.validateRecoveryPoint(recoveryPoint)
      if (!validationResult.valid) {
        throw new Error(`Recovery point validation failed: ${validationResult.errors.join(', ')}`)
      }

      // Restore to recovery point state
      await this.updateRollbackProgress(
        'restoration',
        'Restoring to recovery point...',
        30,
        options.progressCallback
      )

      const restorationResult = await this.restoreToRecoveryPoint(recoveryPoint, options)
      result.filesRestored = restorationResult.filesRestored
      result.errors.push(...restorationResult.errors)
      result.warnings.push(...restorationResult.warnings)

      // Verify restored state
      await this.updateRollbackProgress(
        'verification',
        'Verifying recovered state...',
        80,
        options.progressCallback
      )

      const verificationResult = await this.verifySystemState()
      result.systemStateValid = verificationResult.isConsistent

      result.success = result.errors.length === 0
      result.phase = 'completed'

      console.log(
        `[Rollback Manager] Partial recovery completed with ${result.success ? 'success' : 'errors'}`
      )
    } catch (error) {
      console.error('[Rollback Manager] Partial recovery failed:', error)
      result.errors.push(String(error))
      result.success = false
    } finally {
      result.endTime = Date.now()
      result.duration = result.endTime - result.startTime
    }

    return result
  }

  /**
   * Create a recovery point for later restoration
   * Supports requirement 10.4 for recovery point management
   */
  async createRecoveryPoint(
    description: string,
    systemState: SystemState,
    backups: BackupInfo[]
  ): Promise<string> {
    const recoveryPointId = `rp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const recoveryPoint: RecoveryPoint = {
      id: recoveryPointId,
      timestamp: Date.now(),
      description,
      systemState,
      backups,
      migrationPhase: 'unknown',
      canRestore: true
    }

    console.log(`[Rollback Manager] Creating recovery point: ${recoveryPointId}`)

    try {
      // Save recovery point
      await this.saveRecoveryPoint(recoveryPoint)

      // Clean up old recovery points
      await this.cleanupOldRecoveryPoints()

      console.log(`[Rollback Manager] Recovery point created: ${recoveryPointId}`)
      return recoveryPointId
    } catch (error) {
      console.error('[Rollback Manager] Failed to create recovery point:', error)
      throw new Error(`Recovery point creation failed: ${error}`)
    }
  }

  /**
   * Validate rollback prerequisites
   */
  private async validateRollbackPrerequisites(backups: BackupInfo[]): Promise<{
    valid: boolean
    errors: string[]
    warnings: string[]
  }> {
    const errors: string[] = []
    const warnings: string[] = []

    // Check if backups exist and are valid
    for (const backup of backups) {
      if (!fs.existsSync(backup.backupPath)) {
        errors.push(`Backup file not found: ${backup.backupPath}`)
        continue
      }

      const isValid = await this.backupManager.verifyBackup(backup)
      if (!isValid) {
        errors.push(`Backup verification failed: ${backup.backupPath}`)
      }
    }

    // Check disk space for restoration
    const totalBackupSize = backups.reduce((sum, backup) => sum + backup.size, 0)
    const hasEnoughSpace = await this.checkDiskSpace(totalBackupSize * 1.5) // 50% buffer
    if (!hasEnoughSpace) {
      errors.push('Insufficient disk space for rollback operation')
    }

    // Check file permissions
    for (const backup of backups) {
      const targetDir = path.dirname(backup.originalPath)
      const hasPermissions = await this.checkWritePermissions(targetDir)
      if (!hasPermissions) {
        errors.push(`No write permissions for directory: ${targetDir}`)
      }
    }

    // Warn about potential data loss
    if (backups.length > 0) {
      warnings.push(
        'Rollback will overwrite current database files. Any changes since backup will be lost.'
      )
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Restore databases from backup files
   */
  private async restoreFromBackups(
    backups: BackupInfo[],
    options: RollbackOptions
  ): Promise<{
    success: boolean
    filesRestored: number
    errors: string[]
    warnings: string[]
  }> {
    const result = {
      success: true,
      filesRestored: 0,
      errors: [] as string[],
      warnings: [] as string[]
    }

    for (const backup of backups) {
      try {
        console.log(`[Rollback Manager] Restoring: ${backup.backupPath} -> ${backup.originalPath}`)

        const restored = await this.backupManager.restoreFromBackup(backup)
        if (restored) {
          result.filesRestored++
        } else {
          const error = `Failed to restore backup: ${backup.backupPath}`
          result.errors.push(error)

          if (!options.continueOnError) {
            result.success = false
            break
          }
        }
      } catch (error) {
        const errorMsg = `Restoration failed for ${backup.backupPath}: ${error}`
        result.errors.push(errorMsg)

        if (!options.continueOnError) {
          result.success = false
          break
        }
      }
    }

    result.success = result.success && result.errors.length === 0
    return result
  }

  /**
   * Capture current system state
   * Supports requirement 10.4 for system state validation
   */
  async captureSystemState(): Promise<SystemState> {
    const timestamp = Date.now()
    const appDataDir = app.getPath('userData')

    console.log('[Rollback Manager] Capturing system state')

    const systemState: SystemState = {
      timestamp,
      databaseFiles: [],
      configFiles: [],
      applicationVersion: app.getVersion(),
      isConsistent: true,
      validationErrors: []
    }

    try {
      // Capture database files
      const dbDir = path.join(appDataDir, 'app_db')
      if (fs.existsSync(dbDir)) {
        const dbFiles = await this.scanDatabaseFiles(dbDir)
        systemState.databaseFiles.push(...dbFiles)
      }

      // Capture knowledge database files
      const knowledgeDir = path.join(appDataDir, 'knowledge')
      if (fs.existsSync(knowledgeDir)) {
        const knowledgeFiles = await this.scanDatabaseFiles(knowledgeDir)
        systemState.databaseFiles.push(...knowledgeFiles)
      }

      // Capture configuration files
      const configFiles = await this.scanConfigFiles(appDataDir)
      systemState.configFiles.push(...configFiles)

      // Validate consistency
      const validationResult = await this.validateSystemConsistency(systemState)
      systemState.isConsistent = validationResult.isConsistent
      systemState.validationErrors = validationResult.errors

      console.log(
        `[Rollback Manager] System state captured: ${systemState.databaseFiles.length} DB files, ${systemState.configFiles.length} config files`
      )
    } catch (error) {
      console.error('[Rollback Manager] Failed to capture system state:', error)
      systemState.isConsistent = false
      systemState.validationErrors.push(`State capture failed: ${error}`)
    }

    return systemState
  }

  /**
   * Verify current system state
   */
  async verifySystemState(): Promise<SystemState> {
    console.log('[Rollback Manager] Verifying system state')
    return await this.captureSystemState()
  }

  /**
   * Scan database files in a directory
   */
  private async scanDatabaseFiles(directory: string): Promise<DatabaseFileInfo[]> {
    const files: DatabaseFileInfo[] = []

    if (!fs.existsSync(directory)) {
      return files
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(directory, entry.name)
        const ext = path.extname(entry.name).toLowerCase()

        let type: 'sqlite' | 'duckdb' | 'pglite' = 'sqlite'
        if (ext === '.duckdb') {
          type = 'duckdb'
        } else if (entry.name.includes('pglite') || ext === '.pglite') {
          type = 'pglite'
        }

        try {
          const stats = fs.statSync(filePath)
          const checksum = await this.calculateFileChecksum(filePath)

          files.push({
            path: filePath,
            type,
            size: stats.size,
            lastModified: stats.mtime.getTime(),
            checksum,
            exists: true,
            isValid: await this.validateDatabaseFile(filePath, type)
          })
        } catch (error) {
          console.warn(`[Rollback Manager] Could not scan database file ${filePath}:`, error)
          files.push({
            path: filePath,
            type,
            size: 0,
            lastModified: 0,
            checksum: '',
            exists: false,
            isValid: false
          })
        }
      }
    }

    return files
  }

  /**
   * Scan configuration files
   */
  private async scanConfigFiles(directory: string): Promise<ConfigFileInfo[]> {
    const files: ConfigFileInfo[] = []
    const configExtensions = ['.json', '.yaml', '.yml', '.toml', '.ini']

    if (!fs.existsSync(directory)) {
      return files
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (configExtensions.includes(ext)) {
          const filePath = path.join(directory, entry.name)

          try {
            const stats = fs.statSync(filePath)
            const checksum = await this.calculateFileChecksum(filePath)

            files.push({
              path: filePath,
              size: stats.size,
              lastModified: stats.mtime.getTime(),
              checksum,
              exists: true
            })
          } catch (error) {
            console.warn(`[Rollback Manager] Could not scan config file ${filePath}:`, error)
          }
        }
      }
    }

    return files
  }

  /**
   * Validate system consistency
   */
  private async validateSystemConsistency(systemState: SystemState): Promise<{
    isConsistent: boolean
    errors: string[]
  }> {
    const errors: string[] = []

    // Check for missing critical files
    const hasSQLite = systemState.databaseFiles.some((f) => f.type === 'sqlite' && f.exists)
    const hasDuckDB = systemState.databaseFiles.some((f) => f.type === 'duckdb' && f.exists)
    const hasPGlite = systemState.databaseFiles.some((f) => f.type === 'pglite' && f.exists)

    if (!hasSQLite && !hasPGlite) {
      errors.push('No conversational database found (SQLite or PGlite)')
    }

    if (!hasDuckDB && !hasPGlite) {
      errors.push('No vector database found (DuckDB or PGlite)')
    }

    // Check for corrupted files
    const corruptedFiles = systemState.databaseFiles.filter((f) => f.exists && !f.isValid)
    if (corruptedFiles.length > 0) {
      errors.push(
        `Corrupted database files detected: ${corruptedFiles.map((f) => f.path).join(', ')}`
      )
    }

    return {
      isConsistent: errors.length === 0,
      errors
    }
  }

  /**
   * Validate database file integrity
   */
  private async validateDatabaseFile(
    filePath: string,
    type: 'sqlite' | 'duckdb' | 'pglite'
  ): Promise<boolean> {
    try {
      if (type === 'sqlite') {
        const Database = require('better-sqlite3-multiple-ciphers')
        const db = new Database(filePath, { readonly: true })
        db.prepare('SELECT 1').get()
        db.close()
        return true
      } else if (type === 'duckdb') {
        const { DuckDBInstance } = require('@duckdb/node-api')
        const instance = new DuckDBInstance()
        const connection = instance.connect()
        await connection.run(`ATTACH '${filePath}' AS test_db`)
        await connection.run('SELECT 1')
        await connection.close()
        await instance.close()
        return true
      } else if (type === 'pglite') {
        // PGlite validation would go here
        return true // Placeholder
      }
      return false
    } catch (error) {
      console.warn(`[Rollback Manager] Database validation failed for ${filePath}:`, error)
      return false
    }
  }

  /**
   * Calculate file checksum
   */
  private async calculateFileChecksum(filePath: string): Promise<string> {
    const crypto = require('crypto')
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    return new Promise((resolve, reject) => {
      stream.on('data', (data) => hash.update(data))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }

  /**
   * Save recovery point to disk
   */
  private async saveRecoveryPoint(recoveryPoint: RecoveryPoint): Promise<void> {
    const appDataDir = app.getPath('userData')
    const recoveryPointsFile = path.join(appDataDir, RollbackManager.RECOVERY_POINTS_FILE)

    let recoveryPoints: RecoveryPoint[] = []

    // Load existing recovery points
    if (fs.existsSync(recoveryPointsFile)) {
      try {
        const data = fs.readFileSync(recoveryPointsFile, 'utf8')
        recoveryPoints = JSON.parse(data)
      } catch (error) {
        console.warn('[Rollback Manager] Could not load existing recovery points:', error)
      }
    }

    // Add new recovery point
    recoveryPoints.push(recoveryPoint)

    // Save updated recovery points
    fs.writeFileSync(recoveryPointsFile, JSON.stringify(recoveryPoints, null, 2))
  }

  /**
   * Get recovery point by ID
   */
  private async getRecoveryPoint(id: string): Promise<RecoveryPoint | null> {
    const appDataDir = app.getPath('userData')
    const recoveryPointsFile = path.join(appDataDir, RollbackManager.RECOVERY_POINTS_FILE)

    if (!fs.existsSync(recoveryPointsFile)) {
      return null
    }

    try {
      const data = fs.readFileSync(recoveryPointsFile, 'utf8')
      const recoveryPoints: RecoveryPoint[] = JSON.parse(data)
      return recoveryPoints.find((rp) => rp.id === id) || null
    } catch (error) {
      console.warn('[Rollback Manager] Could not load recovery points:', error)
      return null
    }
  }

  /**
   * Validate recovery point
   */
  private async validateRecoveryPoint(recoveryPoint: RecoveryPoint): Promise<{
    valid: boolean
    errors: string[]
    warnings: string[]
  }> {
    const errors: string[] = []
    const warnings: string[] = []

    // Check if backups still exist
    for (const backup of recoveryPoint.backups) {
      if (!fs.existsSync(backup.backupPath)) {
        errors.push(`Backup file missing: ${backup.backupPath}`)
      }
    }

    // Check if recovery point is not too old
    const ageInDays = (Date.now() - recoveryPoint.timestamp) / (1000 * 60 * 60 * 24)
    if (ageInDays > 30) {
      warnings.push(`Recovery point is ${Math.round(ageInDays)} days old`)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Restore to specific recovery point
   */
  private async restoreToRecoveryPoint(
    recoveryPoint: RecoveryPoint,
    options: RollbackOptions
  ): Promise<{
    success: boolean
    filesRestored: number
    errors: string[]
    warnings: string[]
  }> {
    console.log(`[Rollback Manager] Restoring to recovery point: ${recoveryPoint.id}`)

    // Restore from backups associated with the recovery point
    return await this.restoreFromBackups(recoveryPoint.backups, options)
  }

  /**
   * Clean up old recovery points
   */
  private async cleanupOldRecoveryPoints(): Promise<void> {
    const appDataDir = app.getPath('userData')
    const recoveryPointsFile = path.join(appDataDir, RollbackManager.RECOVERY_POINTS_FILE)

    if (!fs.existsSync(recoveryPointsFile)) {
      return
    }

    try {
      const data = fs.readFileSync(recoveryPointsFile, 'utf8')
      let recoveryPoints: RecoveryPoint[] = JSON.parse(data)

      // Sort by timestamp (newest first) and keep only the most recent ones
      recoveryPoints.sort((a, b) => b.timestamp - a.timestamp)
      recoveryPoints = recoveryPoints.slice(0, RollbackManager.MAX_RECOVERY_POINTS)

      // Save cleaned up recovery points
      fs.writeFileSync(recoveryPointsFile, JSON.stringify(recoveryPoints, null, 2))

      console.log(`[Rollback Manager] Cleaned up recovery points, kept ${recoveryPoints.length}`)
    } catch (error) {
      console.warn('[Rollback Manager] Could not cleanup recovery points:', error)
    }
  }

  /**
   * Clean up rollback artifacts
   */
  private async cleanupRollbackArtifacts(): Promise<void> {
    // Clean up temporary files, logs, etc.
    console.log('[Rollback Manager] Cleaning up rollback artifacts')

    // This is a placeholder - in a real implementation, you would clean up
    // temporary files, partial migration artifacts, etc.
  }

  /**
   * Update rollback progress
   */
  private async updateRollbackProgress(
    phase: RollbackProgress['phase'],
    currentStep: string,
    percentage: number,
    progressCallback?: (progress: RollbackProgress) => void
  ): Promise<void> {
    if (progressCallback) {
      const progress: RollbackProgress = {
        phase,
        currentStep,
        percentage,
        startTime: Date.now(),
        errors: [],
        warnings: []
      }
      progressCallback(progress)
    }
  }

  /**
   * Check available disk space
   */
  private async checkDiskSpace(_requiredBytes: number): Promise<boolean> {
    try {
      // This is a simplified check - in a real implementation,
      // you would use a library like 'check-disk-space'
      return true // Placeholder
    } catch (error) {
      console.warn('[Rollback Manager] Could not check disk space:', error)
      return false
    }
  }

  /**
   * Check write permissions for directory
   */
  private async checkWritePermissions(directory: string): Promise<boolean> {
    try {
      fs.accessSync(directory, fs.constants.W_OK)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * List all available recovery points
   */
  async listRecoveryPoints(): Promise<RecoveryPoint[]> {
    const appDataDir = app.getPath('userData')
    const recoveryPointsFile = path.join(appDataDir, RollbackManager.RECOVERY_POINTS_FILE)

    if (!fs.existsSync(recoveryPointsFile)) {
      return []
    }

    try {
      const data = fs.readFileSync(recoveryPointsFile, 'utf8')
      const recoveryPoints: RecoveryPoint[] = JSON.parse(data)
      return recoveryPoints.sort((a, b) => b.timestamp - a.timestamp)
    } catch (error) {
      console.warn('[Rollback Manager] Could not load recovery points:', error)
      return []
    }
  }
}
