import { SESSION_EVENTS } from '@/events'
import { createIpcSubscriptionScope } from '@/lib/ipcSubscription'

interface BindSessionStoreIpcOptions {
  webContentsId: number | null
  fetchSessions: () => void | Promise<void>
  onActivated: (sessionId: string) => void
  onDeactivated: () => void
  onStatusChanged: (payload: { sessionId: string; status: string }) => void
}

export function bindSessionStoreIpc(options: BindSessionStoreIpcOptions): () => void {
  const scope = createIpcSubscriptionScope()

  scope.on(SESSION_EVENTS.LIST_UPDATED, () => {
    void options.fetchSessions()
  })

  scope.on(
    SESSION_EVENTS.ACTIVATED,
    (_event, payload: { webContentsId: number; sessionId: string }) => {
      if (payload?.webContentsId !== options.webContentsId) {
        return
      }

      options.onActivated(payload.sessionId)
    }
  )

  scope.on(SESSION_EVENTS.DEACTIVATED, (_event, payload: { webContentsId: number }) => {
    if (payload?.webContentsId !== options.webContentsId) {
      return
    }

    options.onDeactivated()
  })

  scope.on(
    SESSION_EVENTS.STATUS_CHANGED,
    (_event, payload: { sessionId: string; status: string }) => {
      options.onStatusChanged(payload)
    }
  )

  return scope.cleanup
}
