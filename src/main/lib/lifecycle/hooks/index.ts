/**
 * Lifecycle hooks index
 * Exports all available lifecycle hooks for registration with the LifecycleManager
 */

export { databaseInitHook } from './databaseInitHook'
export { protocolRegistrationHook } from './protocolRegistrationHook'
export { configInitHook } from './configInitHook'
export { eventListenerSetupHook } from './eventListenerSetupHook'
export { traySetupHook } from './traySetupHook'
export { windowCreationHook } from './windowCreationHook'

// Re-export types for convenience
export type { LifecycleHook, LifecycleContext } from '../types'

// Re-export monitoring utilities
export { LifecycleEventMonitor, lifecycleEventMonitor } from '../LifecycleEventMonitor'
export type { LifecycleEventStats } from '../LifecycleEventMonitor'
