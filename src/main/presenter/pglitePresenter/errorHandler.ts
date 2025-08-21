/**
 * PGlite Migration Error Handling System
 * Implements error type classification, recovery strategies, and user-friendly error messages
 * Supports requirements 2.5, 8.2, 8.4 for migration error handling and recovery
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// Error type enumeration for classification
export enum MigrationErrorType {
  INSUFFICIENT_DISK_SPACE = 'insufficient_disk_space',
  PERMISSION_DENIED = 'permission_denied',
  CORRUPTED_SOURCE_DATA = 'corrupted_source_data',
  CORRUPTED_TARGET_DATA = 'corrupted_target_data',
  SCHEMA_MISMATCH = 'schema_mismatch',
  CONNECTION_FAILED = 'connection_failed',
  TIMEOUT = 'timeout',
  DEPENDENCY_MISSING = 'dependency_missing',
  VALIDATION_FAILED = 'validation_failed',
  BACKUP_FAILED = 'backup_failed',
  ROLLBACK_FAILED = 'rollback_failed',
  UNKNOWN_ERROR = 'unknown_error'
}

// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Recovery action types
export enum RecoveryActionType {
  RETRY = 'retry',
  SKIP = 'skip',
  MANUAL_INTERVENTION = 'manual_intervention',
  ROLLBACK = 'rollback',
  ABORT = 'abort',
  IGNORE = 'ignore'
}

// Error interfaces
export interface MigrationError {
  type: MigrationErrorType
  severity: ErrorSeverity
  message: string
  details?: any
  context?: {
    phase?: string
    table?: string
    record?: any
    timestamp?: number
  }
  recoverable: boolean
  suggestedActions: RecoveryAction[]
  technicalDetails?: string
  userFriendlyMessage: string
}

export interface RecoveryAction {
  type: RecoveryActionType
  description: string
  automated: boolean
  riskLevel: 'low' | 'medium' | 'high'
  estimatedTime?: number
  prerequisites?: string[]
  execute?: () => Promise<boolean>
}

export interface ErrorHandlingResult {
  handled: boolean
  actionTaken: RecoveryActionType
  success: boolean
  message: string
  shouldContinue: boolean
  shouldRetry: boolean
}

/**
 * Migration Error Handler
 * Provides error classification, recovery strategies, and user guidance
 */
export class MigrationErrorHandler {
  private static readonly MAX_RETRY_ATTEMPTS = 3
  private static readonly RETRY_DELAY_MS = 2000

  private retryAttempts: Map<string, number> = new Map()

  /**
   * Classify and handle migration errors
   * Supports requirement 2.5 for error handling and recovery
   */
  async handleError(error: any, context?: any): Promise<ErrorHandlingResult> {
    console.log('[Migration Error Handler] Processing error:', error)

    // Classify the error
    const migrationError = await this.classifyError(error, context)

    console.log(
      `[Migration Error Handler] Classified as: ${migrationError.type} (${migrationError.severity})`
    )

    // Log the error for debugging
    this.logError(migrationError)

    // Determine recovery strategy
    const recoveryResult = await this.executeRecoveryStrategy(migrationError)

    return recoveryResult
  }

  /**
   * Classify error type and severity
   * Supports requirement 8.2 for error type classification
   */
  private async classifyError(error: any, context?: any): Promise<MigrationError> {
    const errorMessage = String(error?.message || error || 'Unknown error')
    const errno = error?.errno

    // Disk space errors
    if (errorMessage.includes('ENOSPC') || errorMessage.includes('disk space') || errno === -28) {
      return this.createDiskSpaceError(error, context)
    }

    // Permission errors
    if (errorMessage.includes('EACCES') || errorMessage.includes('permission') || errno === -13) {
      return this.createPermissionError(error, context)
    }

    // Database corruption errors
    if (
      errorMessage.includes('database disk image is malformed') ||
      errorMessage.includes('file is not a database') ||
      errorMessage.includes('database corruption')
    ) {
      return this.createCorruptionError(error, context)
    }

    // Connection errors
    if (
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('connection failed') ||
      errorMessage.includes('database is locked')
    ) {
      return this.createConnectionError(error, context)
    }

    // Schema errors
    if (
      errorMessage.includes('no such table') ||
      errorMessage.includes('no such column') ||
      errorMessage.includes('schema mismatch')
    ) {
      return this.createSchemaError(error, context)
    }

    // Timeout errors
    if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      return this.createTimeoutError(error, context)
    }

    // Validation errors
    if (
      errorMessage.includes('validation failed') ||
      errorMessage.includes('constraint violation') ||
      errorMessage.includes('foreign key')
    ) {
      return this.createValidationError(error, context)
    }

    // Backup/Rollback errors
    if (errorMessage.includes('backup failed') || context?.phase === 'backup') {
      return this.createBackupError(error, context)
    }

    if (errorMessage.includes('rollback failed') || context?.phase === 'rollback') {
      return this.createRollbackError(error, context)
    }

    // Default to unknown error
    return this.createUnknownError(error, context)
  }

  /**
   * Create disk space error with recovery actions
   */
  private createDiskSpaceError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.INSUFFICIENT_DISK_SPACE,
      severity: ErrorSeverity.HIGH,
      message: 'Insufficient disk space for migration operation',
      details: error,
      context,
      recoverable: true,
      userFriendlyMessage:
        'There is not enough free disk space to complete the migration. Please free up some space and try again.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Free up disk space by deleting unnecessary files',
          automated: false,
          riskLevel: 'low',
          estimatedTime: 300000, // 5 minutes
          prerequisites: ['User must manually free up disk space']
        },
        {
          type: RecoveryActionType.RETRY,
          description: 'Retry migration after freeing disk space',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 60000, // 1 minute
          execute: async () => {
            const hasSpace = await this.checkDiskSpace()
            return hasSpace
          }
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration and keep existing databases',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Create permission error with recovery actions
   */
  private createPermissionError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.PERMISSION_DENIED,
      severity: ErrorSeverity.HIGH,
      message: 'Permission denied accessing database files',
      details: error,
      context,
      recoverable: true,
      userFriendlyMessage:
        'The application does not have permission to access the database files. Please check file permissions or run as administrator.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Fix file permissions or run as administrator',
          automated: false,
          riskLevel: 'medium',
          estimatedTime: 180000, // 3 minutes
          prerequisites: ['Administrative access required']
        },
        {
          type: RecoveryActionType.RETRY,
          description: 'Retry migration after fixing permissions',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 30000,
          execute: async () => {
            return await this.checkFilePermissions(context?.filePath)
          }
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Create corruption error with recovery actions
   */
  private createCorruptionError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.CORRUPTED_SOURCE_DATA,
      severity: ErrorSeverity.CRITICAL,
      message: 'Database corruption detected',
      details: error,
      context,
      recoverable: false,
      userFriendlyMessage:
        'The source database appears to be corrupted. Migration cannot proceed safely. Please restore from a backup or contact support.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Restore database from backup',
          automated: false,
          riskLevel: 'high',
          estimatedTime: 600000, // 10 minutes
          prerequisites: ['Valid backup file available']
        },
        {
          type: RecoveryActionType.SKIP,
          description: 'Skip corrupted data and continue with partial migration',
          automated: true,
          riskLevel: 'high',
          estimatedTime: 60000,
          prerequisites: ['User accepts data loss risk']
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration to prevent data loss',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Create connection error with recovery actions
   */
  private createConnectionError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.CONNECTION_FAILED,
      severity: ErrorSeverity.MEDIUM,
      message: 'Database connection failed',
      details: error,
      context,
      recoverable: true,
      userFriendlyMessage:
        'Unable to connect to the database. The database may be locked by another process.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.RETRY,
          description: 'Retry connection after brief delay',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 10000,
          execute: async () => {
            await this.delay(MigrationErrorHandler.RETRY_DELAY_MS)
            return true
          }
        },
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Close other applications that might be using the database',
          automated: false,
          riskLevel: 'low',
          estimatedTime: 120000, // 2 minutes
          prerequisites: ['Close other database connections']
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Create schema error with recovery actions
   */
  private createSchemaError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.SCHEMA_MISMATCH,
      severity: ErrorSeverity.HIGH,
      message: 'Database schema mismatch',
      details: error,
      context,
      recoverable: true,
      userFriendlyMessage:
        'The database schema does not match the expected format. This may be due to an unsupported database version.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Update database to supported version',
          automated: false,
          riskLevel: 'medium',
          estimatedTime: 300000, // 5 minutes
          prerequisites: ['Database update tools available']
        },
        {
          type: RecoveryActionType.SKIP,
          description: 'Skip incompatible tables and continue',
          automated: true,
          riskLevel: 'medium',
          estimatedTime: 30000,
          prerequisites: ['User accepts partial migration']
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Create timeout error with recovery actions
   */
  private createTimeoutError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.TIMEOUT,
      severity: ErrorSeverity.MEDIUM,
      message: 'Operation timed out',
      details: error,
      context,
      recoverable: true,
      userFriendlyMessage:
        'The migration operation took too long and timed out. This may be due to a large database or slow system performance.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.RETRY,
          description: 'Retry with increased timeout',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 60000,
          execute: async () => {
            // Increase timeout for next attempt
            return true
          }
        },
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Close other applications to improve performance',
          automated: false,
          riskLevel: 'low',
          estimatedTime: 120000,
          prerequisites: ['Close resource-intensive applications']
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Create validation error with recovery actions
   */
  private createValidationError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.VALIDATION_FAILED,
      severity: ErrorSeverity.MEDIUM,
      message: 'Data validation failed',
      details: error,
      context,
      recoverable: true,
      userFriendlyMessage:
        'Some data failed validation checks during migration. This may indicate data integrity issues.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.SKIP,
          description: 'Skip invalid records and continue',
          automated: true,
          riskLevel: 'medium',
          estimatedTime: 30000,
          prerequisites: ['User accepts data loss for invalid records']
        },
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Fix data issues manually',
          automated: false,
          riskLevel: 'high',
          estimatedTime: 900000, // 15 minutes
          prerequisites: ['Database editing tools available']
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration to preserve data integrity',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Create backup error with recovery actions
   */
  private createBackupError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.BACKUP_FAILED,
      severity: ErrorSeverity.HIGH,
      message: 'Backup creation failed',
      details: error,
      context,
      recoverable: true,
      userFriendlyMessage:
        'Failed to create backup of your databases. Migration cannot proceed safely without backups.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.RETRY,
          description: 'Retry backup creation',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 120000, // 2 minutes
          execute: async () => {
            const hasSpace = await this.checkDiskSpace()
            const hasPermissions = await this.checkFilePermissions()
            return hasSpace && hasPermissions
          }
        },
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Create manual backup before proceeding',
          automated: false,
          riskLevel: 'medium',
          estimatedTime: 300000, // 5 minutes
          prerequisites: ['User creates manual backup']
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration for safety',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Create rollback error with recovery actions
   */
  private createRollbackError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.ROLLBACK_FAILED,
      severity: ErrorSeverity.CRITICAL,
      message: 'Rollback operation failed',
      details: error,
      context,
      recoverable: false,
      userFriendlyMessage:
        'Failed to rollback the migration. Your data may be in an inconsistent state. Please restore from backup immediately.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.MANUAL_INTERVENTION,
          description: 'Restore from backup immediately',
          automated: false,
          riskLevel: 'high',
          estimatedTime: 600000, // 10 minutes
          prerequisites: ['Valid backup files available', 'Administrative access']
        },
        {
          type: RecoveryActionType.RETRY,
          description: 'Retry rollback operation',
          automated: true,
          riskLevel: 'high',
          estimatedTime: 180000, // 3 minutes
          execute: async () => {
            // Check if rollback can be retried
            return await this.checkRollbackPossible(context)
          }
        }
      ]
    }
  }

  /**
   * Create unknown error with generic recovery actions
   */
  private createUnknownError(error: any, context?: any): MigrationError {
    return {
      type: MigrationErrorType.UNKNOWN_ERROR,
      severity: ErrorSeverity.MEDIUM,
      message: 'Unknown error occurred',
      details: error,
      context,
      recoverable: true,
      userFriendlyMessage:
        'An unexpected error occurred during migration. Please try again or contact support if the problem persists.',
      technicalDetails: `Error: ${error?.message || error}`,
      suggestedActions: [
        {
          type: RecoveryActionType.RETRY,
          description: 'Retry the operation',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 60000,
          execute: async () => {
            await this.delay(MigrationErrorHandler.RETRY_DELAY_MS)
            return true
          }
        },
        {
          type: RecoveryActionType.SKIP,
          description: 'Skip this operation and continue',
          automated: true,
          riskLevel: 'medium',
          estimatedTime: 10000,
          prerequisites: ['User accepts potential data loss']
        },
        {
          type: RecoveryActionType.ABORT,
          description: 'Cancel migration',
          automated: true,
          riskLevel: 'low',
          estimatedTime: 5000
        }
      ]
    }
  }

  /**
   * Execute recovery strategy based on error type
   * Supports requirement 8.2 for error recovery strategies
   */
  private async executeRecoveryStrategy(error: MigrationError): Promise<ErrorHandlingResult> {
    const errorKey = `${error.type}_${error.context?.phase || 'unknown'}`
    const currentAttempts = this.retryAttempts.get(errorKey) || 0

    // Check if we've exceeded retry attempts
    if (currentAttempts >= MigrationErrorHandler.MAX_RETRY_ATTEMPTS) {
      console.log(`[Migration Error Handler] Max retry attempts exceeded for ${error.type}`)
      return {
        handled: true,
        actionTaken: RecoveryActionType.ABORT,
        success: false,
        message: 'Maximum retry attempts exceeded. Migration aborted.',
        shouldContinue: false,
        shouldRetry: false
      }
    }

    // Find the best recovery action
    const bestAction = this.selectBestRecoveryAction(error, currentAttempts)

    if (!bestAction) {
      return {
        handled: false,
        actionTaken: RecoveryActionType.ABORT,
        success: false,
        message: 'No suitable recovery action available',
        shouldContinue: false,
        shouldRetry: false
      }
    }

    console.log(`[Migration Error Handler] Executing recovery action: ${bestAction.type}`)

    // Execute the recovery action
    try {
      let success = false
      let shouldContinue = false
      let shouldRetry = false

      switch (bestAction.type) {
        case RecoveryActionType.RETRY:
          if (bestAction.execute) {
            success = await bestAction.execute()
          } else {
            success = true // Default retry
          }
          shouldRetry = success
          this.retryAttempts.set(errorKey, currentAttempts + 1)
          break

        case RecoveryActionType.SKIP:
          success = true
          shouldContinue = true
          break

        case RecoveryActionType.IGNORE:
          success = true
          shouldContinue = true
          break

        case RecoveryActionType.MANUAL_INTERVENTION:
          // Manual intervention requires user action
          success = false
          shouldContinue = false
          break

        case RecoveryActionType.ROLLBACK:
          // Rollback will be handled by the migration manager
          success = true
          shouldContinue = false
          break

        case RecoveryActionType.ABORT:
        default:
          success = false
          shouldContinue = false
          break
      }

      return {
        handled: true,
        actionTaken: bestAction.type,
        success,
        message: bestAction.description,
        shouldContinue,
        shouldRetry
      }
    } catch (recoveryError) {
      console.error('[Migration Error Handler] Recovery action failed:', recoveryError)
      return {
        handled: true,
        actionTaken: bestAction.type,
        success: false,
        message: `Recovery action failed: ${recoveryError}`,
        shouldContinue: false,
        shouldRetry: false
      }
    }
  }

  /**
   * Select the best recovery action based on error type and context
   */
  private selectBestRecoveryAction(
    error: MigrationError,
    attemptCount: number
  ): RecoveryAction | null {
    const availableActions = error.suggestedActions

    if (availableActions.length === 0) {
      return null
    }

    // For first attempt, prefer automated actions
    if (attemptCount === 0) {
      const automatedActions = availableActions.filter((action) => action.automated)
      if (automatedActions.length > 0) {
        // Prefer retry actions first, then skip, then others
        return (
          automatedActions.find((action) => action.type === RecoveryActionType.RETRY) ||
          automatedActions.find((action) => action.type === RecoveryActionType.SKIP) ||
          automatedActions[0]
        )
      }
    }

    // For subsequent attempts, be more conservative
    if (attemptCount > 0) {
      // Prefer skip or abort actions
      return (
        availableActions.find((action) => action.type === RecoveryActionType.SKIP) ||
        availableActions.find((action) => action.type === RecoveryActionType.ABORT) ||
        availableActions[0]
      )
    }

    // Default to first available action
    return availableActions[0]
  }

  /**
   * Check available disk space
   */
  private async checkDiskSpace(): Promise<boolean> {
    try {
      const appDataDir = app.getPath('userData')
      const stats = fs.statSync(appDataDir)

      // This is a simplified check - in a real implementation,
      // you would use a library like 'check-disk-space' to get actual free space
      return stats.isDirectory() // Placeholder check
    } catch (error) {
      console.warn('[Migration Error Handler] Could not check disk space:', error)
      return false
    }
  }

  /**
   * Check file permissions
   */
  private async checkFilePermissions(filePath?: string): Promise<boolean> {
    try {
      const testPath = filePath || app.getPath('userData')
      fs.accessSync(testPath, fs.constants.R_OK | fs.constants.W_OK)
      return true
    } catch (error) {
      console.warn('[Migration Error Handler] Permission check failed:', error)
      return false
    }
  }

  /**
   * Check if rollback is possible
   */
  private async checkRollbackPossible(_context?: any): Promise<boolean> {
    try {
      // Check if backup files exist
      const appDataDir = app.getPath('userData')
      const backupDir = path.join(appDataDir, 'migration_backups')

      if (!fs.existsSync(backupDir)) {
        return false
      }

      const backupFiles = fs.readdirSync(backupDir)
      return backupFiles.length > 0
    } catch (error) {
      console.warn('[Migration Error Handler] Could not check rollback possibility:', error)
      return false
    }
  }

  /**
   * Utility method to add delay
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Log error for debugging and monitoring
   */
  private logError(error: MigrationError): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: error.type,
      severity: error.severity,
      message: error.message,
      context: error.context,
      recoverable: error.recoverable,
      technicalDetails: error.technicalDetails
    }

    console.error('[Migration Error Handler] Error logged:', JSON.stringify(logEntry, null, 2))

    // In a production environment, you might want to write this to a log file
    // or send it to a monitoring service
  }

  /**
   * Get user-friendly error message for display
   * Supports requirement 8.4 for user-friendly error messages
   */
  getUserFriendlyMessage(error: MigrationError): string {
    return error.userFriendlyMessage
  }

  /**
   * Get suggested recovery actions for user display
   */
  getRecoveryActions(error: MigrationError): RecoveryAction[] {
    return error.suggestedActions
  }

  /**
   * Reset retry attempts for a specific error type
   */
  resetRetryAttempts(errorType: MigrationErrorType, phase?: string): void {
    const errorKey = `${errorType}_${phase || 'unknown'}`
    this.retryAttempts.delete(errorKey)
  }

  /**
   * Clear all retry attempt counters
   */
  clearRetryAttempts(): void {
    this.retryAttempts.clear()
  }
}
