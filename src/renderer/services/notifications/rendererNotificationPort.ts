import type { NotificationNotifyOptions } from './notificationManager'
import type { NotificationRequest } from './notificationTypes'
import { rendererNotificationManager } from './rendererNotificationRuntime'

export const notifyRenderer = (request: NotificationRequest, options?: NotificationNotifyOptions) =>
  rendererNotificationManager.notify(request, options)

export type RendererNotificationNotifier = typeof notifyRenderer
