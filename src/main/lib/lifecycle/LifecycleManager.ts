/**
 * LifecycleManager - Central orchestrator for application lifecycle phases
 */

import { app } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { LIFECYCLE_EVENTS } from '@/events'
import { SplashWindowManager } from './SplashWindowManager'
import { LifecycleErrorHandler } from './ErrorHandler'
import {
  ILifecycleManager,
  ISplashWindowManager,
  LifecycleContext,
  LifecycleHook,
  LifecycleState
} from '@shared/presenter'
import { LifecyclePhase } from '@shared/lifecycle'
import {
  PhaseStartedEventData,
  PhaseCompletedEventData,
  HookExecutedEventData,
  ErrorOccurredEventData,
  ProgressUpdatedEventData,
  ShutdownRequestedEventData
} from './types'
import { is } from '@electron-toolkit/utils'

export class LifecycleManager implements ILifecycleManager {
  private state: LifecycleState
  private hookIdCounter = 0
  private splashManager: ISplashWindowManager
  private errorHandler: LifecycleErrorHandler
  private lifecycleContext: LifecycleContext

  constructor() {
    this.state = {
      currentPhase: null,
      completedPhases: new Set(),
      startTime: 0,
      phaseStartTimes: new Map(),
      hooks: new Map(),
      isShuttingDown: false
    }

    // Initialize hook maps for all phases
    Object.values(LifecyclePhase).forEach((phase) => {
      this.state.hooks.set(phase, [])
    })

    // Initialize splash window manager
    this.splashManager = new SplashWindowManager()

    // Initialize error handler
    this.errorHandler = new LifecycleErrorHandler()

    // Initialize single lifecycle context instance
    this.lifecycleContext = {
      phase: LifecyclePhase.INIT, // Will be updated during execution
      manager: this
    }

    // Set up shutdown interception
    this.setupShutdownInterception()

    // Set up lifecycle event listeners for debugging and monitoring
    this.setupLifecycleEventListeners()
  }

  /**
   * Start the lifecycle management system and execute all phases
   */
  async start(): Promise<void> {
    if (this.state.currentPhase !== null) {
      throw new Error('Lifecycle manager has already been started')
    }

    this.state.startTime = Date.now()

    // Emit startup event
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_STARTED, {
      phase: 'startup',
      timestamp: this.state.startTime,
      totalPhases: 4 // init, before-start, ready, after-start
    } as PhaseStartedEventData)

    try {
      // Create and show splash window
      await this.splashManager.create()

      // Execute startup phases in sequence
      await this.executePhase(LifecyclePhase.INIT)
      await this.executePhase(LifecyclePhase.BEFORE_START)
      await this.executePhase(LifecyclePhase.READY)
      await this.executePhase(LifecyclePhase.AFTER_START)

      // Close splash window after startup is complete
      await this.splashManager.close()

      // Emit startup completion event
      const completionEvent: PhaseCompletedEventData = {
        phase: 'startup',
        timestamp: Date.now(),
        totalDuration: Date.now() - this.state.startTime,
        completedPhases: Array.from(this.state.completedPhases)
      }

      this.notifyMessage(LIFECYCLE_EVENTS.PHASE_COMPLETED, completionEvent)
    } catch (error) {
      // Close splash window on error
      if (this.splashManager.isVisible()) {
        await this.splashManager.close()
      }

      const errorEvent: ErrorOccurredEventData = {
        phase: this.state.currentPhase || 'startup',
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(),
        totalDuration: Date.now() - this.state.startTime
      }

      this.notifyMessage(LIFECYCLE_EVENTS.ERROR_OCCURRED, errorEvent)
      throw error
    }
  }

  /**
   * Get the current lifecycle phase
   */
  getCurrentPhase(): LifecyclePhase | null {
    return this.state.currentPhase
  }

  /**
   * Check if a specific phase has been completed
   */
  isPhaseComplete(phase: LifecyclePhase): boolean {
    return this.state.completedPhases.has(phase)
  }

  /**
   * Register a hook for a specific lifecycle phase
   */
  registerHook(hook: LifecycleHook): string {
    const hookId = `hook_${++this.hookIdCounter}_${Date.now()}`
    const phase = hook.phase
    const phaseHooks = this.state.hooks.get(phase)

    if (!phaseHooks) {
      throw new Error(`Invalid lifecycle phase: ${phase}`)
    }

    // Insert hook in priority order (lower priority numbers execute first)
    const priority = hook.priority ?? 100
    const insertIndex = phaseHooks.findIndex((h) => (h.hook.priority ?? 100) > priority)

    if (insertIndex === -1) {
      phaseHooks.push({ id: hookId, hook })
    } else {
      phaseHooks.splice(insertIndex, 0, { id: hookId, hook })
    }

    console.log(
      `Registered lifecycle hook '${hook.name}' for phase '${phase}' with priority ${priority}`
    )
    return hookId
  }

  /**
   * Unregister a hook from a specific lifecycle phase
   */
  unregisterHook(hookId: string): void {
    for (const [phase, phaseHooks] of this.state.hooks) {
      if (!phaseHooks) {
        throw new Error(`Invalid lifecycle phase: ${phase}`)
      }
      const index = phaseHooks.findIndex((h) => h.id === hookId)
      if (index !== -1) {
        const removedHook = phaseHooks.splice(index, 1)[0]
        console.log(`Unregistered lifecycle hook '${removedHook.hook.name}' from phase '${phase}'`)
        break
      }
    }
  }

  /**
   * Request application shutdown with hook interception
   */
  async requestShutdown(): Promise<boolean> {
    if (this.state.isShuttingDown) {
      return true
    }

    this.state.isShuttingDown = true

    const shutdownEvent: ShutdownRequestedEventData = {
      phase: LifecyclePhase.BEFORE_QUIT,
      timestamp: Date.now(),
      beforeQuitHooks: this.state.hooks.get(LifecyclePhase.BEFORE_QUIT)?.length || 0,
      willQuitHooks: this.state.hooks.get(LifecyclePhase.WILL_QUIT)?.length || 0
    }

    // Emit shutdown request to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.SHUTDOWN_REQUESTED, shutdownEvent)

    try {
      // Execute before-quit phase with interception capability
      const canShutdown = await this.executeShutdownPhase(LifecyclePhase.BEFORE_QUIT)

      if (canShutdown) {
        // Execute will-quit phase for cleanup
        await this.executePhase(LifecyclePhase.WILL_QUIT)

        // Emit shutdown completion event
        const completionEvent: PhaseCompletedEventData = {
          phase: 'shutdown',
          timestamp: Date.now(),
          shutdownAllowed: true,
          totalDuration: Date.now() - shutdownEvent.timestamp
        }

        this.notifyMessage(LIFECYCLE_EVENTS.PHASE_COMPLETED, completionEvent)

        return true
      } else {
        this.state.isShuttingDown = false

        // Emit shutdown prevention event
        const preventionEvent: ErrorOccurredEventData = {
          phase: 'shutdown',
          error: 'Shutdown prevented',
          timestamp: Date.now(),
          shutdownAllowed: false,
          reason: 'Prevented by before-quit hook'
        }

        this.notifyMessage(LIFECYCLE_EVENTS.ERROR_OCCURRED, preventionEvent)

        return false
      }
    } catch (error) {
      this.state.isShuttingDown = false

      const errorEvent: ErrorOccurredEventData = {
        phase: 'shutdown',
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(),
        shutdownAllowed: false
      }

      this.notifyMessage(LIFECYCLE_EVENTS.ERROR_OCCURRED, errorEvent)

      return false
    }
  }

  /**
   * Force immediate shutdown without hook interception
   */
  forceShutdown(): void {
    console.log('Force shutdown requested')
    this.state.isShuttingDown = true
    app.quit()
  }

  /**
   * Get the splash window manager instance
   */
  getSplashManager(): ISplashWindowManager {
    return this.splashManager
  }

  /**
   * Execute a lifecycle phase and all its registered hooks
   */
  private async executePhase(phase: LifecyclePhase): Promise<void> {
    const phaseStartTime = Date.now()

    this.state.currentPhase = phase
    this.state.phaseStartTimes.set(phase, phaseStartTime)

    // Calculate progress based on phase
    const phaseProgress = this.calculatePhaseProgress(phase)
    this.splashManager.updateProgress(phase, phaseProgress.start)

    const phaseStartEvent: PhaseStartedEventData = {
      phase,
      timestamp: phaseStartTime,
      hookCount: this.state.hooks.get(phase)?.length || 0,
      totalPhases: Object.keys(LifecyclePhase).length
    }

    // Emit phase started event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_STARTED, phaseStartEvent)

    const phaseHooks = this.state.hooks.get(phase) || []

    // Update the single context instance with current phase
    this.lifecycleContext.phase = phase

    let successfulHooks = 0
    let failedHooks = 0

    // Execute hooks in priority order
    for (let i = 0; i < phaseHooks.length; i++) {
      const { hook } = phaseHooks[i]

      // Update progress during hook execution
      const hookProgress =
        phaseProgress.start +
        ((phaseProgress.end - phaseProgress.start) * (i + 1)) / Math.max(phaseHooks.length, 1)
      this.splashManager.updateProgress(phase, hookProgress)

      try {
        await this.executeHook(hook, this.lifecycleContext)
        successfulHooks++
      } catch (hookError) {
        failedHooks++
        // Critical hook failures are already handled in executeHook
        throw hookError
      }
    }

    // Update progress to phase completion
    this.splashManager.updateProgress(phase, phaseProgress.end)

    this.state.completedPhases.add(phase)

    const phaseDuration = Date.now() - phaseStartTime
    const phaseCompletedEvent: PhaseCompletedEventData = {
      phase,
      timestamp: Date.now(),
      duration: phaseDuration,
      hookCount: phaseHooks.length,
      successfulHooks,
      failedHooks
    }

    // Emit phase completed event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_COMPLETED, phaseCompletedEvent)
  }

  /**
   * Execute shutdown phase with interception capability
   */
  private async executeShutdownPhase(phase: LifecyclePhase): Promise<boolean> {
    const phaseStartTime = Date.now()

    this.state.currentPhase = phase
    this.state.phaseStartTimes.set(phase, phaseStartTime)

    const phaseStartEvent: PhaseStartedEventData = {
      phase,
      timestamp: phaseStartTime,
      hookCount: this.state.hooks.get(phase)?.length || 0,
      isShutdownPhase: true
    }

    // Emit phase started event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_STARTED, phaseStartEvent)
    const phaseHooks = this.state.hooks.get(phase) || []

    // Update the single context instance with current phase
    this.lifecycleContext.phase = phase

    let successfulHooks = 0
    let failedHooks = 0
    let preventedShutdown = false

    // Execute hooks and check for shutdown prevention
    for (const { hook } of phaseHooks) {
      try {
        const result = await this.executeHook(hook, this.lifecycleContext)
        successfulHooks++

        // If any before-quit hook returns false, prevent shutdown
        if (phase === LifecyclePhase.BEFORE_QUIT && result === false) {
          preventedShutdown = true

          // Emit shutdown prevention event
          this.notifyMessage(LIFECYCLE_EVENTS.ERROR_OCCURRED, {
            hookName: hook.name,
            phase,
            error: 'Shutdown prevented by hook',
            timestamp: Date.now(),
            shutdownPrevented: true
          } as ErrorOccurredEventData)

          return false
        }
      } catch (hookError) {
        failedHooks++
        // Error handling is already done in executeHook
      }
    }

    this.state.completedPhases.add(phase)

    const phaseDuration = Date.now() - phaseStartTime
    const phaseCompletedEvent: PhaseCompletedEventData = {
      phase,
      timestamp: Date.now(),
      duration: phaseDuration,
      hookCount: phaseHooks.length,
      successfulHooks,
      failedHooks,
      isShutdownPhase: true,
      shutdownPrevented: preventedShutdown
    }

    // Emit phase completed event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_COMPLETED, phaseCompletedEvent)

    return true
  }

  /**
   * Execute a single lifecycle hook with enhanced error handling and recovery
   */
  private async executeHook(
    hook: LifecycleHook,
    context: LifecycleContext
  ): Promise<void | boolean> {
    // Emit successful hook execution event
    const { name, phase, priority, critical, timeout } = hook
    const executedMessage: HookExecutedEventData = {
      name,
      phase,
      priority,
      critical,
      timeout,
      timestamp: Date.now()
    }
    this.notifyMessage(LIFECYCLE_EVENTS.HOOK_EXECUTED, executedMessage)

    // Use the error handler to execute the hook with retry and recovery mechanisms
    const result = await this.errorHandler.executeHookWithRetry(hook, context, {
      showErrorDialog: hook.critical || false, // Show dialog for critical hooks
      allowRetry: true,
      gracefulDegradation: !hook.critical, // Allow graceful degradation for non-critical hooks
      logLevel: hook.critical ? 'error' : 'warn'
    })

    if (is.dev) {
      const hookDelay = Number(import.meta.env.VITE_APP_LIFECYCLE_HOOK_DELAY)
      await new Promise((resolve) => setTimeout(resolve, hookDelay))
    }

    const computedMessage: HookExecutedEventData = {
      name,
      phase,
      priority,
      critical,
      timeout,
      timestamp: Date.now()
    }
    // Emit successful hook execution event
    this.notifyMessage(LIFECYCLE_EVENTS.HOOK_COMPUTED, computedMessage)

    return result
  }

  /**
   * Calculate progress percentage for each lifecycle phase
   */
  private calculatePhaseProgress(phase: LifecyclePhase): { start: number; end: number } {
    const phaseProgressMap = {
      [LifecyclePhase.INIT]: { start: 0, end: 25 },
      [LifecyclePhase.BEFORE_START]: { start: 25, end: 50 },
      [LifecyclePhase.READY]: { start: 50, end: 75 },
      [LifecyclePhase.AFTER_START]: { start: 75, end: 100 },
      [LifecyclePhase.BEFORE_QUIT]: { start: 0, end: 50 },
      [LifecyclePhase.WILL_QUIT]: { start: 50, end: 100 }
    }

    return phaseProgressMap[phase] || { start: 0, end: 100 }
  }

  /**
   * Set up Electron app event handlers for shutdown interception
   */
  private setupShutdownInterception(): void {
    app.on('before-quit', async (event) => {
      if (!this.state.isShuttingDown) {
        event.preventDefault()

        const canShutdown = await this.requestShutdown()
        if (canShutdown) {
          app.quit()
        }
      }
    })
  }

  /**
   * Set up lifecycle event listeners for debugging and monitoring
   */
  private setupLifecycleEventListeners(): void {
    // Listen to phase started events for debugging
    eventBus.on(LIFECYCLE_EVENTS.PHASE_STARTED, (data: PhaseStartedEventData) => {
      if (data.phase === 'startup') {
        console.log(`[LifecycleManager] Starting application lifecycle`)
      } else if (data.isShutdownPhase) {
        console.log(
          `[LifecycleManager] Starting shutdown phase: '${data.phase}' with ${data.hookCount} hooks`
        )
      } else {
        console.log(
          `[LifecycleManager] Starting lifecycle phase '${data.phase}' with ${data.hookCount} hooks`
        )
      }
    })

    // Listen to phase completed events for debugging
    eventBus.on(LIFECYCLE_EVENTS.PHASE_COMPLETED, (data: PhaseCompletedEventData) => {
      if (data.phase === 'startup') {
        console.log(
          `[LifecycleManager] Application lifecycle startup completed (${data.totalDuration}ms)`
        )
      } else if (data.isShutdownPhase) {
        console.log(
          `[LifecycleManager] Completed shutdown phase: ${data.phase} (${data.duration}ms, ${data.successfulHooks}/${data.hookCount} hooks successful)`
        )
      } else {
        console.log(
          `[LifecycleManager] Completed lifecycle phase: ${data.phase} (${data.duration}ms, ${data.successfulHooks}/${data.hookCount} hooks successful)`
        )
      }
    })

    // Listen to hook executed events
    eventBus.on(LIFECYCLE_EVENTS.HOOK_EXECUTED, (data: HookExecutedEventData) => {
      console.log(
        `[LifecycleManager] Starting hook: ${data.name}) - ${data.priority}, ${data.critical}, ${data.timeout}`
      )
    })
    // Listen to hook computed events
    eventBus.on(LIFECYCLE_EVENTS.HOOK_COMPUTED, (data: HookExecutedEventData) => {
      console.log(`[LifecycleManager] Computed hook: ${data.name})`)
    })

    // Listen to error events for monitoring
    eventBus.on(LIFECYCLE_EVENTS.ERROR_OCCURRED, (data: ErrorOccurredEventData) => {
      if (data.shutdownPrevented) {
        console.log(`Shutdown prevented by hook: ${data.hookName}`)
      } else if (data.phase === 'shutdown' && data.error === 'Shutdown prevented') {
        // Already handled by shutdown prevention logging
      } else if (data.phase === 'shutdown') {
        console.error('Shutdown process failed:', data.error)
      } else {
        console.error(`[LifecycleManager] Error in ${data.phase || 'unknown phase'}: ${data.error}`)
        if (data.hookName) {
          console.error(`Hook execution failed: ${data.hookName}`, data.error)
        }
      }
    })

    // Listen to progress updates for monitoring
    eventBus.on(LIFECYCLE_EVENTS.PROGRESS_UPDATED, (data: ProgressUpdatedEventData) => {
      console.log(
        `[LifecycleManager] Progress update: ${data.phase} - ${data.progress}% - ${data.message || 'No message'}`
      )
    })

    // Listen to shutdown requests for monitoring
    eventBus.on(LIFECYCLE_EVENTS.SHUTDOWN_REQUESTED, (data: ShutdownRequestedEventData) => {
      console.log(
        `[LifecycleManager] Shutdown requested with ${data.beforeQuitHooks} before-quit hooks and ${data.willQuitHooks} will-quit hooks`
      )
      console.log(
        `[LifecycleManager] Shutdown requested at ${new Date(data.timestamp).toISOString()}`
      )
    })
  }

  /**
   * Get current lifecycle state for debugging purposes
   */
  getLifecycleState(): Readonly<LifecycleState> {
    return {
      ...this.state,
      completedPhases: new Set(this.state.completedPhases),
      phaseStartTimes: new Map(this.state.phaseStartTimes),
      hooks: new Map(this.state.hooks)
    }
  }

  /**
   * Get error statistics from the error handler
   */
  getErrorStatistics() {
    return this.errorHandler.getErrorStatistics()
  }

  /**
   * Update retry configuration for error recovery
   */
  updateRetryConfig(config: {
    maxRetries?: number
    retryDelay?: number
    backoffMultiplier?: number
    maxRetryDelay?: number
  }): void {
    this.errorHandler.updateRetryConfig(config)
  }

  /**
   * Clear error history (useful for testing or reset)
   */
  clearErrorHistory(): void {
    this.errorHandler.clearErrorHistory()
  }

  /**
   * Get the single lifecycle context instance
   */
  getLifecycleContext(): LifecycleContext {
    return this.lifecycleContext
  }

  private notifyMessage(event: string, data: any) {
    eventBus.sendToMain(event, data)
    if (this.lifecycleContext.presenter) {
      eventBus.sendToRenderer(event, SendTarget.ALL_WINDOWS, data)
    }
  }
}
