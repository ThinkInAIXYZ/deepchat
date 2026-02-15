<script setup lang="ts">
// === Vue Core ===
import { computed, watch, toRef } from 'vue'
import { useI18n } from 'vue-i18n'

// === Components ===
import { Label } from '@shadcn/components/ui/label'
import { Icon } from '@iconify/vue'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import ConfigSliderField from './ChatConfig/ConfigSliderField.vue'
import ConfigInputField from './ChatConfig/ConfigInputField.vue'
import ConfigSelectField from './ChatConfig/ConfigSelectField.vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { useModelCapabilities } from '@/composables/useModelCapabilities'
import { useThinkingBudget } from '@/composables/useThinkingBudget'
import { useModelTypeDetection } from '@/composables/useModelTypeDetection'
import { useChatConfigFields } from '@/composables/useChatConfigFields'
import { useMediaParams } from '@/composables/useMediaParams'

// === Stores ===
import { useLanguageStore } from '@/stores/language'

// === Props & Emits ===
const props = defineProps<{
  contextLengthLimit?: number
  maxTokensLimit?: number
  temperature: number
  contextLength: number
  maxTokens: number
  artifacts: number
  thinkingBudget?: number
  modelId?: string
  providerId?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  modelType?: 'chat' | 'imageGeneration' | 'embedding' | 'rerank' | 'videoGeneration'
  // Media generation parameters
  mediaResolution?: string
  mediaDuration?: number
  mediaCameraFixed?: boolean
  mediaWatermark?: boolean
  mediaAspectRatio?: string
}>()

const systemPrompt = defineModel<string>('systemPrompt')

const emit = defineEmits<{
  'update:temperature': [value: number]
  'update:contextLength': [value: number]
  'update:maxTokens': [value: number]
  'update:thinkingBudget': [value: number | undefined]
  'update:reasoningEffort': [value: 'minimal' | 'low' | 'medium' | 'high']
  'update:verbosity': [value: 'low' | 'medium' | 'high']
  // Media generation parameter emits
  'update:mediaResolution': [value: string | undefined]
  'update:mediaDuration': [value: number | undefined]
  'update:mediaCameraFixed': [value: boolean | undefined]
  'update:mediaWatermark': [value: boolean | undefined]
  'update:mediaAspectRatio': [value: string | undefined]
}>()

// === Stores ===
const { t } = useI18n()
const langStore = useLanguageStore()
const configPresenter = usePresenter('configPresenter')

// === Composable Integrations ===

// Model type detection
const modelTypeDetection = useModelTypeDetection({
  modelId: toRef(props, 'modelId'),
  providerId: toRef(props, 'providerId'),
  modelType: toRef(props, 'modelType')
})

// Model capabilities
const capabilities = useModelCapabilities({
  providerId: toRef(props, 'providerId'),
  modelId: toRef(props, 'modelId'),
  configPresenter
})

// Thinking budget
const thinkingBudget = useThinkingBudget({
  thinkingBudget: toRef(props, 'thinkingBudget'),
  budgetRange: capabilities.budgetRange,
  modelReasoning: modelTypeDetection.modelReasoning,
  supportsReasoning: capabilities.supportsReasoning,
  isGeminiProvider: modelTypeDetection.isGeminiProvider
})

// Media generation params
const mediaParams = useMediaParams({
  providerId: computed(() => props.providerId),
  modelId: computed(() => props.modelId),
  configPresenter,
  modelType: computed(() => props.modelType)
})

// === Utility Functions ===

/**
 * Format token size for display (K, M notation)
 */
const formatSize = (size: number): string => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)}M`
  } else if (size >= 1024) {
    return `${(size / 1024).toFixed(1)}K`
  }
  return `${size}`
}

// === Field Configurations ===
const { sliderFields, inputFields, selectFields } = useChatConfigFields({
  // Props
  temperature: toRef(props, 'temperature'),
  contextLength: toRef(props, 'contextLength'),
  maxTokens: toRef(props, 'maxTokens'),
  contextLengthLimit: toRef(props, 'contextLengthLimit'),
  maxTokensLimit: toRef(props, 'maxTokensLimit'),
  thinkingBudget: toRef(props, 'thinkingBudget'),
  reasoningEffort: toRef(props, 'reasoningEffort'),
  verbosity: toRef(props, 'verbosity'),
  providerId: toRef(props, 'providerId'),

  // Composables
  isGPT5Model: modelTypeDetection.isGPT5Model,
  isImageGenerationModel: modelTypeDetection.isImageGenerationModel,
  showThinkingBudget: thinkingBudget.showThinkingBudget,
  thinkingBudgetError: thinkingBudget.validationError,
  budgetRange: capabilities.budgetRange,

  // Media generation
  showMediaParams: mediaParams.showMediaParams,
  isVideoGeneration: mediaParams.isVideoGeneration,
  isImageGeneration: mediaParams.isImageGeneration,
  mediaParamConfig: mediaParams.mediaParamConfig,

  // Utils
  formatSize,

  // Emits
  emit
})

// === Local State & Computed ===

// Clear system prompt when switching to image/video generation model
watch(
  () => props.modelType,
  (newType, oldType) => {
    if ((newType === 'imageGeneration' || newType === 'videoGeneration') && systemPrompt.value) {
      systemPrompt.value = ''
    }

    // Clear media params when switching between media types or to non-media model
    if (oldType !== newType) {
      const isOldTypeMedia = oldType === 'imageGeneration' || oldType === 'videoGeneration'
      const isNewTypeMedia = newType === 'imageGeneration' || newType === 'videoGeneration'

      // Clear media params when switching from media to non-media
      // or when switching between different media types (image <-> video)
      if (isOldTypeMedia && (!isNewTypeMedia || oldType !== newType)) {
        emit('update:mediaResolution', undefined)
        emit('update:mediaDuration', undefined)
        emit('update:mediaCameraFixed', undefined)
        emit('update:mediaWatermark', undefined)
        emit('update:mediaAspectRatio', undefined)
      }
    }
  }
)

// Model type icon mapping
const modelTypeIcon = computed(() => {
  const icons = {
    chat: 'lucide:message-circle',
    imageGeneration: 'lucide:image',
    videoGeneration: 'lucide:video',
    embedding: 'lucide:layers',
    rerank: 'lucide:arrow-up-down'
  }
  return icons[props.modelType || 'chat']
})
</script>

<template>
  <div class="pt-2 pb-6 px-2" :dir="langStore.dir">
    <!-- Header -->
    <div class="flex items-center gap-2 px-2 mb-2">
      <h2 class="text-xs text-muted-foreground">{{ t('settings.model.title') }}</h2>
      <Icon :icon="modelTypeIcon" class="w-3 h-3 text-muted-foreground" />
    </div>

    <div class="space-y-6">
      <!-- System Prompt (hidden for media generation models) -->
      <div v-if="!mediaParams.showMediaParams.value" class="space-y-2 px-2">
        <div class="flex items-center space-x-2 py-1.5">
          <Icon icon="lucide:terminal" class="w-4 h-4 text-muted-foreground" />
          <Label class="text-xs font-medium">{{ t('settings.model.systemPrompt.label') }}</Label>
          <TooltipProvider :ignoreNonKeyboardFocus="true" :delayDuration="200">
            <Tooltip>
              <TooltipTrigger>
                <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t('settings.model.systemPrompt.description') }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Textarea
          v-model="systemPrompt"
          :placeholder="t('settings.model.systemPrompt.placeholder')"
        />
      </div>

      <!-- Slider Fields (Temperature, Context Length, Response Length) -->
      <ConfigSliderField
        v-for="field in sliderFields"
        :key="field.key"
        :model-value="field.getValue()"
        :icon="field.icon"
        :label="field.label"
        :description="field.description || ''"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :formatter="field.formatter"
        @update:model-value="field.setValue"
      />

      <!-- Input Fields (Thinking Budget) -->
      <ConfigInputField
        v-for="field in inputFields"
        :key="field.key"
        :model-value="field.getValue()"
        :icon="field.icon"
        :label="field.label"
        :description="field.description"
        :type="field.inputType"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :placeholder="field.placeholder"
        :error="field.error?.()"
        :hint="field.hint?.()"
        @update:model-value="field.setValue"
      />

      <!-- Select Fields (Reasoning Effort, Verbosity, Media Resolution) -->
      <ConfigSelectField
        v-for="field in selectFields"
        :key="field.key"
        :model-value="field.getValue()"
        :icon="field.icon"
        :label="field.label"
        :description="field.description"
        :options="typeof field.options === 'function' ? field.options() : field.options"
        :placeholder="field.placeholder"
        :hint="field.hint"
        @update:model-value="field.setValue"
      />

      <!-- Camera Fixed (for video generation) -->
      <div
        v-if="
          mediaParams.showMediaParams.value &&
          mediaParams.isVideoGeneration.value &&
          mediaParams.mediaParamConfig.value?.cameraFixed?.supported
        "
        class="flex items-center justify-between px-2"
      >
        <div class="space-y-0.5">
          <Label class="text-xs font-medium">{{
            t('settings.model.media.cameraFixed.label')
          }}</Label>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.model.media.cameraFixed.description') }}
          </p>
        </div>
        <Checkbox
          :checked="
            props.mediaCameraFixed ??
            mediaParams.mediaParamConfig.value?.cameraFixed?.default ??
            false
          "
          @update:checked="(val) => emit('update:mediaCameraFixed', val)"
        />
      </div>

      <!-- Watermark (for video generation) -->
      <div
        v-if="
          mediaParams.showMediaParams.value &&
          mediaParams.isVideoGeneration.value &&
          mediaParams.mediaParamConfig.value?.watermark?.supported
        "
        class="flex items-center justify-between px-2"
      >
        <div class="space-y-0.5">
          <Label class="text-xs font-medium">{{ t('settings.model.media.watermark.label') }}</Label>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.model.media.watermark.description') }}
          </p>
        </div>
        <Checkbox
          :checked="
            props.mediaWatermark ?? mediaParams.mediaParamConfig.value?.watermark?.default ?? false
          "
          @update:checked="(val) => emit('update:mediaWatermark', val)"
        />
      </div>
    </div>
  </div>
</template>
