import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS, PROVIDER_DB_EVENTS } from '@/events'
import type { KeyStatus, LLM_PROVIDER } from '@shared/presenter'

type Unsubscribe = () => void
type ProviderCheckResult = { isOk: boolean; errorMsg: string | null }

const noopUnsubscribe: Unsubscribe = () => undefined

export type ProviderAdapter = {
  getSetting: <T>(key: string) => Promise<T | undefined>
  setSetting: <T>(key: string, value: T) => Promise<void>
  setProviderById: (id: string, provider: LLM_PROVIDER) => Promise<void>
  updateProviderAtomic: (id: string, updates: Partial<LLM_PROVIDER>) => Promise<boolean>
  addProviderAtomic: (provider: LLM_PROVIDER) => Promise<void>
  removeProviderAtomic: (providerId: string) => Promise<void>
  reorderProvidersAtomic: (providers: LLM_PROVIDER[]) => Promise<void>
  checkProvider: (providerId: string, modelId?: string) => Promise<ProviderCheckResult>
  refreshProviderModels: (providerId: string) => Promise<void>
  getKeyStatus: (providerId: string) => Promise<KeyStatus | null>
  onProviderChanged: (handler: () => void) => Unsubscribe
  onProviderAtomicUpdate: (handler: () => void) => Unsubscribe
  onProviderBatchUpdate: (handler: () => void) => Unsubscribe
  onProviderDbUpdated: (handler: () => void) => Unsubscribe
  onProviderDbLoaded: (handler: () => void) => Unsubscribe
}

export function useProviderAdapter(): ProviderAdapter {
  const configPresenter = usePresenter('configPresenter')
  const llmPresenter = usePresenter('llmproviderPresenter')

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
    getSetting: <T>(key: string) => Promise.resolve(configPresenter.getSetting<T>(key)),
    setSetting: <T>(key: string, value: T) =>
      Promise.resolve(configPresenter.setSetting<T>(key, value)),
    setProviderById: (id: string, provider: LLM_PROVIDER) =>
      Promise.resolve(configPresenter.setProviderById(id, provider)),
    updateProviderAtomic: (id: string, updates: Partial<LLM_PROVIDER>) =>
      Promise.resolve(configPresenter.updateProviderAtomic(id, updates)),
    addProviderAtomic: (provider: LLM_PROVIDER) =>
      Promise.resolve(configPresenter.addProviderAtomic(provider)),
    removeProviderAtomic: (providerId: string) =>
      Promise.resolve(configPresenter.removeProviderAtomic(providerId)),
    reorderProvidersAtomic: (providers: LLM_PROVIDER[]) =>
      Promise.resolve(configPresenter.reorderProvidersAtomic(providers)),
    checkProvider: (providerId: string, modelId?: string) =>
      llmPresenter.check(providerId, modelId),
    refreshProviderModels: (providerId: string) => llmPresenter.refreshModels(providerId),
    getKeyStatus: (providerId: string) => llmPresenter.getKeyStatus(providerId),
    onProviderChanged: (handler) =>
      subscribe<void>(CONFIG_EVENTS.PROVIDER_CHANGED, handler, () => undefined),
    onProviderAtomicUpdate: (handler) =>
      subscribe<void>(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, handler, () => undefined),
    onProviderBatchUpdate: (handler) =>
      subscribe<void>(CONFIG_EVENTS.PROVIDER_BATCH_UPDATE, handler, () => undefined),
    onProviderDbUpdated: (handler) =>
      subscribe<void>(PROVIDER_DB_EVENTS.UPDATED, handler, () => undefined),
    onProviderDbLoaded: (handler) =>
      subscribe<void>(PROVIDER_DB_EVENTS.LOADED, handler, () => undefined)
  }
}
