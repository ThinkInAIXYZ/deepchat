// === Vue Core ===
import { computed, watch, ref, type ComputedRef, type Ref } from 'vue'

// === Stores ===
import { useModelConfigStore } from '@/stores/modelConfigStore'

// === Interfaces ===
export interface UseModelTypeDetectionOptions {
  modelId: Ref<string | undefined>
  providerId: Ref<string | undefined>
  modelType: Ref<
    'chat' | 'imageGeneration' | 'videoGeneration' | 'tts' | 'embedding' | 'rerank' | undefined
  >
}

export interface UseModelTypeDetectionReturn {
  isImageGenerationModel: ComputedRef<boolean>
  isVideoGenerationModel: ComputedRef<boolean>
  isTtsModel: ComputedRef<boolean>
  modelReasoning: Ref<boolean>
}

/**
 * Composable for detecting model types and their special requirements
 * Handles model-specific UI logic and feature availability
 */
export function useModelTypeDetection(
  options: UseModelTypeDetectionOptions
): UseModelTypeDetectionReturn {
  const { modelId, providerId, modelType } = options
  const modelConfigStore = useModelConfigStore()

  // === Local State ===
  const modelReasoning = ref(false)
  let requestId = 0

  // === Computed Properties ===

  /**
   * Checks if current model is an image generation model
   */
  const isImageGenerationModel = computed(() => {
    return modelType.value === 'imageGeneration'
  })

  /**
   * Checks if current model is a video generation model
   */
  const isVideoGenerationModel = computed(() => {
    return modelType.value === 'videoGeneration'
  })

  /**
   * Checks if current model is a TTS model
   */
  const isTtsModel = computed(() => {
    return modelType.value === 'tts'
  })

  // === Internal Methods ===
  const fetchModelReasoning = async () => {
    const currentRequestId = ++requestId
    const currentModelId = modelId.value
    const currentProviderId = providerId.value

    if (!currentModelId || !currentProviderId) {
      modelReasoning.value = false
      return
    }

    try {
      const modelConfig = await modelConfigStore.getModelConfig(currentModelId, currentProviderId)
      if (currentRequestId !== requestId) return

      modelReasoning.value = modelConfig.reasoning || false
    } catch (error) {
      if (currentRequestId !== requestId) return

      modelReasoning.value = false
      console.error(error)
    }
  }

  // === Watchers ===
  watch(() => [modelId.value, providerId.value], fetchModelReasoning, { immediate: true })

  // === Return Public API ===
  return {
    isImageGenerationModel,
    isVideoGenerationModel,
    isTtsModel,
    modelReasoning
  }
}
