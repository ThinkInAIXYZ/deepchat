import {
  DATABASE_RECOVERY_CANCEL_CHANNEL,
  DATABASE_RECOVERY_REQUEST_CHANNEL,
  DATABASE_RECOVERY_SUBMIT_CHANNEL,
  DATABASE_UNLOCK_CANCEL_CHANNEL,
  DATABASE_UNLOCK_PROGRESS_CHANNEL,
  DATABASE_UNLOCK_REQUEST_CHANNEL,
  DATABASE_UNLOCK_SUBMIT_CHANNEL,
  type DatabaseRecoveryRequestPayload,
  type DatabaseRecoverySubmitPayload,
  type DatabaseUnlockProgressPayload,
  type DatabaseUnlockRequestPayload
} from '@shared/contracts/databaseSecurity'
import { SPLASH_DEBUG_MODE_CHANNEL, type SplashDebugMode } from '@shared/contracts/splash'
import { configGetLanguageRoute, type DeepchatRouteOutput } from '@shared/contracts/routes'

type SplashListener<TPayload> = (payload: TPayload) => void
type SplashLanguageState = DeepchatRouteOutput<typeof configGetLanguageRoute.name>

interface SplashActivityItem {
  key: string
  name: string
  status: 'running' | 'completed' | 'failed'
}

interface SplashUpdatePayload {
  activities?: SplashActivityItem[]
}

export type SplashApiPort = {
  on(channel: string, listener: SplashListener<unknown>): () => void
  send(channel: string, payload: unknown): void
  getLanguageState(): Promise<SplashLanguageState>
}

/**
 * Shared by Electron's contextBridge and the native preload. Only the two typed
 * transport adapters differ; request validation and replay behavior stay here.
 */
export function createSplashApi(port: SplashApiPort) {
  const onSplashChannel = <TPayload>(
    channel: string,
    listener: SplashListener<TPayload>
  ): (() => void) => port.on(channel, listener as SplashListener<unknown>)
  // Vue subscribes onMounted, after the main process may have sent several
  // ordered channels. Replay them together after that synchronous subscription
  // pass; replaying each channel independently would reverse progress and request.
  let sequence = 0
  let replayScheduled = false
  const replays: Array<{ sequence: number; deliver: () => void }> = []
  const onLatestSplashChannel = <TPayload>(channel: string) => {
    let latest: { payload: TPayload; sequence: number } | null = null
    onSplashChannel<TPayload>(channel, (payload) => {
      latest = { payload, sequence: ++sequence }
    })
    return (listener: SplashListener<TPayload>) => {
      let active = true
      let deliveredSequence = 0
      const unsubscribe = onSplashChannel<TPayload>(channel, (payload) => {
        deliveredSequence = sequence
        listener(payload)
      })
      const snapshot = latest
      if (snapshot !== null) {
        replays.push({
          sequence: snapshot.sequence,
          deliver: () => {
            if (active && deliveredSequence < snapshot.sequence) {
              deliveredSequence = snapshot.sequence
              listener(snapshot.payload)
            }
          }
        })
        if (!replayScheduled) {
          replayScheduled = true
          queueMicrotask(() => {
            replayScheduled = false
            const ordered = replays.splice(0).sort((left, right) => left.sequence - right.sequence)
            for (const replay of ordered) replay.deliver()
          })
        }
      }
      return () => {
        active = false
        unsubscribe()
      }
    }
  }
  const onDebugMode = onLatestSplashChannel<SplashDebugMode>(SPLASH_DEBUG_MODE_CHANNEL)
  const onUnlockRequest = onLatestSplashChannel<DatabaseUnlockRequestPayload>(
    DATABASE_UNLOCK_REQUEST_CHANNEL
  )
  const onUnlockProgress = onLatestSplashChannel<DatabaseUnlockProgressPayload>(
    DATABASE_UNLOCK_PROGRESS_CHANNEL
  )
  const onRecoveryRequest = onLatestSplashChannel<DatabaseRecoveryRequestPayload>(
    DATABASE_RECOVERY_REQUEST_CHANNEL
  )

  return Object.freeze({
    onUpdate: (listener: SplashListener<SplashUpdatePayload>) =>
      onSplashChannel('splash-update', listener),
    onUnlockRequest,
    onUnlockProgress,
    onRecoveryRequest,
    onDebugMode,
    getLanguageState: port.getLanguageState,
    submitUnlock: (payload: { requestId: string; password: string }) => {
      if (!payload.requestId || typeof payload.password !== 'string') {
        return
      }
      port.send(DATABASE_UNLOCK_SUBMIT_CHANNEL, payload)
    },
    cancelUnlock: (payload: { requestId: string }) => {
      if (!payload.requestId) {
        return
      }
      port.send(DATABASE_UNLOCK_CANCEL_CHANNEL, payload)
    },
    submitRecovery: (payload: DatabaseRecoverySubmitPayload) => {
      if (!payload.requestId) {
        return
      }
      if (payload.action === 'password' && typeof payload.password !== 'string') {
        return
      }
      port.send(DATABASE_RECOVERY_SUBMIT_CHANNEL, payload)
    },
    cancelRecovery: (payload: { requestId: string }) => {
      if (!payload.requestId) {
        return
      }
      port.send(DATABASE_RECOVERY_CANCEL_CHANNEL, payload)
    }
  })
}
