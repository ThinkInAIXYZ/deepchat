/**
 * Lifecycle phases enum defining the application startup and shutdown sequence
 */
export enum LifecyclePhase {
  INIT = 'init',
  BEFORE_START = 'before-start',
  READY = 'ready',
  AFTER_START = 'after-start',
  BEFORE_QUIT = 'before-quit'
}
