import { usePresenter } from '@/composables/usePresenter'
import { NOTIFICATION_EVENTS } from '@/events'
import type { ErrorNotification, SystemNotificationPayload } from './types'

export type NotificationAdapter = {
  bindErrorNotifications: (handler: (error: ErrorNotification) => void) => () => void
  showSystemNotification: (payload: SystemNotificationPayload) => Promise<void>
}

export function useNotificationAdapter(): NotificationAdapter {
  const notificationPresenter = usePresenter('notificationPresenter')

  const bindErrorNotifications = (handler: (error: ErrorNotification) => void) => {
    if (!window?.electron?.ipcRenderer) return () => undefined

    const listener = (_event: unknown, error: ErrorNotification) => {
      handler(error)
    }

    window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.SHOW_ERROR, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(NOTIFICATION_EVENTS.SHOW_ERROR, listener)
    }
  }

  const showSystemNotification = async (payload: SystemNotificationPayload) => {
    return notificationPresenter.showNotification(payload)
  }

  return {
    bindErrorNotifications,
    showSystemNotification
  }
}
