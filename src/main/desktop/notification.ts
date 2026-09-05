import { BrowserWindow, nativeImage, Notification, NotificationConstructorOptions } from 'electron'
import icon from '../../../resources/icon.png?asset'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { DesktopSettings } from './settings'

const notificationMessages = import.meta.glob<{ generationComplete: string }>(
  '../../renderer/src/i18n/*/chat.json',
  { eager: true, import: 'notify' }
)

export class NotificationService {
  private notifications = new Map<string, Notification>()

  constructor(
    private readonly settings: Pick<DesktopSettings, 'getNotificationsEnabled' | 'getLanguage'>,
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  async showSessionCompletion(session: { id: string; title: string }) {
    if (
      BrowserWindow.getAllWindows().some(
        (window) =>
          !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused()
      )
    ) {
      return
    }

    const messages =
      notificationMessages[`../../renderer/src/i18n/${this.settings.getLanguage()}/chat.json`]
    return await this.showNotification({
      id: `chat/${session.id}/completed`,
      title: messages.generationComplete,
      body: session.title
    })
  }

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
