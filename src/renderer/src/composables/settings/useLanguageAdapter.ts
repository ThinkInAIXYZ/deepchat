import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type LanguageAdapter = {
  getLanguageSetting: () => Promise<string | null>
  getLanguage: () => Promise<string>
  setLanguage: (language: string) => Promise<void>
  onLanguageChanged: (handler: (language: string) => void) => Unsubscribe
}

export function useLanguageAdapter(): LanguageAdapter {
  const configPresenter = usePresenter('configPresenter')

  const subscribe = (event: string, handler: (payload: string) => void): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (_event: unknown, payload: string) => {
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    getLanguageSetting: () =>
      Promise.resolve(configPresenter.getSetting<string>('language') ?? null),
    getLanguage: () => Promise.resolve(configPresenter.getLanguage()),
    setLanguage: (language: string) => Promise.resolve(configPresenter.setLanguage(language)),
    onLanguageChanged: (handler) => subscribe(CONFIG_EVENTS.LANGUAGE_CHANGED, handler)
  }
}
