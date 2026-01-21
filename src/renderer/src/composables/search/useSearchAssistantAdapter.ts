import { usePresenter } from '@/composables/usePresenter'
import type { RENDERER_MODEL_META } from '@shared/presenter'

export type SearchAssistantAdapter = {
  getSetting: <T>(key: string) => Promise<T | undefined>
  setSetting: <T>(key: string, value: T) => Promise<void>
  setSearchAssistantModel: (model: RENDERER_MODEL_META, providerId: string) => Promise<void>
}

export const useSearchAssistantAdapter = (): SearchAssistantAdapter => {
  const configPresenter = usePresenter('configPresenter')
  const searchPresenter = usePresenter('searchPresenter')

  return {
    getSetting: <T>(key: string) => Promise.resolve(configPresenter.getSetting<T>(key)),
    setSetting: <T>(key: string, value: T) =>
      Promise.resolve(configPresenter.setSetting<T>(key, value)),
    setSearchAssistantModel: (model: RENDERER_MODEL_META, providerId: string) =>
      Promise.resolve(searchPresenter.setSearchAssistantModel(model, providerId))
  }
}
