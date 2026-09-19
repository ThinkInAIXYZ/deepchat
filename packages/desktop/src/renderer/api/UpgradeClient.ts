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

export function createUpgradeClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getUpdateStatus() {
    const result = await bridge.invoke(upgradeGetStatusRoute.name, {})
    return result.snapshot
  }

  async function checkUpdate(type?: string) {
    await bridge.invoke(upgradeCheckRoute.name, { type })
  }

  async function goDownloadUpgrade(type: 'github' | 'official') {
    await bridge.invoke(upgradeOpenDownloadRoute.name, { type })
  }

  async function startDownloadUpdate() {
    const result = await bridge.invoke(upgradeStartDownloadRoute.name, {})
    return result.started
  }

  async function mockDownloadedUpdate() {
    const result = await bridge.invoke(upgradeMockDownloadedRoute.name, {})
    return result.updated
  }

  async function clearMockUpdate() {
    const result = await bridge.invoke(upgradeClearMockRoute.name, {})
    return result.updated
  }

  async function restartToUpdate() {
    const result = await bridge.invoke(upgradeRestartToUpdateRoute.name, {})
    return result.restarted
  }

  function onStatusChanged(
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
    return bridge.on(upgradeStatusChangedEvent.name, listener)
  }

  function onProgress(
    listener: (payload: {
      bytesPerSecond: number
      percent: number
      transferred: number
      total: number
      version: number
    }) => void
  ) {
    return bridge.on(upgradeProgressEvent.name, listener)
  }

  function onWillRestart(listener: (payload: { version: number }) => void) {
    return bridge.on(upgradeWillRestartEvent.name, listener)
  }

  function onError(listener: (payload: { error: string; version: number }) => void) {
    return bridge.on(upgradeErrorEvent.name, listener)
  }

  return {
    getUpdateStatus,
    checkUpdate,
    goDownloadUpgrade,
    startDownloadUpdate,
    mockDownloadedUpdate,
    clearMockUpdate,
    restartToUpdate,
    onStatusChanged,
    onProgress,
    onWillRestart,
    onError
  }
}

export type UpgradeClient = ReturnType<typeof createUpgradeClient>
