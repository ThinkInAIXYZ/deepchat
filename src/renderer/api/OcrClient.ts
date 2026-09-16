import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  ocrCancelRuntimeInstallRoute,
  ocrClearCacheRoute,
  ocrGetRuntimeStatusRoute,
  ocrInstallRuntimeFromPathRoute,
  ocrInstallRuntimeRoute,
  ocrUninstallRuntimeRoute
} from '@shared/contracts/routes'
import { ocrRuntimeInstallProgressEvent, type DeepchatEventPayload } from '@shared/contracts/events'
import { getDeepchatBridge } from './core'

export function createOcrClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getRuntimeStatus() {
    return await bridge.invoke(ocrGetRuntimeStatusRoute.name, {})
  }

  async function clearCache() {
    return await bridge.invoke(ocrClearCacheRoute.name, {})
  }

  async function installRuntime() {
    return await bridge.invoke(ocrInstallRuntimeRoute.name, {})
  }

  async function cancelRuntimeInstall() {
    return await bridge.invoke(ocrCancelRuntimeInstallRoute.name, {})
  }

  async function installRuntimeFromPath(filePath: string) {
    return await bridge.invoke(ocrInstallRuntimeFromPathRoute.name, { path: filePath })
  }

  async function uninstallRuntime() {
    return await bridge.invoke(ocrUninstallRuntimeRoute.name, {})
  }

  function onRuntimeInstallProgress(
    listener: (payload: DeepchatEventPayload<typeof ocrRuntimeInstallProgressEvent.name>) => void
  ) {
    return bridge.on(ocrRuntimeInstallProgressEvent.name, listener)
  }

  return {
    getRuntimeStatus,
    clearCache,
    installRuntime,
    cancelRuntimeInstall,
    installRuntimeFromPath,
    uninstallRuntime,
    onRuntimeInstallProgress
  }
}

export type OcrClient = ReturnType<typeof createOcrClient>
