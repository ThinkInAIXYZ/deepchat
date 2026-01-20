import { ModelType } from '@shared/model'
import type { RENDERER_MODEL_META } from '@shared/presenter'

export type ProviderCatalogEntry = {
  id: string
  name: string
  models: RENDERER_MODEL_META[]
}

export type ModelCatalogFilters = {
  types?: ModelType[]
  requiresVision?: boolean
  mode?: string
  excludeProviders?: string[]
}

type ProviderItem = { id: string; name: string; enable?: boolean }

export const buildSelectableProviderCatalog = (
  providers: ProviderItem[],
  enabledModelGroups: Array<{ providerId: string; models: RENDERER_MODEL_META[] }>,
  filters: ModelCatalogFilters = {}
): ProviderCatalogEntry[] => {
  const typeFilter = filters.types ?? []
  const excludeSet = new Set(filters.excludeProviders ?? [])
  const requiresVision = filters.requiresVision ?? false
  const mode = filters.mode

  return providers
    .filter((provider) => provider.enable !== false)
    .filter((provider) => !excludeSet.has(provider.id))
    .filter((provider) => {
      if (!mode) return true
      if (mode === 'acp agent') return provider.id === 'acp'
      return provider.id !== 'acp'
    })
    .map((provider) => {
      const enabledProvider = enabledModelGroups.find((entry) => entry.providerId === provider.id)
      if (!enabledProvider || enabledProvider.models.length === 0) {
        return null
      }

      const byType =
        typeFilter.length === 0
          ? enabledProvider.models
          : enabledProvider.models.filter(
              (model) => model.type !== undefined && typeFilter.includes(model.type as ModelType)
            )

      const eligibleModels = requiresVision ? byType.filter((model) => model.vision) : byType

      if (eligibleModels.length === 0) return null

      return {
        id: provider.id,
        name: provider.name,
        models: eligibleModels
      }
    })
    .filter((provider): provider is ProviderCatalogEntry => provider !== null)
}
