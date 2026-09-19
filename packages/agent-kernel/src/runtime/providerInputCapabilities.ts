import {
  assertProviderModelRuntimeFacts,
  resolveProviderModelRuntimeFacts,
  type ProviderModelRuntimeFacts,
  type ProviderModelRuntimeFactsPort
} from './providerModelRuntimeFacts.js'
import { type ProviderModelResolutionPort } from '../contracts/providerModelResolution.js'

export interface ProviderInputCapabilities {
  supportsVision: boolean
  supportsAudioInput: boolean
}

type VisionCapabilityPort = Pick<ProviderModelResolutionPort, 'getModelConfig'>
type AudioInputCapabilityPort = Pick<ProviderModelResolutionPort, 'supportsAudioInputCapability'>

export function supportsProviderVision(
  providerSettings: VisionCapabilityPort,
  providerId: string,
  modelId: string
): boolean {
  return Boolean(providerSettings.getModelConfig(modelId, providerId)?.vision)
}

export function supportsProviderAudioInput(
  providerSettings: AudioInputCapabilityPort,
  providerId: string,
  modelId: string
): boolean {
  return providerSettings.supportsAudioInputCapability(providerId, modelId)
}

export function resolveProviderInputCapabilities(
  providerSettings: ProviderModelRuntimeFactsPort,
  providerId: string,
  modelId: string,
  providedFacts?: ProviderModelRuntimeFacts
): ProviderInputCapabilities {
  const facts =
    providedFacts ?? resolveProviderModelRuntimeFacts(providerSettings, providerId, modelId)
  assertProviderModelRuntimeFacts(facts, providerId, modelId)

  return {
    supportsVision: Boolean(facts.modelConfig.vision),
    supportsAudioInput: facts.capabilitySnapshot.supportsAudioInput
  }
}
