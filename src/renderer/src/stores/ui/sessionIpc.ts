import { SessionClient } from '../../../api/SessionClient'

interface BindSessionStoreIpcOptions {
  webContentsId: number | null
  fetchSessions: () => void | Promise<void>
  onActivated: (sessionId: string) => void
  onDeactivated: () => void
}

export function bindSessionStoreIpc(options: BindSessionStoreIpcOptions): () => void {
  const sessionClient = new SessionClient()

  return sessionClient.onUpdated((payload) => {
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
  })
}
