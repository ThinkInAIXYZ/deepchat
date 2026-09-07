import type { DeepChatLoopNotification, DeepChatLoopNotificationObserver } from './ports'

export function emitDeepChatLoopNotification(
  observer: DeepChatLoopNotificationObserver | undefined,
  notification: DeepChatLoopNotification
): void {
  if (!observer) {
    return
  }

  try {
    if (!observer.isObserved(notification.event)) {
      return
    }
    observer.notify(notification)
  } catch (error) {
    console.warn('[DeepChatLoop] Notification observer failed:', error)
  }
}
