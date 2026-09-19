import type { NotificationAction, NotificationKind } from './notificationTypes'

export type NotificationRecordSnapshot = Readonly<{
  logicalId: string
  code: string
  kind: NotificationKind
  title: string
  description?: string
  occurrenceCount: number
  entityCount: number
  pendingCount: number
  progress?: number
  action?: NotificationAction
  createdAt: number
  lastSeenAt: number
  version: number
}>

export type NotificationRecordListener = (snapshot: NotificationRecordSnapshot) => void

export class ObservableNotificationRecord {
  private readonly listeners = new Set<NotificationRecordListener>()
  private snapshot: NotificationRecordSnapshot

  constructor(initial: Omit<NotificationRecordSnapshot, 'version'>) {
    this.snapshot = Object.freeze({ ...initial, version: 0 })
  }

  getSnapshot(): NotificationRecordSnapshot {
    return this.snapshot
  }

  patch(
    patch: Partial<
      Omit<NotificationRecordSnapshot, 'logicalId' | 'code' | 'kind' | 'createdAt' | 'version'>
    >
  ): void {
    const entries = Object.entries(patch) as Array<
      [
        keyof Omit<
          NotificationRecordSnapshot,
          'logicalId' | 'code' | 'kind' | 'createdAt' | 'version'
        >,
        unknown
      ]
    >
    if (entries.every(([key, value]) => Object.is(this.snapshot[key], value))) {
      return
    }

    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...patch,
      version: this.snapshot.version + 1
    })
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(this.snapshot)
      } catch (error) {
        console.error('[ObservableNotificationRecord] listener failed', error)
      }
    }
  }

  subscribe(listener: NotificationRecordListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}
