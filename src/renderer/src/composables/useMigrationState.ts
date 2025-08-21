/**
 * Migration State Composable
 * Manages migration state in the renderer process
 * Implements requirement 7.2 for application compatibility during migration
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'

export interface MigrationState {
  isDetected: boolean
  isInProgress: boolean
  isBlocked: boolean
  canUserInteract: boolean
  currentPhase?: string
  progressPercentage: number
  estimatedTimeRemaining?: number
  startTime?: number
  recordsProcessed?: number
  errors: string[]
  warnings: string[]
}

export interface MigrationProgress {
  phase: string
  currentStep: string
  percentage: number
  startTime: number
  estimatedTimeRemaining?: number
  recordsProcessed?: number
  totalRecords?: number
  errors?: string[]
  warnings?: string[]
}

// Global migration state
const migrationState = ref<MigrationState>({
  isDetected: false,
  isInProgress: false,
  isBlocked: false,
  canUserInteract: true,
  progressPercentage: 0,
  errors: [],
  warnings: []
})

// Event listeners
let migrationDetectedListener: ((event: any, data: any) => void) | null = null
let migrationStartedListener: ((event: any) => void) | null = null
let migrationProgressListener: ((event: any, progress: MigrationProgress) => void) | null = null
let migrationCompleteListener: ((event: any, result: any) => void) | null = null
let migrationErrorListener: ((event: any, error: string) => void) | null = null
let migrationCancelledListener: ((event: any) => void) | null = null
let uiBlockedListener: ((event: any, data: any) => void) | null = null
let uiUnblockedListener: ((event: any) => void) | null = null

/**
 * Migration State Composable
 * Provides reactive migration state management for Vue components
 */
export function useMigrationState() {
  // Computed properties
  const isOperationBlocked = computed(() => {
    return migrationState.value.isInProgress && migrationState.value.isBlocked
  })

  const canShowUI = computed(() => {
    return migrationState.value.canUserInteract
  })

  const migrationStatus = computed(() => {
    if (migrationState.value.isInProgress) {
      return 'in-progress'
    } else if (migrationState.value.isDetected) {
      return 'detected'
    } else {
      return 'none'
    }
  })

  // Methods
  const checkMigrationRequired = async (): Promise<boolean> => {
    try {
      return (await window.electron?.ipcRenderer?.invoke('migration:is-required')) || false
    } catch (error) {
      console.error('Failed to check migration requirement:', error)
      return false
    }
  }

  const checkOperationAllowed = async (operation: string): Promise<boolean> => {
    try {
      return (
        (await window.electron?.ipcRenderer?.invoke('migration:is-operation-allowed', operation)) ||
        true
      )
    } catch (error) {
      console.error('Failed to check operation permission:', error)
      return true
    }
  }

  const getApplicationState = async () => {
    try {
      return await window.electron?.ipcRenderer?.invoke('migration:get-application-state')
    } catch (error) {
      console.error('Failed to get application state:', error)
      return null
    }
  }

  const startMigration = async (): Promise<void> => {
    try {
      await window.electron?.ipcRenderer?.invoke('migration:start')
    } catch (error) {
      console.error('Failed to start migration:', error)
      throw error
    }
  }

  const cancelMigration = async (): Promise<void> => {
    try {
      await window.electron?.ipcRenderer?.invoke('migration:cancel')
    } catch (error) {
      console.error('Failed to cancel migration:', error)
      throw error
    }
  }

  const checkLegacyDatabases = async () => {
    try {
      return await window.electron?.ipcRenderer?.invoke('migration:check-legacy-databases')
    } catch (error) {
      console.error('Failed to check legacy databases:', error)
      throw error
    }
  }

  // Setup IPC listeners
  const setupListeners = () => {
    if (!window.electron?.ipcRenderer) return

    // Migration detected
    migrationDetectedListener = (_event: any, data: any) => {
      console.log('[Migration State] Migration detected:', data)
      migrationState.value.isDetected = true
      migrationState.value.estimatedTimeRemaining = data.estimatedDuration
    }

    // Migration started
    migrationStartedListener = (_event: any) => {
      console.log('[Migration State] Migration started')
      migrationState.value.isInProgress = true
      migrationState.value.isBlocked = true
      migrationState.value.canUserInteract = false
      migrationState.value.startTime = Date.now()
      migrationState.value.progressPercentage = 0
      migrationState.value.errors = []
      migrationState.value.warnings = []
    }

    // Migration progress
    migrationProgressListener = (_event: any, progress: MigrationProgress) => {
      console.log('[Migration State] Migration progress:', progress)
      migrationState.value.currentPhase = progress.phase
      migrationState.value.progressPercentage = progress.percentage
      migrationState.value.estimatedTimeRemaining = progress.estimatedTimeRemaining
      migrationState.value.recordsProcessed = progress.recordsProcessed

      if (progress.errors) {
        migrationState.value.errors.push(...progress.errors)
      }
      if (progress.warnings) {
        migrationState.value.warnings.push(...progress.warnings)
      }
    }

    // Migration completed
    migrationCompleteListener = (_event: any, result: any) => {
      console.log('[Migration State] Migration completed:', result)
      migrationState.value.isInProgress = false
      migrationState.value.isBlocked = false
      migrationState.value.canUserInteract = true
      migrationState.value.isDetected = false
      migrationState.value.progressPercentage = 100
    }

    // Migration error
    migrationErrorListener = (_event: any, error: string) => {
      console.error('[Migration State] Migration error:', error)
      migrationState.value.isInProgress = false
      migrationState.value.isBlocked = false
      migrationState.value.canUserInteract = true
      migrationState.value.errors.push(error)
    }

    // Migration cancelled
    migrationCancelledListener = (_event: any) => {
      console.log('[Migration State] Migration cancelled')
      migrationState.value.isInProgress = false
      migrationState.value.isBlocked = false
      migrationState.value.canUserInteract = true
    }

    // UI blocked
    uiBlockedListener = (_event: any, data: any) => {
      console.log('[Migration State] UI blocked:', data)
      migrationState.value.isBlocked = true
      migrationState.value.canUserInteract = false
      migrationState.value.currentPhase = data.phase
      migrationState.value.estimatedTimeRemaining = data.estimatedTimeRemaining
    }

    // UI unblocked
    uiUnblockedListener = (_event: any) => {
      console.log('[Migration State] UI unblocked')
      migrationState.value.isBlocked = false
      migrationState.value.canUserInteract = true
    }

    // Register listeners
    window.electron.ipcRenderer.on('migration:detected', migrationDetectedListener)
    window.electron.ipcRenderer.on('migration:started', migrationStartedListener)
    window.electron.ipcRenderer.on('migration:progress', migrationProgressListener)
    window.electron.ipcRenderer.on('migration:complete', migrationCompleteListener)
    window.electron.ipcRenderer.on('migration:error', migrationErrorListener)
    window.electron.ipcRenderer.on('migration:cancelled', migrationCancelledListener)
    window.electron.ipcRenderer.on('migration:ui-blocked', uiBlockedListener)
    window.electron.ipcRenderer.on('migration:ui-unblocked', uiUnblockedListener)
  }

  // Cleanup listeners
  const cleanupListeners = () => {
    if (!window.electron?.ipcRenderer) return

    if (migrationDetectedListener) {
      window.electron.ipcRenderer.removeListener('migration:detected', migrationDetectedListener)
    }
    if (migrationStartedListener) {
      window.electron.ipcRenderer.removeListener('migration:started', migrationStartedListener)
    }
    if (migrationProgressListener) {
      window.electron.ipcRenderer.removeListener('migration:progress', migrationProgressListener)
    }
    if (migrationCompleteListener) {
      window.electron.ipcRenderer.removeListener('migration:complete', migrationCompleteListener)
    }
    if (migrationErrorListener) {
      window.electron.ipcRenderer.removeListener('migration:error', migrationErrorListener)
    }
    if (migrationCancelledListener) {
      window.electron.ipcRenderer.removeListener('migration:cancelled', migrationCancelledListener)
    }
    if (uiBlockedListener) {
      window.electron.ipcRenderer.removeListener('migration:ui-blocked', uiBlockedListener)
    }
    if (uiUnblockedListener) {
      window.electron.ipcRenderer.removeListener('migration:ui-unblocked', uiUnblockedListener)
    }
  }

  // Initialize on first use
  let initialized = false
  const initialize = () => {
    if (!initialized) {
      setupListeners()
      initialized = true
    }
  }

  // Auto-initialize when used in a component
  onMounted(() => {
    initialize()
  })

  onUnmounted(() => {
    // Don't cleanup listeners here as they're global
    // They will be cleaned up when the app is destroyed
  })

  return {
    // State
    migrationState: computed(() => migrationState.value),

    // Computed
    isOperationBlocked,
    canShowUI,
    migrationStatus,

    // Methods
    checkMigrationRequired,
    checkOperationAllowed,
    getApplicationState,
    startMigration,
    cancelMigration,
    checkLegacyDatabases,

    // Lifecycle
    initialize,
    cleanup: cleanupListeners
  }
}

// Global cleanup function for app-level cleanup
export function cleanupMigrationState() {
  if (!window.electron?.ipcRenderer) return

  const listeners = [
    { event: 'migration:detected', listener: migrationDetectedListener },
    { event: 'migration:started', listener: migrationStartedListener },
    { event: 'migration:progress', listener: migrationProgressListener },
    { event: 'migration:complete', listener: migrationCompleteListener },
    { event: 'migration:error', listener: migrationErrorListener },
    { event: 'migration:cancelled', listener: migrationCancelledListener },
    { event: 'migration:ui-blocked', listener: uiBlockedListener },
    { event: 'migration:ui-unblocked', listener: uiUnblockedListener }
  ]

  for (const { event, listener } of listeners) {
    if (listener) {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }
}
