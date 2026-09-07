import type { ProviderModelResolutionPort } from '@/provider/settings'
import type { ResolvedModelCapabilitySnapshot } from '@shared/types/model-capabilities'
import type { ModelConfig } from '@shared/types/provider'

export interface ProviderModelRuntimeFacts {
  serviceSelection: {
    providerId: string
    modelId: string
  }
  modelConfig: ModelConfig
  capabilitySnapshot: ResolvedModelCapabilitySnapshot
}

export type ProviderModelRuntimeFactsPort = Pick<
  ProviderModelResolutionPort,
  'getModelConfig' | 'getCapabilitySnapshot'
>

export function resolveProviderModelRuntimeFacts(
  providerSettings: ProviderModelRuntimeFactsPort,
  providerId: string,
  modelId: string,
  providedModelConfig?: ModelConfig
): ProviderModelRuntimeFacts {
  const modelConfig =
    providedModelConfig ??
    providerSettings.getModelConfig(modelId, providerId) ??
    ({} as ModelConfig)

  return {
    serviceSelection: { providerId, modelId },
    modelConfig,
    capabilitySnapshot: providerSettings.getCapabilitySnapshot({
      providerId,
      modelId,
      resolvedModelConfig: modelConfig
    })
  }
}

export function assertProviderModelRuntimeFacts(
  facts: ProviderModelRuntimeFacts,
  providerId: string,
  modelId: string
): void {
  if (
    facts.serviceSelection.providerId !== providerId ||
    facts.serviceSelection.modelId !== modelId
  ) {
    throw new Error(
      `Provider model facts for ${facts.serviceSelection.providerId}/${facts.serviceSelection.modelId} cannot be used for ${providerId}/${modelId}.`
    )
  }
}
