import { usePresenter } from '@/composables/usePresenter'
import { UPDATE_EVENTS } from '@/events'
import type { IPresenter, UpdateProgress } from '@shared/presenter'

type UpdateStatus = Awaited<ReturnType<IPresenter['upgradePresenter']['getUpdateStatus']>>
type UpdateInfo = UpdateStatus['updateInfo']
type DeviceInfo = Awaited<ReturnType<IPresenter['devicePresenter']['getDeviceInfo']>>

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type StatusChangedPayload = {
  status: UpdateStatus['status']
  type?: string
  info?: UpdateInfo
  error?: string | null
}

export type UpdateErrorPayload = {
  error?: string | null
}

export type UpgradeAdapter = {
  checkUpdate: () => Promise<void>
  getUpdateStatus: () => Promise<UpdateStatus>
  goDownloadUpgrade: (type: 'github' | 'netdisk') => Promise<void>
  startDownloadUpdate: () => Promise<boolean>
  restartToUpdate: () => Promise<boolean>
  getDeviceInfo: () => Promise<DeviceInfo>
  onStatusChanged: (handler: (payload: StatusChangedPayload) => void) => Unsubscribe
  onProgress: (handler: (payload: UpdateProgress) => void) => Unsubscribe
  onWillRestart: (handler: () => void) => Unsubscribe
  onError: (handler: (payload: UpdateErrorPayload) => void) => Unsubscribe
}

export function useUpgradeAdapter(): UpgradeAdapter {
  const upgradePresenter = usePresenter('upgradePresenter')
  const devicePresenter = usePresenter('devicePresenter')

  const subscribe = <T>(
    event: string,
    handler: (payload: T) => void,
    transform?: (...args: unknown[]) => T
  ): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (...args: unknown[]) => {
      const payload = transform ? transform(...args) : (args[1] as T)
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    checkUpdate: () => upgradePresenter.checkUpdate(),
    getUpdateStatus: () => Promise.resolve(upgradePresenter.getUpdateStatus()),
    goDownloadUpgrade: (type: 'github' | 'netdisk') => upgradePresenter.goDownloadUpgrade(type),
    startDownloadUpdate: () => Promise.resolve(upgradePresenter.startDownloadUpdate()),
    restartToUpdate: () => Promise.resolve(upgradePresenter.restartToUpdate()),
    getDeviceInfo: () => devicePresenter.getDeviceInfo(),
    onStatusChanged: (handler) => subscribe(UPDATE_EVENTS.STATUS_CHANGED, handler),
    onProgress: (handler) => subscribe(UPDATE_EVENTS.PROGRESS, handler),
    onWillRestart: (handler) =>
      subscribe<void>(
        UPDATE_EVENTS.WILL_RESTART,
        () => handler(),
        () => undefined
      ),
    onError: (handler) => subscribe(UPDATE_EVENTS.ERROR, handler)
  }
}
