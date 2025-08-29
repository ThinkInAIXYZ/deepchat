/**
 * LifecycleManager - Central orchestrator for application lifecycle phases
 */

import { app } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { LIFECYCLE_EVENTS, WINDOW_EVENTS } from '@/events'
import { SplashWindowManager } from './SplashWindowManager'
import {
  HookExecutionResult,
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
   * Execute hooks grouped by priority with parallel execution within groups
   * and sequential execution between groups
   */
  private async executeHooksByPriority(
    phaseHooks: Array<{ id: string; hook: LifecycleHook }>,
    context: LifecycleContext,
    phase: LifecyclePhase,
    isShutdownPhase: boolean = false
  ): Promise<boolean> {
    // Group hooks by priority
    const priorityGroups = new Map<number, Array<{ id: string; hook: LifecycleHook }>>()

    for (const hookEntry of phaseHooks) {
      const priority = hookEntry.hook.priority
      if (!priorityGroups.has(priority)) {
        priorityGroups.set(priority, [])
      }
      priorityGroups.get(priority)!.push(hookEntry)
    }

    // Sort priority groups by priority value (lower numbers first)
    const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b)

    let totalCompletedHooks = 0
    const totalHooks = phaseHooks.length

    // Execute each priority group sequentially
    for (const priority of sortedPriorities) {
      const groupHooks = priorityGroups.get(priority)!

      // Execute all hooks in this priority group in parallel
      const hookPromises = groupHooks.map(async ({ id, hook }): Promise<HookExecutionResult> => {
        try {
          const result = await this.executeHook(hook, context)
          return {
            hookId: id,
            hook,
            success: true,
            result
          }
        } catch (error) {
          return {
            hookId: id,
            hook,
            success: false,
            error: error instanceof Error ? error : new Error(String(error))
          }
        }
      })

      // Wait for all hooks in this priority group to complete
      const groupResults = await Promise.allSettled(hookPromises)

      // Process results and handle errors
      for (const promiseResult of groupResults) {
        if (promiseResult.status === 'fulfilled') {
          const hookResult = promiseResult.value

          if (!hookResult.success) {
            // Hook failed
            if (hookResult.hook.critical) {
              if (isShutdownPhase) {
                // For shutdown phases, log critical errors but continue
                console.error(
                  `[LifecycleManager] Critical shutdown hook '${hookResult.hook.name}' failed, but continuing shutdown:`,
                  hookResult.error?.message || 'Unknown error'
                )
              } else {
                // For startup phases, throw the error to stop execution
                throw (
                  hookResult.error || new Error(`Critical hook '${hookResult.hook.name}' failed`)
                )
              }
            } else {
              // Non-critical hook failure - log and continue
              console.warn(
                `[LifecycleManager] Non-critical hook '${hookResult.hook.name}' failed:`,
                hookResult.error?.message || 'Unknown error'
              )
            }
          } else {
            // Hook succeeded - check for shutdown prevention
            if (
              isShutdownPhase &&
              phase === LifecyclePhase.BEFORE_QUIT &&
              hookResult.result === false
            ) {
              return false // Shutdown prevented
            }
          }
        } else {
          // Promise itself was rejected (shouldn't happen with our error handling, but just in case)
          console.error(
            '[LifecycleManager] Unexpected promise rejection in hook execution:',
            promiseResult.reason
          )
        }
      }

      // Update progress after completing this priority group
      totalCompletedHooks += groupHooks.length
      if (!isShutdownPhase && this.splashManager) {
        const phaseProgress = this.calculatePhaseProgress(phase)
        const hookProgress =
          phaseProgress.start +
          ((phaseProgress.end - phaseProgress.start) * totalCompletedHooks) /
            Math.max(totalHooks, 1)
        this.splashManager.updateProgress(phase, hookProgress)
      }
    }

    return true // All hooks completed successfully or shutdown not prevented
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

    // Use priority-based execution for all hooks in this phase
    await this.executeHooksByPriority(phaseHooks, this.lifecycleContext, phase, false)

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

    // Use priority-based execution for shutdown phase
    const shutdownAllowed = await this.executeHooksByPriority(
      phaseHooks,
      this.lifecycleContext,
      phase,
      true
    )

    if (!shutdownAllowed) {
      return false // Shutdown was prevented by a hook
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

        try {
          const { presenter } = await import('@/presenter')
          if (presenter?.windowPresenter) {
            console.log('LifecycleManager: Setting application quitting flag via presenter')
            presenter.windowPresenter.setApplicationQuitting(true)
          } else {
            console.log(
              'LifecycleManager: Presenter not available during shutdown, will be handled by hook if presenter initializes'
            )
          }
        } catch (error) {
          console.log(
            'LifecycleManager: Could not access presenter during shutdown, will rely on hook fallback:',
            error
          )
        }

        const canShutdown = await this.requestShutdown()
        if (canShutdown) {
          app.quit() // Main exit: finish beforeQuit
        } else {
          this.state.isShuttingDown = false
          try {
            const { presenter } = await import('@/presenter')
            if (presenter?.windowPresenter) {
              presenter.windowPresenter.setApplicationQuitting(false)
            }
          } catch (error) {
            console.log(
              'LifecycleManager: Failed to reset isQuitting flag after cancelled shutdown:',
              error
            )
          }
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
