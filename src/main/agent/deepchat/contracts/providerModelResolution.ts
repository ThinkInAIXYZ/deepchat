import type {
  CapabilitySnapshotQuery,
  ResolvedCapabilityIdentity,
  ResolvedModelCapabilitySnapshot
} from '@shared/types/model-capabilities'
import type {
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  ModelRouteConfig
} from '@shared/types/provider'

type CapabilitySnapshotModelConfig = ModelRouteConfig & Partial<Pick<ModelConfig, 'reasoning'>>

export type CapabilitySnapshotResolutionInput =
  | (CapabilitySnapshotQuery & {
      resolvedModelConfig?: never
    })
  | {
      providerId: string
      modelId: string
      resolvedModelConfig: CapabilitySnapshotModelConfig
      routeOverride?: never
      reasoningEnabled?: never
    }

/**
 * Provider model resolution surface the built-in kernel needs. Declared here so kernel modules
 * depend on this structural port instead of the Desktop provider settings service; the host class
 * implements it.
 */
export interface ProviderModelResolutionPort {
  getProviderById(id: string): LLM_PROVIDER | undefined
  isKnownModel(providerId: string, modelId: string): boolean
  getModelConfig(
    modelId: string,
    providerId?: string,
    resolvedIdentity?: ResolvedCapabilityIdentity,
    providerFacts?: MODEL_META
  ): ModelConfig
  getCapabilitySnapshot(input: CapabilitySnapshotResolutionInput): ResolvedModelCapabilitySnapshot
  getProviderDbSourceUrl(): string
  supportsAudioInputCapability(providerId: string, modelId: string): boolean
}
