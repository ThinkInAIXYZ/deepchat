/**
 * Lifecycle management types and interfaces
 */

/**
 * Lifecycle phases enum defining the application startup and shutdown sequence
 */
export enum LifecyclePhase {
  INIT = 'init',
  BEFORE_START = 'before-start',
  READY = 'ready',
  AFTER_START = 'after-start',
  BEFORE_QUIT = 'before-quit',
  WILL_QUIT = 'will-quit'
}

/**
 * Context object passed to lifecycle hooks during execution
 */
export interface LifecycleContext {
  phase: LifecyclePhase
  manager: ILifecycleManager
  database?: import('@/presenter/sqlitePresenter').SQLitePresenter
  config?: any
  [key: string]: any
}

/**
 * Lifecycle hook interface for components to register phase-specific logic
 */
export interface LifecycleHook {
  name: string // Descriptive name for logging and debugging
  priority?: number // Lower numbers execute first (default: 100)
  execute: (context: LifecycleContext) => Promise<void | boolean>
  timeout?: number // Optional timeout in milliseconds
  critical?: boolean // If true, failure halts the phase (default: false)
}

/**
 * Internal lifecycle state tracking
 */
export interface LifecycleState {
  currentPhase: LifecyclePhase | null
  completedPhases: Set<LifecyclePhase>
  startTime: number
  phaseStartTimes: Map<LifecyclePhase, number>
  hooks: Map<LifecyclePhase, Array<{ id: string; hook: LifecycleHook }>>
  isShuttingDown: boolean
}

/**
 * LifecycleManager interface defining the core lifecycle management API
 */
export interface ILifecycleManager {
  // Phase management
  start(): Promise<void>
  getCurrentPhase(): LifecyclePhase | null
  isPhaseComplete(phase: LifecyclePhase): boolean

  // Hook registration - for components that need to execute logic during specific phases
  registerHook(phase: LifecyclePhase, hook: LifecycleHook): string // Returns generated hook ID
  unregisterHook(phase: LifecyclePhase, hookId: string): void

  // Shutdown control
  requestShutdown(): Promise<boolean>
  forceShutdown(): void

  // Splash window management
  getSplashManager(): import('./SplashWindowManager').ISplashWindowManager

  // Error handling and recovery
  getErrorStatistics(): {
    totalErrors: number
    criticalErrors: number
    nonCriticalErrors: number
    retriedHooks: number
    failedHooks: Array<{
      hookName: string
      phase: LifecyclePhase
      error: string
      timestamp: number
    }>
  }
  updateRetryConfig(config: {
    maxRetries?: number
    retryDelay?: number
    backoffMultiplier?: number
    maxRetryDelay?: number
  }): void
  clearErrorHistory(): void
}
