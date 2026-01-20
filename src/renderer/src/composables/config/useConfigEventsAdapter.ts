import { CONFIG_EVENTS } from '@/events'

export function useConfigEventsAdapter() {
  const subscribeModelListChanged = (handler: (providerId?: string) => void) => {
    const listener = (_: unknown, providerId?: string) => {
      handler(providerId)
    }

    window.electron.ipcRenderer.on(CONFIG_EVENTS.MODEL_LIST_CHANGED, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(CONFIG_EVENTS.MODEL_LIST_CHANGED, listener)
    }
  }

  return {
    subscribeModelListChanged
  }
}
