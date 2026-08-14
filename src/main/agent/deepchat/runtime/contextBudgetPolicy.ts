import type { ModelConfig } from '@shared/types/provider'
import { ApiEndpointType, ModelType } from '@shared/model'
import { isTtsModelId } from '@shared/ttsSettings'
import { isVideoGenerationModelConfig } from '@shared/videoGenerationSettings'

export type ContextBudgetModelConfig = Pick<
  ModelConfig,
  'apiEndpoint' | 'endpointType' | 'type'
>

export function shouldUseDeepChatContextBudget(
  providerId?: string | null,
  modelConfig?: ContextBudgetModelConfig | null,
  modelId?: string | null
): boolean {
  if (providerId?.trim() === 'acp') {
    return false
  }

  if (!modelConfig) {
    return true
  }

  if (modelConfig.type === ModelType.ImageGeneration || modelConfig.type === ModelType.TTS) {
    return false
  }

  if (modelConfig.apiEndpoint && modelConfig.apiEndpoint !== ApiEndpointType.Chat) {
    return false
  }

  if (modelConfig.endpointType === 'image-generation') {
    return false
  }

  if (isVideoGenerationModelConfig(modelConfig, modelId?.trim() || '')) {
    return false
  }

  return true
}

export function shouldBypassDeepChatContextBudget(
  providerId?: string | null,
  modelConfig?: ContextBudgetModelConfig | null,
  modelId?: string | null
): boolean {
  return !shouldUseDeepChatContextBudget(providerId, modelConfig, modelId)
}

/** Tool Surface diagnostics currently apply only to native chat routes with local tool payloads. */
export function shouldObserveToolSurfaceShadow(
  providerId?: string | null,
  modelConfig?: ContextBudgetModelConfig | null,
  modelId?: string | null
): boolean {
  if (!modelConfig || modelConfig.type !== ModelType.Chat || isTtsModelId(modelId ?? '')) {
    return false
  }
  return shouldUseDeepChatContextBudget(providerId, modelConfig, modelId)
}

/** Production Tool Surface Views require provider-native function calling, not prompt emulation. */
export function shouldUseNativeToolSurface(
  providerId?: string | null,
  modelConfig?: (ContextBudgetModelConfig & Pick<ModelConfig, 'functionCall'>) | null,
  modelId?: string | null
): boolean {
  return (
    modelConfig?.functionCall === true &&
    shouldObserveToolSurfaceShadow(providerId, modelConfig, modelId)
  )
}

export function resolveDeepChatContextBudgetLength(
  providerId: string | null | undefined,
  contextLength: number,
  modelConfig?: ContextBudgetModelConfig | null,
  modelId?: string | null
): number {
  return shouldBypassDeepChatContextBudget(providerId, modelConfig, modelId)
    ? Number.MAX_SAFE_INTEGER
    : contextLength
}
