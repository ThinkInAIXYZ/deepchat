import { usePresenter } from '@/composables/usePresenter'
import { FLOATING_BUTTON_EVENTS } from '@/events'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type FloatingButtonAdapter = {
  getFloatingButtonEnabled: () => Promise<boolean>
  setFloatingButtonEnabled: (value: boolean) => Promise<void>
  onEnabledChanged: (handler: (value: boolean) => void) => Unsubscribe
}

export function useFloatingButtonAdapter(): FloatingButtonAdapter {
  const configPresenter = usePresenter('configPresenter')

  const subscribe = <T>(event: string, handler: (payload: T) => void): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (_event: unknown, payload: T) => {
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    getFloatingButtonEnabled: () => Promise.resolve(configPresenter.getFloatingButtonEnabled()),
    setFloatingButtonEnabled: (value: boolean) =>
      Promise.resolve(configPresenter.setFloatingButtonEnabled(value)),
    onEnabledChanged: (handler) =>
      subscribe<boolean>(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, handler)
  }
}
