/**
 * Migration Presenter
 * Handles migration detection and orchestration during application startup
 * Implements requirements 6.1, 7.1 for startup migration detection and automatic triggering
 */

import { ipcMain, BrowserWindow } from 'electron'
import { MigrationManager, LegacyDatabaseInfo } from '../pglitePresenter/migrationManager'
import { ApplicationStateManager } from './applicationStateManager'
import { eventBus } from '@/eventbus'
import { MIGRATION_EVENTS } from '@/events'

export interface MigrationDetectionResult {
  requiresMigration: boolean
  databases: LegacyDatabaseInfo[]
  estimatedDuration: number
  diskSpaceRequired: number
  compatibility: {
    compatible: boolean
    issues: string[]
    warnings: string[]
  }
}

export interface MigrationStartupOptions {
  bypassForTesting?: boolean
  dryRun?: boolean
  autoStart?: boolean
}

/**
 * Migration Presenter for handling startup migration detection and user interaction
 * Supports requirements 6.1, 7.1 for migration detection and automatic triggering
 */
export class MigrationPresenter {
  private migrationManager: MigrationManager
  private applicationStateManager: ApplicationStateManager
  private migrationInProgress: boolean = false
  private migrationDetected: boolean = false
  private startupOptions: MigrationStartupOptions = {}

  constructor() {
    this.migrationManager = new MigrationManager()
    this.applicationStateManager = new ApplicationStateManager()
    this.setupIpcHandlers()
  }

  /**
   * Initialize migration presenter and check for startup migration
   * Supports requirement 6.1 for startup migration detection
   */
  async initialize(options: MigrationStartupOptions = {}): Promise<void> {
    console.log('[Migration Presenter] Initializing migration system')

    this.startupOptions = options

    // Skip migration detection if bypassed for testing
    if (options.bypassForTesting) {
      console.log('[Migration Presenter] Migration detection bypassed for testing')
      return
    }

    try {
      // Check if migration is required
      const isRequired = await this.migrationManager.isMigrationRequired()

      if (isRequired) {
        console.log('[Migration Presenter] Legacy databases detected, migration required')
        this.migrationDetected = true

        // Get detailed migration requirements
        const requirements = await this.migrationManager.getMigrationRequirements()

        // Notify renderer process about migration detection
        await this.notifyMigrationDetected(requirements)

        // Auto-start migration if configured
        if (options.autoStart) {
          console.log('[Migration Presenter] Auto-starting migration')
          await this.startMigration()
        }
      } else {
        console.log('[Migration Presenter] No legacy databases found, migration not required')
      }
    } catch (error) {
      console.error('[Migration Presenter] Failed to initialize migration system:', error)
      // Don't throw error to prevent app startup failure
    }
  }

  /**
   * Check if migration is currently required
   * Supports requirement 6.1 for legacy database detection
   */
  async isMigrationRequired(): Promise<boolean> {
    try {
      return await this.migrationManager.isMigrationRequired()
    } catch (error) {
      console.error('[Migration Presenter] Failed to check migration requirement:', error)
      return false
    }
  }

  /**
   * Get migration detection status
   */
  getMigrationStatus(): {
    detected: boolean
    inProgress: boolean
    canBypass: boolean
  } {
    return {
      detected: this.migrationDetected,
      inProgress: this.migrationInProgress,
      canBypass: this.startupOptions.bypassForTesting || false
    }
  }

  /**
   * Start the migration process
   * Supports requirement 7.1 for automatic migration triggering
   */
  async startMigration(): Promise<void> {
    if (this.migrationInProgress) {
      throw new Error('Migration is already in progress')
    }

    console.log('[Migration Presenter] Starting migration process')
    this.migrationInProgress = true

    try {
      // Set application state to migration in progress
      this.applicationStateManager.setMigrationInProgress(true, 'initializing', {
        blockDataAccess: true,
        blockUserInterface: false, // Let user see progress
        showProgressDialog: true,
        allowCancel: true
      })

      // Notify renderer that migration has started
      this.notifyMigrationStarted()

      // Execute migration with progress callbacks
      const result = await this.migrationManager.executeMigration({
        createBackups: true,
        validateData: true,
        dryRun: this.startupOptions.dryRun,
        progressCallback: (progress) => {
          // Update application state with progress
          this.applicationStateManager.updateMigrationProgress(
            progress.phase,
            progress.estimatedTimeRemaining
          )
          this.notifyMigrationProgress(progress)
        }
      })

      if (result.success) {
        console.log('[Migration Presenter] Migration completed successfully')

        // Restore application state
        await this.applicationStateManager.restoreApplicationState()

        this.notifyMigrationCompleted(result)
        this.migrationDetected = false
      } else {
        console.error('[Migration Presenter] Migration failed:', result.errors)

        // Restore application state even on failure
        this.applicationStateManager.setMigrationInProgress(false)

        this.notifyMigrationError(result.errors.join('; '))
      }
    } catch (error) {
      console.error('[Migration Presenter] Migration process failed:', error)

      // Restore application state on error
      this.applicationStateManager.setMigrationInProgress(false)

      this.notifyMigrationError(String(error))
    } finally {
      this.migrationInProgress = false
    }
  }

  /**
   * Cancel ongoing migration
   * Supports requirement 7.2 for migration cancellation
   */
  async cancelMigration(): Promise<void> {
    if (!this.migrationInProgress) {
      return
    }

    console.log('[Migration Presenter] Cancelling migration')

    try {
      // TODO: Implement migration cancellation in MigrationManager
      // For now, just update the state
      this.migrationInProgress = false

      // Restore application state
      this.applicationStateManager.setMigrationInProgress(false)

      this.notifyMigrationCancelled()
    } catch (error) {
      console.error('[Migration Presenter] Failed to cancel migration:', error)
    }
  }

  /**
   * Setup IPC handlers for renderer communication
   */
  private setupIpcHandlers(): void {
    // Check for legacy databases
    ipcMain.handle('migration:check-legacy-databases', async () => {
      try {
        const requirements = await this.migrationManager.getMigrationRequirements()

        if (requirements.required) {
          // Notify renderer about detected migration
          await this.notifyMigrationDetected(requirements)
        }

        return requirements
      } catch (error) {
        console.error('[Migration Presenter] Failed to check legacy databases:', error)
        throw error
      }
    })

    // Start migration
    ipcMain.handle('migration:start', async () => {
      try {
        await this.startMigration()
      } catch (error) {
        console.error('[Migration Presenter] Failed to start migration:', error)
        throw error
      }
    })

    // Cancel migration
    ipcMain.handle('migration:cancel', async () => {
      try {
        await this.cancelMigration()
      } catch (error) {
        console.error('[Migration Presenter] Failed to cancel migration:', error)
        throw error
      }
    })

    // Get migration status
    ipcMain.handle('migration:get-status', () => {
      return this.getMigrationStatus()
    })

    // Check if migration is required
    ipcMain.handle('migration:is-required', async () => {
      return await this.isMigrationRequired()
    })

    // Check if operation is allowed during migration
    ipcMain.handle('migration:is-operation-allowed', (_event, operation: string) => {
      return this.applicationStateManager.isOperationAllowed(operation)
    })

    // Get current application state
    ipcMain.handle('migration:get-application-state', () => {
      return this.applicationStateManager.getCurrentState()
    })
  }

  /**
   * Notify renderer process about migration detection
   */
  private async notifyMigrationDetected(requirements: any): Promise<void> {
    const detectionResult: MigrationDetectionResult = {
      requiresMigration: requirements.required,
      databases: requirements.databases,
      estimatedDuration: requirements.estimatedDuration,
      diskSpaceRequired: requirements.diskSpaceRequired,
      compatibility: requirements.compatibility
    }

    // Send to all renderer processes
    const allWindows = BrowserWindow.getAllWindows()
    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send('migration:detected', detectionResult)
      }
    }

    // Also emit through event bus
    eventBus.emit(MIGRATION_EVENTS.DETECTED, detectionResult)
  }

  /**
   * Notify renderer process that migration has started
   */
  private notifyMigrationStarted(): void {
    const allWindows = BrowserWindow.getAllWindows()
    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send('migration:started')
      }
    }

    eventBus.emit(MIGRATION_EVENTS.STARTED)
  }

  /**
   * Notify renderer process about migration progress
   */
  private notifyMigrationProgress(progress: any): void {
    const allWindows = BrowserWindow.getAllWindows()
    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send('migration:progress', progress)
      }
    }

    eventBus.emit(MIGRATION_EVENTS.PROGRESS, progress)
  }

  /**
   * Notify renderer process that migration completed
   */
  private notifyMigrationCompleted(result: any): void {
    const allWindows = BrowserWindow.getAllWindows()
    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send('migration:complete', result)
      }
    }

    eventBus.emit(MIGRATION_EVENTS.COMPLETED, result)
  }

  /**
   * Notify renderer process about migration error
   */
  private notifyMigrationError(error: string): void {
    const allWindows = BrowserWindow.getAllWindows()
    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send('migration:error', error)
      }
    }

    eventBus.emit(MIGRATION_EVENTS.ERROR, error)
  }

  /**
   * Notify renderer process that migration was cancelled
   */
  private notifyMigrationCancelled(): void {
    const allWindows = BrowserWindow.getAllWindows()
    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send('migration:cancelled')
      }
    }

    eventBus.emit(MIGRATION_EVENTS.CANCELLED)
  }

  /**
   * Check if a specific operation is allowed during migration
   * Supports requirement 7.2 for data access prevention during migration
   */
  isOperationAllowed(operation: string): boolean {
    return this.applicationStateManager.isOperationAllowed(operation)
  }

  /**
   * Get current application state
   */
  getApplicationState() {
    return this.applicationStateManager.getCurrentState()
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    console.log('[Migration Presenter] Cleaning up migration presenter')

    // Clean up application state manager
    this.applicationStateManager.destroy()

    // Remove IPC handlers
    ipcMain.removeHandler('migration:check-legacy-databases')
    ipcMain.removeHandler('migration:start')
    ipcMain.removeHandler('migration:cancel')
    ipcMain.removeHandler('migration:get-status')
    ipcMain.removeHandler('migration:is-required')
    ipcMain.removeHandler('migration:is-operation-allowed')
    ipcMain.removeHandler('migration:get-application-state')
  }
}
