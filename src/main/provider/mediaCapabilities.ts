import { ApiEndpointType, ModelType, isOpenAIImageGenerationModelId } from '@shared/model'
import type { NewApiEndpointType } from '@shared/model'
import type { ModelRouteConfig } from '@shared/types/provider'
import type { MediaSettingsCapabilities } from '@shared/types/model-capabilities'
import { isVideoGenerationModelConfig } from '@shared/videoGenerationSettings'
import type { AiSdkProviderKind } from './aiSdk/providerFactory'

// The caller supplies the effective transport, never the capability/catalog owner.
export function resolveMediaSettingsCapabilities(
  providerKind: AiSdkProviderKind | undefined,
  modelId: string,
  modelConfig: ModelRouteConfig,
  endpointType?: NewApiEndpointType | 'grok-image',
  grokImageProtocol = false
): MediaSettingsCapabilities {
  // Azure routes image requests only through an explicit Image endpoint, including
  // deployment aliases that do not carry an image model name.
  if (providerKind === 'azure') {
    return { image: modelConfig.apiEndpoint === ApiEndpointType.Image, video: false }
  }

  const openAIImageTransport =
    providerKind === 'openai-compatible' ||
    providerKind === 'openai-responses' ||
    providerKind === 'openai-codex'
  const openAIVideoTransport =
    providerKind === 'openai-compatible' || providerKind === 'openai-responses'

  return {
    image:
      openAIImageTransport &&
      !grokImageProtocol &&
      endpointType !== 'grok-image' &&
      endpointType !== 'video-generation' &&
      (endpointType === 'image-generation' ||
        modelConfig.apiEndpoint === ApiEndpointType.Image ||
        modelConfig.type === ModelType.ImageGeneration ||
        isOpenAIImageGenerationModelId(modelId)),
    video:
      openAIVideoTransport &&
      endpointType !== 'grok-image' &&
      endpointType !== 'image-generation' &&
      (endpointType === 'video-generation' || isVideoGenerationModelConfig(modelConfig, modelId))
  }
}
