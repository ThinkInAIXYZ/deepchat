import {
  OperationRegistry,
  TimeoutNotificationScheduler,
  systemNotificationClock
} from '@shared/notifications'
import { NotificationManager } from './notificationManager'
import { NotificationPolicy } from './notificationPolicy'
import { SonnerNotificationPresenter } from './sonnerNotificationPresenter'
import { SurfaceFeedbackController } from './surfaceFeedbackController'
import { DocumentSurfaceVisibility } from './surfaceVisibility'

const scheduler = new TimeoutNotificationScheduler()
const policy = new NotificationPolicy()
const operations = new OperationRegistry(systemNotificationClock)

export const rendererNotificationManager = new NotificationManager({
  presenter: new SonnerNotificationPresenter(),
  clock: systemNotificationClock,
  scheduler,
  policy
})

export const createRendererSurfaceFeedbackController = (rendererId: string) =>
  new SurfaceFeedbackController({
    clock: systemNotificationClock,
    scheduler,
    operations,
    operationOwner: { process: 'renderer', rendererId },
    notifications: rendererNotificationManager,
    visibility: new DocumentSurfaceVisibility(),
    policy
  })
