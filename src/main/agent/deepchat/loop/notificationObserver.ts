import type { DeepChatLoopNotification, DeepChatLoopNotificationObserver } from './ports'

export function emitDeepChatLoopNotification(
  observer: DeepChatLoopNotificationObserver | undefined,
  notification: DeepChatLoopNotification
): void {
  if (!observer) {
    return
  }

  try {
    const pending = observer.notify(structuredClone(notification))
    if (pending) {
      void Promise.resolve(pending).catch((error) => {
        console.warn('[DeepChatLoop] Notification observer failed:', error)
      })
    }
  } catch (error) {
    console.warn('[DeepChatLoop] Notification observer failed:', error)
  }
}
