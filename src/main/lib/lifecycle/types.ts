/**
 * Type definitions for lifecycle event data objects
 * These types define the structure of data passed with lifecycle events
 */

import { LifecyclePhase } from '@shared/lifecycle'

/**
 * Base interface for all lifecycle events
 */
export interface BaseLifecycleEvent {
  phase: LifecyclePhase | 'startup' | 'shutdown' | string
  timestamp: number
}

/**
 * Data structure for phase started events
 */
export interface PhaseStartedEventData extends BaseLifecycleEvent {
  hookCount: number
  totalPhases?: number
  isShutdownPhase?: boolean
}

/**
 * Data structure for phase completed events
 */
export interface PhaseCompletedEventData extends BaseLifecycleEvent {
  duration?: number
  totalDuration?: number
  hookCount?: number
  successfulHooks?: number
  failedHooks?: number
  completedPhases?: LifecyclePhase[]
  isShutdownPhase?: boolean
  shutdownPrevented?: boolean
  shutdownAllowed?: boolean
}

/**
 * Data structure for hook execution events
 */
export interface HookExecutedEventData extends BaseLifecycleEvent {
  name: string // Descriptive name for logging and debugging
  priority?: number // Lower numbers execute first (default: 100)
  timeout?: number // Optional timeout in milliseconds
  critical?: boolean // If true, failure halts the phase (default: false)
}

/**
 * Data structure for error events
 */
export interface ErrorOccurredEventData extends BaseLifecycleEvent {
  error: string
  errorStack?: string
  hookName?: string
  shutdownPrevented?: boolean
  shutdownAllowed?: boolean
  reason?: string
  totalDuration?: number
}

/**
 * Data structure for progress update events
 */
export interface ProgressUpdatedEventData extends BaseLifecycleEvent {
  progress: number
  message?: string
}

/**
 * Data structure for shutdown request events
 */
export interface ShutdownRequestedEventData extends BaseLifecycleEvent {
  beforeQuitHooks: number
  willQuitHooks: number
}
