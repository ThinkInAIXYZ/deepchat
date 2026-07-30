import type { ScheduledNotificationTask } from '@shared/notifications'
import type { NotificationPresentationHandle } from './notificationPresenter'
import type { ObservableNotificationRecord } from './notificationRecord'
import type { NotificationRequest } from './notificationTypes'

export type NotificationEntryLocation =
  | 'transient'
  | 'transient-candidate'
  | 'persistent'
  | 'actionable-queue'
  | 'progress-waiting'
  | 'progress-suppressed'

export type ManagedNotificationEntry = {
  logicalId: string
  identity?: string
  request: NotificationRequest
  record: ObservableNotificationRecord
  priority: number
  displayBudgetMs: number
  maxLifetimeMs: number
  content: 'native' | 'managed'
  order: number
  location: NotificationEntryLocation
  presentation?: NotificationPresentationHandle
  deadlineTask?: ScheduledNotificationTask
  expiryTask?: ScheduledNotificationTask
  members?: Map<string, NotificationRequest>
  disposed: boolean
}
