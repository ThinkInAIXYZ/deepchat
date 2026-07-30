import { markRaw } from 'vue'
import { toast } from 'vue-sonner'
import ManagedNotificationToast from './ManagedNotificationToast.vue'
import type {
  NotificationPresentationEvents,
  NotificationPresentationHandle,
  NotificationPresentationOptions,
  NotificationPresenter
} from './notificationPresenter'
import type { ObservableNotificationRecord } from './notificationRecord'

const managedNotificationComponent = markRaw(ManagedNotificationToast)

export class SonnerNotificationPresenter implements NotificationPresenter {
  present(
    record: ObservableNotificationRecord,
    options: NotificationPresentationOptions,
    events: NotificationPresentationEvents
  ): NotificationPresentationHandle {
    let finalized = false
    const finalize = (reason: Parameters<NotificationPresentationEvents['onClosed']>[0]) => {
      if (finalized) return
      finalized = true
      events.onClosed(reason)
    }

    const lifecycle = {
      duration: options.displayBudgetMs,
      onDismiss: () => finalize('dismissed'),
      onAutoClose: () => finalize('auto')
    }
    const snapshot = record.getSnapshot()
    const id =
      options.content === 'native'
        ? this.presentNative(snapshot, lifecycle)
        : toast.custom(managedNotificationComponent, {
            ...lifecycle,
            componentProps: {
              record: markRaw(record),
              onAction: () => finalize('action')
            }
          })

    return Object.freeze({
      dismiss: () => {
        if (finalized) return
        finalized = true
        toast.dismiss(id)
      }
    })
  }

  private presentNative(
    snapshot: ReturnType<ObservableNotificationRecord['getSnapshot']>,
    lifecycle: {
      duration: number
      onDismiss: () => void
      onAutoClose: () => void
    }
  ): string | number {
    const options = {
      ...lifecycle,
      description: snapshot.description
    }
    if (snapshot.kind === 'success') {
      return toast.success(snapshot.title, options)
    }
    if (snapshot.kind === 'info') {
      return toast.info(snapshot.title, options)
    }
    throw new Error(`Native notification content does not support kind "${snapshot.kind}"`)
  }
}
