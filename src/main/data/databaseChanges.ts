import type Database from 'better-sqlite3-multiple-ciphers'

const listeners = new Map<string, Set<() => void>>()
const queued = new Set<string>()

/** Trigger notifications wake readers after the synchronous write transaction has finished. */
export function configureDatabaseChangeNotification(db: Database.Database): void {
  db.function('deepchat_sync_notify', () => {
    const name = db.name
    if (!queued.has(name)) {
      queued.add(name)
      queueMicrotask(() => {
        queued.delete(name)
        for (const listener of listeners.get(name) ?? []) {
          try {
            listener()
          } catch (error) {
            console.warn('[Sync] Change notification failed', error)
          }
        }
      })
    }
    return 0
  })
}

export function subscribeDatabaseChanges(name: string, listener: () => void): () => void {
  let subscribers = listeners.get(name)
  if (!subscribers) listeners.set(name, (subscribers = new Set()))
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
    if (!subscribers.size) listeners.delete(name)
  }
}
