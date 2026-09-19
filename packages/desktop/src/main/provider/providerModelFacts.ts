import { isProviderDbBackedProvider } from '@shared/providerDbCatalog'
import type { MODEL_META } from '@shared/types/provider'

const CATALOG_DERIVED_MODEL_FIELDS = [
  'contextLength',
  'maxTokens',
  'vision',
  'functionCall',
  'reasoning',
  'enableSearch',
  'type'
] as const satisfies ReadonlyArray<keyof MODEL_META>

export const RAW_PROVIDER_MODEL_FACTS_MIGRATION_ID = 'raw-provider-model-facts-v1'

export function hasPersistedDerivedProviderModelFields(
  model: Partial<MODEL_META>,
  providerId: string
): boolean {
  return (
    model.selectableEndpointTypes !== undefined ||
    (model.isCustom !== true &&
      isProviderDbBackedProvider(providerId) &&
      CATALOG_DERIVED_MODEL_FIELDS.some((key) => model[key] !== undefined))
  )
}

export function stripDerivedProviderModelFields(model: MODEL_META, providerId: string): MODEL_META {
  const providerFacts = { ...model }
  delete providerFacts.selectableEndpointTypes

  if (providerFacts.isCustom !== true && isProviderDbBackedProvider(providerId)) {
    for (const key of CATALOG_DERIVED_MODEL_FIELDS) {
      delete providerFacts[key]
    }
  }

  return providerFacts
}
