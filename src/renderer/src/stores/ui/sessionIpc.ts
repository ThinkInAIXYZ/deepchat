import { SessionClient } from '../../../api/SessionClient'
import { onLegacyIpcChannel } from '@api/legacy/runtime'
import { SESSION_EVENTS } from '@/events'

interface BindSessionStoreIpcOptions {
  webContentsId: number | null
  fetchSessions: () => void | Promise<void>
  onActivated: (sessionId: string) => void
  onDeactivated: () => void
  onStatusChanged: (sessionId: string, status: string) => void
}

export function bindSessionStoreIpc(options: BindSessionStoreIpcOptions): () => void {
  const sessionClient = new SessionClient()
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
        payload.reason === 'updated' ||
        payload.reason === 'deleted'
      ) {
        void options.fetchSessions()
      }
    }),
    onLegacyIpcChannel(
      SESSION_EVENTS.STATUS_CHANGED,
      (_event, payload?: { sessionId?: string; status?: string }) => {
        if (!payload?.sessionId || !payload?.status) {
          return
        }

        options.onStatusChanged(payload.sessionId, payload.status)
      }
    )
  ]

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
