import { usePresenter } from '@/composables/usePresenter'
import { WINDOW_EVENTS } from '@/events'
import type { DeviceInfo } from '@shared/presenter'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type WindowAdapter = {
  previewFile: (filePath: string) => void
  openSettingsTab: () => void
  getDeviceInfo: () => Promise<DeviceInfo>
  onWindowMaximized: (handler: () => void) => Unsubscribe
  onWindowUnmaximized: (handler: () => void) => Unsubscribe
  onWindowEnterFullScreen: (handler: () => void) => Unsubscribe
  onWindowLeaveFullScreen: (handler: () => void) => Unsubscribe
  onAppFocus: (handler: () => void) => Unsubscribe
  onAppBlur: (handler: () => void) => Unsubscribe
}

export function useWindowAdapter(): WindowAdapter {
  const windowPresenter = usePresenter('windowPresenter')
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

  const previewFile = (filePath: string) => {
    return windowPresenter.previewFile(filePath)
  }

  const openSettingsTab = () => {
    const windowId = window.api.getWindowId()
    if (windowId != null) {
      windowPresenter.openOrFocusSettingsTab(windowId)
    }
  }

  return {
    previewFile,
    openSettingsTab,
    getDeviceInfo: () => devicePresenter.getDeviceInfo(),
    onWindowMaximized: (handler) =>
      subscribe<void>(WINDOW_EVENTS.WINDOW_MAXIMIZED, handler, () => undefined),
    onWindowUnmaximized: (handler) =>
      subscribe<void>(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, handler, () => undefined),
    onWindowEnterFullScreen: (handler) =>
      subscribe<void>(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN, handler, () => undefined),
    onWindowLeaveFullScreen: (handler) =>
      subscribe<void>(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN, handler, () => undefined),
    onAppFocus: (handler) => subscribe<void>(WINDOW_EVENTS.APP_FOCUS, handler, () => undefined),
    onAppBlur: (handler) => subscribe<void>(WINDOW_EVENTS.APP_BLUR, handler, () => undefined)
  }
}
