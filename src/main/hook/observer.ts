import type { HookEventName } from '@shared/hooksNotifications'
import type { HookEvent } from './events'

export interface HookObserver {
  /** Synchronous subscription probe so producers can skip assembling facts nobody consumes. */
  isObserved(event: HookEventName): boolean

  /** Must not throw, must snapshot synchronously, and must never block the caller. */
  notify(event: HookEvent): void
}
