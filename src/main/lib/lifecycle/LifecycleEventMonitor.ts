/**
 * LifecycleEventMonitor - Utility for monitoring and debugging lifecycle events
 */

import { eventBus } from '../../eventbus'
import { LIFECYCLE_EVENTS } from '../../events'
import { LifecyclePhase } from './types'

export interface LifecycleEventStats {
  totalPhases: number
  completedPhases: number
  totalHooks: number
  successfulHooks: number
  failedHooks: number
  totalDuration: number
  phaseStats: Map<
    string,
    {
      duration: number
      hookCount: number
      successfulHooks: number
      failedHooks: number
      startTime: number
      endTime: number
    }
  >
}

export class LifecycleEventMonitor {
  private stats: LifecycleEventStats
  private isMonitoring: boolean = false
  private startupStartTime: number = 0

  constructor() {
    this.stats = {
      totalPhases: 0,
      completedPhases: 0,
      totalHooks: 0,
      successfulHooks: 0,
      failedHooks: 0,
      totalDuration: 0,
      phaseStats: new Map()
    }
  }

  /**
   * Start monitoring lifecycle events
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      return
    }

    this.isMonitoring = true
    this.resetStats()
    this.setupEventListeners()
    console.log('[LifecycleEventMonitor] Started monitoring lifecycle events')
  }

  /**
   * Stop monitoring lifecycle events
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return
    }

    this.isMonitoring = false
    this.removeEventListeners()
    console.log('[LifecycleEventMonitor] Stopped monitoring lifecycle events')
  }

  /**
   * Get current lifecycle statistics
   */
  getStats(): Readonly<LifecycleEventStats> {
    return {
      ...this.stats,
      phaseStats: new Map(this.stats.phaseStats)
    }
  }

  /**
   * Reset monitoring statistics
   */
  resetStats(): void {
    this.stats = {
      totalPhases: 0,
      completedPhases: 0,
      totalHooks: 0,
      successfulHooks: 0,
      failedHooks: 0,
      totalDuration: 0,
      phaseStats: new Map()
    }
    this.startupStartTime = 0
  }

  /**
   * Print detailed lifecycle statistics to console
   */
  printStats(): void {
    console.log('\n=== Lifecycle Statistics ===')
    console.log(`Total Phases: ${this.stats.totalPhases}`)
    console.log(`Completed Phases: ${this.stats.completedPhases}`)
    console.log(`Total Hooks: ${this.stats.totalHooks}`)
    console.log(`Successful Hooks: ${this.stats.successfulHooks}`)
    console.log(`Failed Hooks: ${this.stats.failedHooks}`)
    console.log(`Total Duration: ${this.stats.totalDuration}ms`)

    if (this.stats.phaseStats.size > 0) {
      console.log('\n--- Phase Details ---')
      this.stats.phaseStats.forEach((phaseStat, phase) => {
        console.log(`${phase}:`)
        console.log(`  Duration: ${phaseStat.duration}ms`)
        console.log(
          `  Hooks: ${phaseStat.hookCount} (${phaseStat.successfulHooks} successful, ${phaseStat.failedHooks} failed)`
        )
        console.log(
          `  Time: ${new Date(phaseStat.startTime).toISOString()} - ${new Date(phaseStat.endTime).toISOString()}`
        )
      })
    }
    console.log('============================\n')
  }

  /**
   * Set up event listeners for lifecycle monitoring
   */
  private setupEventListeners(): void {
    eventBus.on(LIFECYCLE_EVENTS.PHASE_STARTED, this.handlePhaseStarted.bind(this))
    eventBus.on(LIFECYCLE_EVENTS.PHASE_COMPLETED, this.handlePhaseCompleted.bind(this))
    eventBus.on(LIFECYCLE_EVENTS.HOOK_EXECUTED, this.handleHookExecuted.bind(this))
    eventBus.on(LIFECYCLE_EVENTS.ERROR_OCCURRED, this.handleError.bind(this))
    eventBus.on(LIFECYCLE_EVENTS.PROGRESS_UPDATED, this.handleProgressUpdate.bind(this))
    eventBus.on(LIFECYCLE_EVENTS.SHUTDOWN_REQUESTED, this.handleShutdownRequest.bind(this))
  }

  /**
   * Remove event listeners
   */
  private removeEventListeners(): void {
    eventBus.off(LIFECYCLE_EVENTS.PHASE_STARTED, this.handlePhaseStarted.bind(this))
    eventBus.off(LIFECYCLE_EVENTS.PHASE_COMPLETED, this.handlePhaseCompleted.bind(this))
    eventBus.off(LIFECYCLE_EVENTS.HOOK_EXECUTED, this.handleHookExecuted.bind(this))
    eventBus.off(LIFECYCLE_EVENTS.ERROR_OCCURRED, this.handleError.bind(this))
    eventBus.off(LIFECYCLE_EVENTS.PROGRESS_UPDATED, this.handleProgressUpdate.bind(this))
    eventBus.off(LIFECYCLE_EVENTS.SHUTDOWN_REQUESTED, this.handleShutdownRequest.bind(this))
  }

  /**
   * Handle phase started events
   */
  private handlePhaseStarted(data: any): void {
    if (!this.isMonitoring) return

    const phase = data.phase

    if (phase === 'startup') {
      this.startupStartTime = data.timestamp
      return
    }

    if (Object.values(LifecyclePhase).includes(phase)) {
      this.stats.totalPhases++

      this.stats.phaseStats.set(phase, {
        duration: 0,
        hookCount: data.hookCount || 0,
        successfulHooks: 0,
        failedHooks: 0,
        startTime: data.timestamp,
        endTime: 0
      })

      console.log(`[LifecycleEventMonitor] Phase started: ${phase} (${data.hookCount || 0} hooks)`)
    }
  }

  /**
   * Handle phase completed events
   */
  private handlePhaseCompleted(data: any): void {
    if (!this.isMonitoring) return

    const phase = data.phase

    if (phase === 'startup') {
      this.stats.totalDuration = data.totalDuration || data.timestamp - this.startupStartTime
      console.log(`[LifecycleEventMonitor] Startup completed in ${this.stats.totalDuration}ms`)
      return
    }

    if (Object.values(LifecyclePhase).includes(phase)) {
      this.stats.completedPhases++

      const phaseStat = this.stats.phaseStats.get(phase)
      if (phaseStat) {
        phaseStat.duration = data.duration || 0
        phaseStat.successfulHooks = data.successfulHooks || 0
        phaseStat.failedHooks = data.failedHooks || 0
        phaseStat.endTime = data.timestamp
      }

      console.log(
        `[LifecycleEventMonitor] Phase completed: ${phase} (${data.duration || 0}ms, ${data.successfulHooks || 0}/${data.hookCount || 0} hooks successful)`
      )
    }
  }

  /**
   * Handle hook executed events
   */
  private handleHookExecuted(data: any): void {
    if (!this.isMonitoring) return

    this.stats.totalHooks++
    this.stats.successfulHooks++

    console.log(
      `[LifecycleEventMonitor] Hook executed: ${data.hookName} in ${data.phase} (${data.duration}ms, priority: ${data.priority})`
    )
  }

  /**
   * Handle error events
   */
  private handleError(data: any): void {
    if (!this.isMonitoring) return

    if (data.hookName) {
      this.stats.failedHooks++
      console.error(
        `[LifecycleEventMonitor] Hook failed: ${data.hookName} in ${data.phase} - ${data.error}`
      )
    } else {
      console.error(`[LifecycleEventMonitor] Lifecycle error in ${data.phase}: ${data.error}`)
    }
  }

  /**
   * Handle progress update events
   */
  private handleProgressUpdate(data: any): void {
    if (!this.isMonitoring) return

    console.log(
      `[LifecycleEventMonitor] Progress: ${data.phase} - ${data.progress}%${data.message ? ` - ${data.message}` : ''}`
    )
  }

  /**
   * Handle shutdown request events
   */
  private handleShutdownRequest(data: any): void {
    if (!this.isMonitoring) return

    console.log(
      `[LifecycleEventMonitor] Shutdown requested (${data.beforeQuitHooks || 0} before-quit hooks, ${data.willQuitHooks || 0} will-quit hooks)`
    )
  }
}

// Create a global instance for easy access
export const lifecycleEventMonitor = new LifecycleEventMonitor()
