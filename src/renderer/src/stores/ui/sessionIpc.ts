import { createSessionClient } from '../../../api/SessionClient'

interface BindSessionStoreIpcOptions {
  webContentsId: number | null
  fetchSessions: () => void | Promise<void>
  refreshSessionsByIds: (sessionIds: string[]) => void | Promise<void>
  removeSessions: (sessionIds: string[]) => void
  onActivated: (sessionId: string) => void
  onDeactivated: () => void
  onStatusChanged: (sessionId: string, status: string) => void
}

export function bindSessionStoreIpc(options: BindSessionStoreIpcOptions): () => void {
  const sessionClient = createSessionClient()
  const cleanups = [
    sessionClient.onUpdated((payload) => {
      if (
        payload.reason === 'activated' &&
        payload.activeSessionId &&
        payload.webContentsId === options.webContentsId
      ) {
        options.onActivated(payload.activeSessionId)
        return
      }

      if (payload.reason === 'deactivated' && payload.webContentsId === options.webContentsId) {
        options.onDeactivated()
        return
      }

      if (
        payload.reason === 'created' ||
        payload.reason === 'list-refreshed' ||
        payload.reason === 'updated'
      ) {
        if (payload.sessionIds.length > 0) {
          void options.refreshSessionsByIds(payload.sessionIds)
          return
        }

        void options.fetchSessions()
        return
      }

      if (payload.reason === 'deleted') {
        options.removeSessions(payload.sessionIds)
        if (payload.sessionIds.length === 0) {
          void options.fetchSessions()
        }
      }
    }),
    sessionClient.onStatusChanged((payload) => {
      options.onStatusChanged(payload.sessionId, payload.status)
    })
  ]

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
