import { ModelType } from '@shared/model'
import {
  resolveDerivedModelMaxTokens,
  resolveModelContextLength,
  resolveModelFunctionCall,
  resolveModelVision
} from '@shared/modelConfigDefaults'
import type { MODEL_META, RENDERER_MODEL_META } from '@shared/types/provider'

type ProviderCatalogProjectionInput = {
  providerId: string
  catalogModels: RENDERER_MODEL_META[]
  providerModels: MODEL_META[]
  customModels: MODEL_META[]
  resolveEffectiveModels: (models: MODEL_META[], providerId: string) => MODEL_META[]
  modelStatus: (modelIds: string[]) => Record<string, boolean>
}

const toCatalogIdentity = (model: RENDERER_MODEL_META): MODEL_META => ({
  id: model.id,
  name: model.name || model.id,
  group: model.group || 'default',
  providerId: model.providerId,
  isCustom: false,
  type: model.type
})

/**
 * Build the effective provider catalog from the three persisted sources. Catalog contents are
 * sparse provider facts, never a materialized effective projection.
 */
export function buildProviderCatalogModels(
  input: ProviderCatalogProjectionInput
): RENDERER_MODEL_META[] {
  const modelsById = new Map<string, MODEL_META>()
  const explicitFunctionCallById = new Map<string, boolean>()

  for (const catalogModel of input.catalogModels) {
    modelsById.set(catalogModel.id, toCatalogIdentity(catalogModel))
  }

  for (const providerModel of input.providerModels) {
    const normalized: MODEL_META = {
      ...providerModel,
      providerId: input.providerId,
      isCustom: providerModel.isCustom ?? false
    }
    const catalogModel = modelsById.get(normalized.id)
    modelsById.set(normalized.id, catalogModel ? { ...catalogModel, ...normalized } : normalized)
    if (typeof providerModel.functionCall === 'boolean') {
      explicitFunctionCallById.set(providerModel.id, providerModel.functionCall)
    }
  }

  for (const customModel of input.customModels) {
    const normalized: MODEL_META = {
      ...customModel,
      providerId: input.providerId,
      isCustom: true
    }
    const existing = modelsById.get(normalized.id)
    modelsById.set(
      normalized.id,
      existing ? { ...existing, ...normalized, isCustom: true } : normalized
    )
    if (typeof customModel.functionCall === 'boolean') {
      explicitFunctionCallById.set(customModel.id, customModel.functionCall)
    }
  }

  const resolvedModels = input.resolveEffectiveModels(
    Array.from(modelsById.values()),
    input.providerId
  )
  const modelStatus = input.modelStatus(resolvedModels.map((model) => model.id))

  return resolvedModels.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    group: model.group || 'default',
    providerId: input.providerId,
    enabled: modelStatus[model.id] ?? false,
    isCustom: model.isCustom ?? false,
    vision: resolveModelVision(model.vision),
    functionCall: resolveModelFunctionCall(model.functionCall),
    explicitFunctionCall: explicitFunctionCallById.get(model.id),
    reasoning: model.reasoning ?? false,
    enableSearch: model.enableSearch ?? false,
    type: (model.type ?? ModelType.Chat) as ModelType,
    contextLength: resolveModelContextLength(model.contextLength),
    maxTokens: resolveDerivedModelMaxTokens(model.maxTokens),
    description: model.description,
    supportedEndpointTypes: model.supportedEndpointTypes,
    selectableEndpointTypes: model.selectableEndpointTypes,
    endpointType: model.endpointType,
    ownedBy: model.ownedBy
  }))
}
