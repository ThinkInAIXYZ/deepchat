import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS, SYSTEM_EVENTS } from '@/events'
import type { ThemeMode } from '@/composables/settings/types'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type ThemeAdapter = {
  getTheme: () => Promise<ThemeMode>
  getCurrentThemeIsDark: () => Promise<boolean>
  setTheme: (mode: ThemeMode) => Promise<boolean>
  onSystemThemeUpdated: (handler: (isDark: boolean) => void) => Unsubscribe
  onThemeChanged: (handler: (mode: ThemeMode) => void) => Unsubscribe
}

export function useThemeAdapter(): ThemeAdapter {
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
    getTheme: () => configPresenter.getTheme() as Promise<ThemeMode>,
    getCurrentThemeIsDark: () => configPresenter.getCurrentThemeIsDark(),
    setTheme: (mode: ThemeMode) => configPresenter.setTheme(mode),
    onSystemThemeUpdated: (handler) =>
      subscribe<boolean>(SYSTEM_EVENTS.SYSTEM_THEME_UPDATED, handler),
    onThemeChanged: (handler) => subscribe<ThemeMode>(CONFIG_EVENTS.THEME_CHANGED, handler)
  }
}
