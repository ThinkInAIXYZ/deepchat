/**
 * Lifecycle hooks index
 * Exports all available lifecycle hooks for registration with the LifecycleManager
 */

export { configInitHook } from './configInitHook'
export { databaseInitHook } from './databaseInitHook'
export { protocolRegistrationHook } from './protocolRegistrationHook'
export { presenterInitHook as presenterHook } from './presenterInitHook'
export { eventListenerSetupHook } from './eventListenerSetupHook'
export { traySetupHook } from './traySetupHook'
export { windowCreationHook } from './windowCreationHook'
