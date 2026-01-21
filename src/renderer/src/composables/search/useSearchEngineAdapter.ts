import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'
import type { SearchEngineTemplate } from '@shared/chat'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type SearchEngineAdapter = {
  getSetting: <T>(key: string) => Promise<T | undefined>
  setSetting: <T>(key: string, value: T) => Promise<void>
  getCustomSearchEngines: () => Promise<SearchEngineTemplate[] | null>
  setCustomSearchEngines: (engines: SearchEngineTemplate[]) => Promise<void>
  getActiveEngine: () => Promise<SearchEngineTemplate | null>
  setActiveEngine: (engineId: string) => Promise<boolean>
  testEngine: (query: string) => Promise<boolean>
  onSearchEnginesUpdated: (handler: () => void) => Unsubscribe
}

export const useSearchEngineAdapter = (): SearchEngineAdapter => {
  const configPresenter = usePresenter('configPresenter')
  const searchPresenter = usePresenter('searchPresenter')

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
    getSetting: <T>(key: string) => Promise.resolve(configPresenter.getSetting<T>(key)),
    setSetting: <T>(key: string, value: T) =>
      Promise.resolve(configPresenter.setSetting<T>(key, value)),
    getCustomSearchEngines: () => Promise.resolve(configPresenter.getCustomSearchEngines()),
    setCustomSearchEngines: (engines: SearchEngineTemplate[]) =>
      Promise.resolve(configPresenter.setCustomSearchEngines(engines)),
    getActiveEngine: () => searchPresenter.getActiveEngine(),
    setActiveEngine: (engineId: string) => searchPresenter.setActiveEngine(engineId),
    testEngine: (query: string) => searchPresenter.testEngine(query),
    onSearchEnginesUpdated: (handler) =>
      subscribe<void>(CONFIG_EVENTS.SEARCH_ENGINES_UPDATED, () => handler())
  }
}
