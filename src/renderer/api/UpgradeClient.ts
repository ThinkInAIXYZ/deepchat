import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  upgradeErrorEvent,
  upgradeProgressEvent,
  upgradeStatusChangedEvent,
  upgradeWillRestartEvent
} from '@shared/contracts/events'
import {
  upgradeCheckRoute,
  upgradeClearMockRoute,
  upgradeGetStatusRoute,
  upgradeMockDownloadedRoute,
  upgradeOpenDownloadRoute,
  upgradeRestartToUpdateRoute,
  upgradeStartDownloadRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export class UpgradeClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getUpdateStatus() {
    const result = await this.bridge.invoke(upgradeGetStatusRoute.name, {})
    return result.snapshot
  }

  async checkUpdate(type?: string) {
    await this.bridge.invoke(upgradeCheckRoute.name, { type })
  }

  async goDownloadUpgrade(type: 'github' | 'official') {
    await this.bridge.invoke(upgradeOpenDownloadRoute.name, { type })
  }

  async startDownloadUpdate() {
    const result = await this.bridge.invoke(upgradeStartDownloadRoute.name, {})
    return result.started
  }

  async mockDownloadedUpdate() {
    const result = await this.bridge.invoke(upgradeMockDownloadedRoute.name, {})
    return result.updated
  }

  async clearMockUpdate() {
    const result = await this.bridge.invoke(upgradeClearMockRoute.name, {})
    return result.updated
  }

  async restartToUpdate() {
    const result = await this.bridge.invoke(upgradeRestartToUpdateRoute.name, {})
    return result.restarted
  }

  onStatusChanged(
    listener: (payload: {
      status:
        | 'checking'
        | 'available'
        | 'not-available'
        | 'downloading'
        | 'downloaded'
        | 'error'
        | null
      error?: string | null
      info?: {
        version: string
        releaseDate: string
        releaseNotes: string
        githubUrl?: string
        downloadUrl?: string
        isMock?: boolean
      } | null
      type?: string
      version: number
    }) => void
  ) {
    return this.bridge.on(upgradeStatusChangedEvent.name, listener)
  }

  onProgress(
    listener: (payload: {
      bytesPerSecond: number
      percent: number
      transferred: number
      total: number
      version: number
    }) => void
  ) {
    return this.bridge.on(upgradeProgressEvent.name, listener)
  }

  onWillRestart(listener: (payload: { version: number }) => void) {
    return this.bridge.on(upgradeWillRestartEvent.name, listener)
  }

  onError(listener: (payload: { error: string; version: number }) => void) {
    return this.bridge.on(upgradeErrorEvent.name, listener)
  }
}
