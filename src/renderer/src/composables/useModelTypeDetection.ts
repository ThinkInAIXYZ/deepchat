// === Vue Core ===
import { computed, watch, ref, type ComputedRef, type Ref } from 'vue'

// === Stores ===
import { useSettingsStore } from '@/stores/settings'

// === Interfaces ===
export interface UseModelTypeDetectionOptions {
  modelId: Ref<string | undefined>
  providerId: Ref<string | undefined>
  modelType: Ref<'chat' | 'imageGeneration' | 'embedding' | 'rerank' | undefined>
}

export interface UseModelTypeDetectionReturn {
  isImageGenerationModel: ComputedRef<boolean>
  isGPT5Model: ComputedRef<boolean>
  isGeminiProvider: ComputedRef<boolean>
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
  const settingsStore = useSettingsStore()

  // === Local State ===
  const modelReasoning = ref(false)

  // === Computed Properties ===

  /**
   * Checks if current model is an image generation model
   */
  const isImageGenerationModel = computed(() => {
    return modelType.value === 'imageGeneration'
  })

  /**
   * Checks if current model is GPT-5 series
   * GPT-5 models have special UI requirements (no temperature slider)
   */
  const isGPT5Model = computed(() => {
    const id = modelId.value?.toLowerCase() || ''
    return id.includes('gpt-5')
  })

  /**
   * Checks if current provider is Gemini
   * Gemini has special thinking budget rules (-1 for unlimited)
   */
  const isGeminiProvider = computed(() => providerId.value?.toLowerCase() === 'gemini')

  // === Internal Methods ===
  const fetchModelReasoning = async () => {
    if (!modelId.value || !providerId.value) {
      modelReasoning.value = false
      return
    }

    try {
      const modelConfig = await settingsStore.getModelConfig(modelId.value, providerId.value)
      modelReasoning.value = modelConfig.reasoning || false
    } catch (error) {
      modelReasoning.value = false
      console.error(error)
    }
  }

  // === Watchers ===
  watch(() => [modelId.value, providerId.value], fetchModelReasoning, { immediate: true })

  // === Return Public API ===
  return {
    isImageGenerationModel,
    isGPT5Model,
    isGeminiProvider,
    modelReasoning
  }
}
