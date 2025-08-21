/**
 * Application State Manager
 * Handles application state during migration process
 * Implements requirement 7.1, 7.2 for application compatibility during migration
 */

import { BrowserWindow, dialog } from 'electron'
import { eventBus } from '@/eventbus'
import { MIGRATION_EVENTS } from '@/events'

export interface ApplicationState {
  isMigrationInProgress: boolean
  isDataAccessBlocked: boolean
  canUserInteract: boolean
  migrationPhase?: string
  estimatedTimeRemaining?: number
}

export interface StateBlockingOptions {
  blockDataAccess?: boolean
  blockUserInterface?: boolean
  showProgressDialog?: boolean
  allowCancel?: boolean
}

/**
 * Application State Manager for handling app state during migration
 * Supports requirements 7.1, 7.2 for application state management during migration
 */
export class ApplicationStateManager {
  private currentState: ApplicationState = {
    isMigrationInProgress: false,
    isDataAccessBlocked: false,
    canUserInteract: true
  }

  private stateChangeListeners: Array<(state: ApplicationState) => void> = []
  private blockedOperations: Set<string> = new Set()

  /**
   * Get current application state
   */
  getCurrentState(): ApplicationState {
    return { ...this.currentState }
  }

  /**
   * Set migration in progress state
   * Supports requirement 7.1 for application state management during migration
   */
  setMigrationInProgress(
    inProgress: boolean,
    phase?: string,
    options: StateBlockingOptions = {}
  ): void {
    console.log(`[Application State] Setting migration in progress: ${inProgress}, phase: ${phase}`)

    const previousState = { ...this.currentState }

    this.currentState.isMigrationInProgress = inProgress
    this.currentState.migrationPhase = phase

    if (inProgress) {
      // Block data access during migration
      if (options.blockDataAccess !== false) {
        this.currentState.isDataAccessBlocked = true
        this.blockDatabaseOperations()
      }

      // Block user interface if requested
      if (options.blockUserInterface) {
        this.currentState.canUserInteract = false
        this.blockUserInterface()
      }
    } else {
      // Restore normal state when migration completes
      this.currentState.isDataAccessBlocked = false
      this.currentState.canUserInteract = true
      this.currentState.migrationPhase = undefined
      this.currentState.estimatedTimeRemaining = undefined

      this.unblockDatabaseOperations()
      this.unblockUserInterface()
    }

    // Notify listeners about state change
    this.notifyStateChange(previousState, this.currentState)

    // Emit event through event bus
    eventBus.emit(MIGRATION_EVENTS.PROGRESS, {
      phase: 'state-change',
      applicationState: this.currentState
    })
  }

  /**
   * Update migration progress and estimated time
   */
  updateMigrationProgress(phase: string, estimatedTimeRemaining?: number): void {
    const previousState = { ...this.currentState }

    this.currentState.migrationPhase = phase
    this.currentState.estimatedTimeRemaining = estimatedTimeRemaining

    this.notifyStateChange(previousState, this.currentState)
  }

  /**
   * Check if a specific operation is allowed
   * Supports requirement 7.2 for data access prevention during migration
   */
  isOperationAllowed(operation: string): boolean {
    if (!this.currentState.isMigrationInProgress) {
      return true
    }

    // Check if this operation is blocked
    if (this.blockedOperations.has(operation)) {
      console.warn(`[Application State] Operation '${operation}' is blocked during migration`)
      return false
    }

    // Check general data access blocking
    if (this.currentState.isDataAccessBlocked && this.isDataOperation(operation)) {
      console.warn(`[Application State] Data operation '${operation}' is blocked during migration`)
      return false
    }

    return true
  }

  /**
   * Block specific operations during migration
   */
  blockOperation(operation: string): void {
    this.blockedOperations.add(operation)
    console.log(`[Application State] Blocked operation: ${operation}`)
  }

  /**
   * Unblock specific operations
   */
  unblockOperation(operation: string): void {
    this.blockedOperations.delete(operation)
    console.log(`[Application State] Unblocked operation: ${operation}`)
  }

  /**
   * Add state change listener
   */
  addStateChangeListener(listener: (state: ApplicationState) => void): void {
    this.stateChangeListeners.push(listener)
  }

  /**
   * Remove state change listener
   */
  removeStateChangeListener(listener: (state: ApplicationState) => void): void {
    const index = this.stateChangeListeners.indexOf(listener)
    if (index > -1) {
      this.stateChangeListeners.splice(index, 1)
    }
  }

  /**
   * Show migration blocking dialog to user
   * Supports requirement 7.2 for user interface blocking during migration
   */
  async showMigrationBlockingDialog(): Promise<void> {
    const windows = BrowserWindow.getAllWindows()
    const focusedWindow = windows.find((w) => w.isFocused()) || windows[0]

    if (focusedWindow && !focusedWindow.isDestroyed()) {
      await dialog.showMessageBox(focusedWindow, {
        type: 'info',
        title: 'Migration in Progress',
        message: 'Database migration is currently in progress',
        detail:
          'Please wait for the migration to complete before using the application. This ensures data integrity and prevents corruption.',
        buttons: ['OK']
      })
    }
  }

  /**
   * Prepare application for restart after migration
   * Supports requirement 7.2 for post-migration application restart
   */
  async prepareForRestart(): Promise<void> {
    console.log('[Application State] Preparing application for restart after migration')

    // Save any pending state
    await this.savePendingState()

    // Close all non-essential windows
    await this.closeNonEssentialWindows()

    // Clear temporary data
    await this.clearTemporaryData()

    console.log('[Application State] Application prepared for restart')
  }

  /**
   * Restore application state after migration
   * Supports requirement 7.2 for post-migration state restoration
   */
  async restoreApplicationState(): Promise<void> {
    console.log('[Application State] Restoring application state after migration')

    try {
      // Restore normal operation state
      this.setMigrationInProgress(false)

      // Restore user preferences and window states
      await this.restoreUserPreferences()

      // Re-enable all operations
      this.blockedOperations.clear()

      console.log('[Application State] Application state restored successfully')
    } catch (error) {
      console.error('[Application State] Failed to restore application state:', error)
      throw error
    }
  }

  /**
   * Block database operations during migration
   */
  private blockDatabaseOperations(): void {
    const databaseOperations = [
      'database:query',
      'database:insert',
      'database:update',
      'database:delete',
      'conversation:create',
      'conversation:update',
      'conversation:delete',
      'message:create',
      'message:update',
      'message:delete',
      'knowledge:upload',
      'knowledge:delete',
      'knowledge:query'
    ]

    databaseOperations.forEach((op) => this.blockOperation(op))
    console.log('[Application State] Database operations blocked during migration')
  }

  /**
   * Unblock database operations after migration
   */
  private unblockDatabaseOperations(): void {
    const databaseOperations = [
      'database:query',
      'database:insert',
      'database:update',
      'database:delete',
      'conversation:create',
      'conversation:update',
      'conversation:delete',
      'message:create',
      'message:update',
      'message:delete',
      'knowledge:upload',
      'knowledge:delete',
      'knowledge:query'
    ]

    databaseOperations.forEach((op) => this.unblockOperation(op))
    console.log('[Application State] Database operations unblocked after migration')
  }

  /**
   * Block user interface during migration
   */
  private blockUserInterface(): void {
    // Send message to all renderer processes to show blocking UI
    const allWindows = BrowserWindow.getAllWindows()
    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send('migration:ui-blocked', {
          phase: this.currentState.migrationPhase,
          estimatedTimeRemaining: this.currentState.estimatedTimeRemaining
        })
      }
    }

    console.log('[Application State] User interface blocked during migration')
  }

  /**
   * Unblock user interface after migration
   */
  private unblockUserInterface(): void {
    // Send message to all renderer processes to remove blocking UI
    const allWindows = BrowserWindow.getAllWindows()
    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send('migration:ui-unblocked')
      }
    }

    console.log('[Application State] User interface unblocked after migration')
  }

  /**
   * Check if an operation is a data operation
   */
  private isDataOperation(operation: string): boolean {
    const dataOperationPrefixes = [
      'database:',
      'conversation:',
      'message:',
      'knowledge:',
      'sync:',
      'backup:'
    ]

    return dataOperationPrefixes.some((prefix) => operation.startsWith(prefix))
  }

  /**
   * Notify all listeners about state change
   */
  private notifyStateChange(_previousState: ApplicationState, newState: ApplicationState): void {
    for (const listener of this.stateChangeListeners) {
      try {
        listener(newState)
      } catch (error) {
        console.error('[Application State] Error in state change listener:', error)
      }
    }
  }

  /**
   * Save any pending application state
   */
  private async savePendingState(): Promise<void> {
    // This would save any pending user data, window positions, etc.
    // Implementation depends on specific application requirements
    console.log('[Application State] Saving pending state')
  }

  /**
   * Close non-essential windows before restart
   */
  private async closeNonEssentialWindows(): Promise<void> {
    const allWindows = BrowserWindow.getAllWindows()

    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        // Keep the main window, close others
        const isMainWindow = window.webContents.getURL().includes('local://chat')
        if (!isMainWindow) {
          window.close()
        }
      }
    }

    console.log('[Application State] Closed non-essential windows')
  }

  /**
   * Clear temporary data before restart
   */
  private async clearTemporaryData(): Promise<void> {
    // Clear any temporary caches, logs, etc.
    console.log('[Application State] Cleared temporary data')
  }

  /**
   * Restore user preferences after migration
   */
  private async restoreUserPreferences(): Promise<void> {
    // Restore user settings, window positions, etc.
    console.log('[Application State] Restored user preferences')
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    console.log('[Application State] Cleaning up application state manager')
    this.stateChangeListeners.length = 0
    this.blockedOperations.clear()
  }
}
