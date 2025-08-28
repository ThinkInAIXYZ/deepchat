/**
 * LifecycleManager - Central orchestrator for application lifecycle phases
 */

import { app } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { LIFECYCLE_EVENTS, WINDOW_EVENTS } from '@/events'
import { SplashWindowManager } from './SplashWindowManager'
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
  HookFailedEventData,
  BaseLifecycleEvent
} from './types'
import { is } from '@electron-toolkit/utils'

export { registerCoreHooks } from './coreHooks'

export class LifecycleManager implements ILifecycleManager {
  private state: LifecycleState
  private hookIdCounter = 0
  private splashManager: ISplashWindowManager
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
    } catch (error) {
      // Close splash window on error
      if (this.splashManager.isVisible()) {
        await this.splashManager.close()
      }

      this.notifyMessage(LIFECYCLE_EVENTS.ERROR_OCCURRED, {
        phase: this.state.currentPhase,
        reason: error instanceof Error ? error.message : String(error)
      } as ErrorOccurredEventData)
      throw error
    }
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
    const priority = hook.priority
    const insertIndex = phaseHooks.findIndex((h) => h.hook.priority > priority)

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
   * Request application shutdown with hook interception
   */
  async requestShutdown(): Promise<boolean> {
    // Emit shutdown request to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.SHUTDOWN_REQUESTED, {
      phase: LifecyclePhase.BEFORE_QUIT,
      hookCount: this.state.hooks.get(LifecyclePhase.BEFORE_QUIT)?.length || 0
    } as PhaseStartedEventData)

    try {
      // Execute before-quit phase with interception capability
      return await this.executeShutdownPhase(LifecyclePhase.BEFORE_QUIT)
    } catch (error) {
      this.notifyMessage(LIFECYCLE_EVENTS.ERROR_OCCURRED, {
        phase: this.state.currentPhase,
        reason: error instanceof Error ? error.message : String(error)
      } as ErrorOccurredEventData)

      return false
    }
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

    // Emit phase started event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_STARTED, {
      phase,
      hookCount: this.state.hooks.get(phase)?.length || 0
    } as PhaseStartedEventData)

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
        // For critical hooks, the error is already handled in executeHook
        // For startup phases (init, before-ready, ready), the app will exit
        if (hook.critical) {
          throw hookError
        }
        // For non-critical hooks, we continue (error already logged)
      }
    }

    // Update progress to phase completion
    this.splashManager.updateProgress(phase, phaseProgress.end)

    this.state.completedPhases.add(phase)

    const phaseDuration = Date.now() - phaseStartTime

    // Emit phase completed event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_COMPLETED, {
      phase,
      duration: phaseDuration
    } as PhaseCompletedEventData)
  }

  /**
   * Execute shutdown phase with interception capability
   */
  private async executeShutdownPhase(phase: LifecyclePhase): Promise<boolean> {
    const phaseStartTime = Date.now()

    this.state.currentPhase = phase
    this.state.phaseStartTimes.set(phase, phaseStartTime)

    // Emit phase started event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_STARTED, {
      phase,
      hookCount: this.state.hooks.get(phase)?.length || 0
    } as PhaseStartedEventData)
    const phaseHooks = this.state.hooks.get(phase) || []

    // Update the single context instance with current phase
    this.lifecycleContext.phase = phase

    // Execute hooks and check for shutdown prevention
    for (const { hook } of phaseHooks) {
      try {
        const result = await this.executeHook(hook, this.lifecycleContext)

        // If any before-quit hook returns false, prevent shutdown
        if (phase === LifecyclePhase.BEFORE_QUIT && result === false) {
          return false
        }
      } catch (hookError) {
        // For critical hooks in shutdown, we still continue but log the error
        // Shutdown should not be prevented by hook failures
        const errorMessage = hookError instanceof Error ? hookError.message : String(hookError)
        if (hook.critical) {
          console.error(
            `[LifecycleManager] Critical shutdown hook '${hook.name}' failed, but continuing shutdown:`,
            errorMessage
          )
        } else {
          console.warn(
            `[LifecycleManager] Non-critical shutdown hook '${hook.name}' failed:`,
            errorMessage
          )
        }
      }
    }

    this.state.completedPhases.add(phase)

    // Emit phase completed event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_COMPLETED, {
      phase,
      duration: Date.now() - phaseStartTime
    } as PhaseCompletedEventData)

    return true
  }

  /**
   * Execute a single lifecycle hook with error handling based on critical property
   */
  private async executeHook(
    hook: LifecycleHook,
    context: LifecycleContext
  ): Promise<void | boolean> {
    const { name, phase, priority, critical } = hook

    // Emit hook execution start event
    const executedMessage: HookExecutedEventData = {
      name,
      phase,
      critical,
      priority
    }
    this.notifyMessage(LIFECYCLE_EVENTS.HOOK_EXECUTED, executedMessage)

    try {
      const result = await hook.execute(context)

      if (is.dev) {
        const hookDelay = Number(import.meta.env.VITE_APP_LIFECYCLE_HOOK_DELAY)
        await new Promise((resolve) => setTimeout(resolve, hookDelay))
      }

      this.notifyMessage(LIFECYCLE_EVENTS.HOOK_COMPLETED, executedMessage)

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Send notification about the failure
      this.notifyMessage(LIFECYCLE_EVENTS.HOOK_FAILED, {
        ...executedMessage,
        error: errorMessage
      } as HookFailedEventData)

      throw error
    }
  }

  /**
   * Calculate progress percentage for each lifecycle phase
   */
  private calculatePhaseProgress(phase: LifecyclePhase): { start: number; end: number } {
    const phaseProgressMap = {
      [LifecyclePhase.INIT]: { start: 0, end: 25 },
      [LifecyclePhase.BEFORE_START]: { start: 25, end: 50 },
      [LifecyclePhase.READY]: { start: 50, end: 75 },
      [LifecyclePhase.AFTER_START]: { start: 75, end: 100 }
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

        this.state.isShuttingDown = true
        const canShutdown = await this.requestShutdown()
        if (canShutdown) {
          app.quit() // Main exit: finish beforeQuit
        } else {
          this.state.isShuttingDown = false
        }
      }
    })

    // 监听强制退出应用事件 (例如：从菜单触发)，设置退出标志并调用 app.quit()
    eventBus.on(WINDOW_EVENTS.FORCE_QUIT_APP, () => {
      console.log('Force quitting application.')
      this.forceShutdown()
    })
  }

  /**
   * Set up lifecycle event listeners for debugging and monitoring
   */
  private setupLifecycleEventListeners(): void {
    // Listen to phase started events for debugging
    eventBus.on(LIFECYCLE_EVENTS.PHASE_STARTED, (data: PhaseStartedEventData) => {
      console.log(
        `[LifecycleManager] Starting lifecycle phase '${data.phase}' with ${data.hookCount} hooks`
      )
    })

    // Listen to phase completed events for debugging
    eventBus.on(LIFECYCLE_EVENTS.PHASE_COMPLETED, (data: PhaseCompletedEventData) => {
      console.log(
        `[LifecycleManager] Completed lifecycle phase: ${data.phase} (${data.duration}ms)`
      )
    })

    // Listen to hook executed events
    eventBus.on(LIFECYCLE_EVENTS.HOOK_EXECUTED, (data: HookExecutedEventData) => {
      console.log(
        `[LifecycleManager] Hook executed: ${data.name} [priority: ${data.priority}, critical: ${data.critical}]`
      )
    })

    // Listen to hook completed events
    eventBus.on(LIFECYCLE_EVENTS.HOOK_COMPLETED, (data: HookExecutedEventData) => {
      console.log(`[LifecycleManager] Hook completed: ${data.name}`)
    })

    // Listen to hook failed events
    eventBus.on(LIFECYCLE_EVENTS.HOOK_FAILED, (data: HookFailedEventData) => {
      console.log(`[LifecycleManager] Hook failed: ${data.name}`, data.error)
    })

    // Listen to error events for monitoring
    eventBus.on(LIFECYCLE_EVENTS.ERROR_OCCURRED, (data: ErrorOccurredEventData) => {
      console.error(`[LifecycleManager] Error in ${data.phase}: ${data.reason}`)
    })

    // Listen to progress updates for monitoring
    eventBus.on(LIFECYCLE_EVENTS.PROGRESS_UPDATED, (data: ProgressUpdatedEventData) => {
      console.log(
        `[LifecycleManager] Progress update: ${data.phase} - ${data.progress}% - ${data.message}`
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
   * Get the single lifecycle context instance
   */
  getLifecycleContext(): LifecycleContext {
    return this.lifecycleContext
  }

  private notifyMessage(event: string, data: BaseLifecycleEvent) {
    eventBus.sendToMain(event, data)
    if (this.lifecycleContext.presenter) {
      eventBus.sendToRenderer(event, SendTarget.ALL_WINDOWS, data)
    }
  }

  private forceShutdown(): void {
    console.log('Force shutdown requested')
    this.state.isShuttingDown = true
    app.quit() // Main exit: force quit
  }
}
