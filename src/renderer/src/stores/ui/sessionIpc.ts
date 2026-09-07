import { createSessionClient } from '../../../api/SessionClient'
import type { DeepchatEventPayload } from '@shared/contracts/events'

export type SessionCompactionChangedPayload = DeepchatEventPayload<'sessions.compaction.changed'>

interface BindSessionStoreIpcOptions {
  webContentsId: () => number | null
  fetchSessions: () => void | Promise<void>
  refreshSessionsByIds: (sessionIds: string[]) => void | Promise<void>
  removeSessions: (sessionIds: string[]) => void
  onActivated: (sessionId: string) => void | Promise<void>
  onDeactivated: () => void
  onStatusChanged: (sessionId: string, status: string, version: number) => void
  onCompactionChanged: (payload: SessionCompactionChangedPayload) => void
}

type TargetedSessionUpdate = {
  reason: 'activated' | 'deactivated'
  webContentsId: number
  activeSessionId?: string | null
}

export interface SessionStoreIpcBinding {
  cleanup: () => void
  flushPendingTargetedUpdate: () => void
}

export function bindSessionStoreIpc(options: BindSessionStoreIpcOptions): SessionStoreIpcBinding {
  const sessionClient = createSessionClient()
  const pendingTargetedUpdates = new Map<number, TargetedSessionUpdate>()

  const applyTargetedUpdate = (payload: TargetedSessionUpdate): void => {
    const webContentsId = options.webContentsId()
    if (webContentsId === null) {
      pendingTargetedUpdates.set(payload.webContentsId, payload)
      return
    }

    if (payload.webContentsId !== webContentsId) return

    if (payload.reason === 'activated' && payload.activeSessionId) {
      void options.onActivated(payload.activeSessionId)
      return
    }

    if (payload.reason === 'deactivated') {
      options.onDeactivated()
    }
  }

  const flushPendingTargetedUpdate = (): void => {
    const webContentsId = options.webContentsId()
    if (webContentsId === null) return

    const pendingUpdate = pendingTargetedUpdates.get(webContentsId)
    pendingTargetedUpdates.clear()
    if (pendingUpdate) {
      applyTargetedUpdate(pendingUpdate)
    }
  }

  const cleanups = [
    sessionClient.onUpdated((payload) => {
      if (
        (payload.reason === 'activated' || payload.reason === 'deactivated') &&
        typeof payload.webContentsId === 'number'
      ) {
        applyTargetedUpdate({
          reason: payload.reason,
          webContentsId: payload.webContentsId,
          activeSessionId: payload.activeSessionId
        })
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
      options.onStatusChanged(payload.sessionId, payload.status, payload.version)
    }),
    sessionClient.onCompactionChanged((payload) => {
      options.onCompactionChanged(payload)
    })
  ]

  return {
    flushPendingTargetedUpdate,
    cleanup: () => {
      pendingTargetedUpdates.clear()
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }
}
