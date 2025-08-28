/**
 * Type definitions for lifecycle event data objects
 * These types define the structure of data passed with lifecycle events
 */

import { LifecyclePhase } from '@shared/lifecycle'

/**
 * Base interface for all lifecycle events
 */
export interface BaseLifecycleEvent {
  phase: LifecyclePhase
}

/**
 * Data structure for phase started events
 */
export interface PhaseStartedEventData extends BaseLifecycleEvent {
  hookCount: number
}

/**
 * Data structure for phase completed events
 */
export interface PhaseCompletedEventData extends BaseLifecycleEvent {
  duration: number
}

/**
 * Data structure for hook execution events
 */
export interface HookExecutedEventData extends BaseLifecycleEvent {
  name: string // Descriptive name for logging and debugging
  critical: boolean // If true, failure halts the phase (default: false)
  priority: number // Lower numbers execute first (default: 100)
}
/**
 * Data structure for hook failed events
 */
export interface HookFailedEventData extends HookExecutedEventData {
  error: string
}

/**
 * Data structure for error events
 */
export interface ErrorOccurredEventData extends BaseLifecycleEvent {
  reason: string
}

/**
 * Data structure for progress update events
 */
export interface ProgressUpdatedEventData extends BaseLifecycleEvent {
  progress: number
  message?: string
}
