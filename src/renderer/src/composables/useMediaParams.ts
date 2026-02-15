// === Vue Core ===
import { ref, computed, watch, type Ref } from 'vue'

// === Types ===
import type { IPresenter } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { getMediaParamConfig, type MediaParamType } from '@shared/mediaParams'

type ConfigPresenter = IPresenter['configPresenter']

export interface UseMediaParamsOptions {
  providerId: Ref<string | undefined>
  modelId: Ref<string | undefined>
  configPresenter: ConfigPresenter
  modelType?: Ref<ModelType | undefined>
}

export interface MediaParamsConfig {
  resolution?: { default: string; options: Array<{ value: string; label: string }> }
  duration?: { min: number; max: number; step: number; default: number; unit: string }
  cameraFixed?: { default: boolean; supported: boolean }
  watermark?: { default: boolean; supported: boolean }
}

/**
 * Composable for managing media generation parameters
 * Handles video/image generation specific settings
 */
export function useMediaParams(options: UseMediaParamsOptions) {
  const { providerId, modelId, configPresenter, modelType } = options

  // === Local State ===
  const isVideoGeneration = ref(false)
  const isImageGeneration = ref(false)
  const isLoading = ref(false)

  // === Computed ===
  const showMediaParams = computed(() => isVideoGeneration.value || isImageGeneration.value)

  const mediaType = computed((): MediaParamType | null => {
    if (isVideoGeneration.value) return 'video'
    if (isImageGeneration.value) return 'image'
    return null
  })

  const mediaParamConfig = computed((): MediaParamsConfig | null => {
    if (!providerId.value || !mediaType.value) return null

    const config = getMediaParamConfig(providerId.value, mediaType.value)
    if (!config) return null

    const result: MediaParamsConfig = {}

    if (config.resolution) {
      result.resolution = {
        default: config.resolution.default,
        options: config.resolution.options.map((opt) => ({
          value: opt.value,
          label: opt.label
        }))
      }
    }

    if (config.duration) {
      result.duration = {
        min: config.duration.min,
        max: config.duration.max,
        step: config.duration.step,
        default: config.duration.default,
        unit: config.duration.unit
      }
    }

    if (config.cameraFixed) {
      result.cameraFixed = {
        default: config.cameraFixed.default,
        supported: config.cameraFixed.supported
      }
    }

    if (config.watermark) {
      result.watermark = {
        default: config.watermark.default,
        supported: config.watermark.supported
      }
    }

    return result
  })

  // === Internal Methods ===
  const detectModelTypeFromProps = () => {
    // If modelType is provided, use it directly
    if (modelType?.value) {
      const type = modelType.value
      if (type === ModelType.VideoGeneration) {
        isVideoGeneration.value = true
        isImageGeneration.value = false
      } else if (type === ModelType.ImageGeneration) {
        isVideoGeneration.value = false
        isImageGeneration.value = true
      } else {
        isVideoGeneration.value = false
        isImageGeneration.value = false
      }
      return true
    }
    return false
  }

  const detectModelType = async () => {
    // First try to detect from props (synchronous)
    if (detectModelTypeFromProps()) {
      return
    }

    // Fall back to async detection via configPresenter
    if (!providerId.value || !modelId.value) {
      isVideoGeneration.value = false
      isImageGeneration.value = false
      return
    }

    isLoading.value = true
    try {
      // Check if model supports video generation
      const supportsVideo = await configPresenter.supportsVideoGeneration?.(
        providerId.value,
        modelId.value
      )
      isVideoGeneration.value = supportsVideo === true

      // Check if model supports image generation (only if not video)
      if (!isVideoGeneration.value) {
        const supportsImage = await configPresenter.supportsImageGeneration?.(
          providerId.value,
          modelId.value
        )
        isImageGeneration.value = supportsImage === true
      } else {
        isImageGeneration.value = false
      }
    } catch (error) {
      console.error('[useMediaParams] Failed to detect model type:', error)
      isVideoGeneration.value = false
      isImageGeneration.value = false
    } finally {
      isLoading.value = false
    }
  }

  // === Watchers ===
  watch(
    () => [providerId.value, modelId.value, modelType?.value],
    () => {
      detectModelType()
    },
    { immediate: true }
  )

  // === Return Public API ===
  return {
    // Read-only state
    isVideoGeneration,
    isImageGeneration,
    showMediaParams,
    mediaParamConfig,
    isLoading,
    // Methods
    refresh: detectModelType
  }
}
