import { TimeoutNotificationScheduler, systemNotificationClock } from '@shared/notifications'
import { NotificationManager } from './notificationManager'
import { NotificationPolicy } from './notificationPolicy'
import { SonnerNotificationPresenter } from './sonnerNotificationPresenter'

const scheduler = new TimeoutNotificationScheduler()
const policy = new NotificationPolicy()

export const rendererNotificationManager = new NotificationManager({
  presenter: new SonnerNotificationPresenter(),
  clock: systemNotificationClock,
  scheduler,
  policy
})
