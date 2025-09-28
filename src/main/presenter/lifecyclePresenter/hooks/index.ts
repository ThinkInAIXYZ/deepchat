/**
 * Lifecycle hooks index
 * Exports all available lifecycle hooks for registration with the LifecycleManager
 */

export { configInitHook } from './init/configInitHook'
export { databaseInitHook } from './init/databaseInitHook'
export { protocolRegistrationHook } from './beforeStart/protocolRegistrationHook'
export { presenterInitHook as presenterHook } from './ready/presenterInitHook'
export { eventListenerSetupHook } from './ready/eventListenerSetupHook'
export { traySetupHook } from './after-start/traySetupHook'
export { windowCreationHook } from './after-start/windowCreationHook'
export { trayDestroyHook } from './beforeQuit/trayDestroyHook'
export { floatingDestroyHook } from './beforeQuit/floatingDestroyHook'
export { presenterDestroyHook } from './beforeQuit/presenterDestroyHook'
export { builtinKnowledgeDestroyHook } from './beforeQuit/builtinKnowledgeDestroyHook'
export { windowQuittingHook } from './beforeQuit/windowQuittingHook'
