import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { createBridge } from './createBridge'
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
import { configGetLanguageRoute } from '@shared/contracts/routes/config.routes'

interface SplashActivityItem {
  key: string
  name: string
  status: 'running' | 'completed' | 'failed'
}

interface SplashUpdatePayload {
  activities?: SplashActivityItem[]
}

type SplashListener<TPayload> = (payload: TPayload) => void

function onSplashChannel<TPayload>(
  channel: string,
  listener: SplashListener<TPayload>
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: TPayload) => {
    listener(payload)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const bridge = createBridge(ipcRenderer)
let latestDebugMode: SplashDebugMode | null = null

ipcRenderer.on(SPLASH_DEBUG_MODE_CHANNEL, (_event: IpcRendererEvent, mode: SplashDebugMode) => {
  latestDebugMode = mode
})

const splashApi = Object.freeze({
  onUpdate: (listener: SplashListener<SplashUpdatePayload>) =>
    onSplashChannel('splash-update', listener),
  onUnlockRequest: (listener: SplashListener<DatabaseUnlockRequestPayload>) =>
    onSplashChannel(DATABASE_UNLOCK_REQUEST_CHANNEL, listener),
  onUnlockProgress: (listener: SplashListener<DatabaseUnlockProgressPayload>) =>
    onSplashChannel(DATABASE_UNLOCK_PROGRESS_CHANNEL, listener),
  onRecoveryRequest: (listener: SplashListener<DatabaseRecoveryRequestPayload>) =>
    onSplashChannel(DATABASE_RECOVERY_REQUEST_CHANNEL, listener),
  onDebugMode: (listener: SplashListener<SplashDebugMode>) => {
    const unsubscribe = onSplashChannel(SPLASH_DEBUG_MODE_CHANNEL, listener)
    if (latestDebugMode) {
      listener(latestDebugMode)
    }
    return unsubscribe
  },
  getLanguageState: async () => await bridge.invoke(configGetLanguageRoute.name, {}),
  submitUnlock: (payload: { requestId: string; password: string }) => {
    if (!payload.requestId || typeof payload.password !== 'string') {
      return
    }
    ipcRenderer.send(DATABASE_UNLOCK_SUBMIT_CHANNEL, payload)
  },
  cancelUnlock: (payload: { requestId: string }) => {
    if (!payload.requestId) {
      return
    }
    ipcRenderer.send(DATABASE_UNLOCK_CANCEL_CHANNEL, payload)
  },
  submitRecovery: (payload: DatabaseRecoverySubmitPayload) => {
    if (!payload.requestId) {
      return
    }
    if (payload.action === 'password' && typeof payload.password !== 'string') {
      return
    }
    ipcRenderer.send(DATABASE_RECOVERY_SUBMIT_CHANNEL, payload)
  },
  cancelRecovery: (payload: { requestId: string }) => {
    if (!payload.requestId) {
      return
    }
    ipcRenderer.send(DATABASE_RECOVERY_CANCEL_CHANNEL, payload)
  }
})

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('deepchatSplash', splashApi)
} else {
  // @ts-ignore (defined for the splash renderer)
  window.deepchatSplash = splashApi
}

window.addEventListener('DOMContentLoaded', () => {
  webFrame.setVisualZoomLevelLimits(1, 1)
  webFrame.setZoomFactor(1)
})
