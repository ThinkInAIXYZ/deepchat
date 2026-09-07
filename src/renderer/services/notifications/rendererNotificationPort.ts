import type { NotificationNotifyOptions } from './notificationManager'
import type { NotificationRequest } from './notificationTypes'
import { rendererNotificationManager } from './rendererNotificationRuntime'

export const notifyRenderer = (
  request: NotificationRequest,
  options?: NotificationNotifyOptions
): boolean => {
  try {
    rendererNotificationManager.notify(request, options)
    return true
  } catch (error) {
    console.error('[RendererNotificationPort] notification failed', error)
    return false
  }
}

export type RendererNotificationNotifier = typeof notifyRenderer
