/// <reference types="vite/client" />
import type {
  DatabaseRecoveryRequestPayload,
  DatabaseRecoverySubmitPayload,
  DatabaseUnlockProgressPayload,
  DatabaseUnlockRequestPayload
} from '@shared/contracts/databaseSecurity'
import type { SplashDebugMode } from '@shared/contracts/splash'
import type { RendererLanguageState } from '../src/i18n/bootstrap'

interface SplashActivityItem {
  key: string
  name: string
  status: 'running' | 'completed' | 'failed'
}

interface SplashUpdatePayload {
  activities?: SplashActivityItem[]
}

interface DeepchatSplashApi {
  onUpdate(listener: (payload: SplashUpdatePayload) => void): () => void
  onUnlockRequest(listener: (payload: DatabaseUnlockRequestPayload) => void): () => void
  onUnlockProgress(listener: (payload: DatabaseUnlockProgressPayload) => void): () => void
  onRecoveryRequest(listener: (payload: DatabaseRecoveryRequestPayload) => void): () => void
  onDebugMode(listener: (mode: SplashDebugMode) => void): () => void
  getLanguageState(): Promise<RendererLanguageState>
  submitUnlock(payload: { requestId: string; password: string }): void
  cancelUnlock(payload: { requestId: string }): void
  submitRecovery(payload: DatabaseRecoverySubmitPayload): void
  cancelRecovery(payload: { requestId: string }): void
}

declare global {
  interface Window {
    deepchatSplash: DeepchatSplashApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}
export {}
