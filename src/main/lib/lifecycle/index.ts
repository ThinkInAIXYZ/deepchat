/**
 * Lifecycle management system index
 * Exports all lifecycle management components and utilities
 */

// Core lifecycle management
export { LifecycleManager } from './LifecycleManager'
export { SplashWindowManager } from './SplashWindowManager'
export { DatabaseInitializer } from './DatabaseInitializer'
export { LifecycleErrorHandler } from './ErrorHandler'

// Types and interfaces
export type { LifecycleHook, LifecycleContext, LifecycleState, ILifecycleManager } from './types'
export { LifecyclePhase } from './types'

// Monitoring and debugging
export { LifecycleEventMonitor, lifecycleEventMonitor } from './LifecycleEventMonitor'
export type { LifecycleEventStats } from './LifecycleEventMonitor'

// Hooks
export * from './hooks'

// Splash window interface
export type { ISplashWindowManager } from './SplashWindowManager'
