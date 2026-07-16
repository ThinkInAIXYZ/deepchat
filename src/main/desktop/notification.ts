import { nativeImage, Notification, NotificationConstructorOptions } from 'electron'
import icon from '../../../resources/icon.png?asset'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { DesktopSettings } from './settings'

export class NotificationService {
  private notifications = new Map<string, Notification>()

  constructor(
    private readonly settings: Pick<DesktopSettings, 'getNotificationsEnabled'>,
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  async showNotification(options: { id: string; title: string; body: string; silent?: boolean }) {
    const notificationsEnabled = this.settings.getNotificationsEnabled()
    if (!notificationsEnabled) {
      return
    }

    this.clearNotification(options.id)

    const iconFile = nativeImage.createFromPath(icon)
    const notificationOptions: NotificationConstructorOptions = {
      title: options.title,
      body: options.body,
      silent: options.silent,
      icon: iconFile
    }

    const notification = new Notification(notificationOptions)

    notification.on('click', () => {
      this.publishEvent('appRuntime.systemNotificationClicked', {
        payload: options.id
      })
      this.clearNotification(options.id)
    })

    notification.on('close', () => {
      this.notifications.delete(options.id)
    })

    this.notifications.set(options.id, notification)

    notification.show()

    return options.id
  }

  clearNotification(id: string) {
    this.notifications.delete(id)
  }

  clearAllNotifications() {
    this.notifications.clear()
  }
}
