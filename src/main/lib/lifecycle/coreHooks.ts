import { ILifecycleManager } from '@shared/presenter'
import {
  databaseInitHook,
  protocolRegistrationHook,
  configInitHook,
  eventListenerSetupHook,
  traySetupHook,
  windowCreationHook
} from './hooks'
import { LifecyclePhase } from '@shared/lifecycle'

/**
 * Register core application hooks with the lifecycle manager
 * This function should be called during lifecycle manager initialization
 */
export function registerCoreHooks(lifecycleManager: ILifecycleManager): void {
  console.log('Registering core application lifecycle hooks')

  // INIT phase hooks
  const configHookId = lifecycleManager.registerHook(LifecyclePhase.INIT, configInitHook)
  console.log(`Registered configuration initialization hook with ID: ${configHookId}`)

  const dbHookId = lifecycleManager.registerHook(LifecyclePhase.INIT, databaseInitHook)
  console.log(`Registered database initialization hook with ID: ${dbHookId}`)

  const protocolHookId = lifecycleManager.registerHook(
    LifecyclePhase.INIT,
    protocolRegistrationHook
  )
  console.log(`Registered protocol registration hook with ID: ${protocolHookId}`)

  // READY phase hooks
  const eventListenerHookId = lifecycleManager.registerHook(
    LifecyclePhase.READY,
    eventListenerSetupHook
  )
  console.log(`Registered event listener setup hook with ID: ${eventListenerHookId}`)

  // AFTER_START phase hooks
  const trayHookId = lifecycleManager.registerHook(LifecyclePhase.AFTER_START, traySetupHook)
  console.log(`Registered tray setup hook with ID: ${trayHookId}`)

  const windowHookId = lifecycleManager.registerHook(LifecyclePhase.AFTER_START, windowCreationHook)
  console.log(`Registered window creation hook with ID: ${windowHookId}`)
}
