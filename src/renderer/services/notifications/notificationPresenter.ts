import type { ObservableNotificationRecord } from './notificationRecord'
import type { NotificationCloseReason } from './notificationTypes'

export type NotificationPresentationEvents = Readonly<{
  onClosed: (reason: Extract<NotificationCloseReason, 'auto' | 'dismissed' | 'action'>) => void
}>

export type NotificationPresentationOptions = Readonly<{
  displayBudgetMs: number
  slot: 'transient' | 'persistent'
  content: 'native' | 'managed'
}>

export interface NotificationPresentationHandle {
  dismiss(): void
}

export interface NotificationPresenter {
  present(
    record: ObservableNotificationRecord,
    options: NotificationPresentationOptions,
    events: NotificationPresentationEvents
  ): NotificationPresentationHandle
}
