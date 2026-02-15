// === Vue Core ===
import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'

// === Types ===
import type {
  SliderFieldConfig,
  InputFieldConfig,
  SelectFieldConfig,
  SelectOption,
  FieldConfig
} from '@/components/ChatConfig/types'

// === Interfaces ===
export interface UseChatConfigFieldsOptions {
  // Props
  temperature: Ref<number>
  contextLength: Ref<number>
  maxTokens: Ref<number>
  contextLengthLimit: Ref<number | undefined>
  maxTokensLimit: Ref<number | undefined>
  thinkingBudget: Ref<number | undefined>
  reasoningEffort: Ref<'minimal' | 'low' | 'medium' | 'high' | undefined>
  verbosity: Ref<'low' | 'medium' | 'high' | undefined>
  providerId: Ref<string | undefined>

  // Composables
  isGPT5Model: ComputedRef<boolean>
  isImageGenerationModel: ComputedRef<boolean>
  showThinkingBudget: ComputedRef<boolean>
  thinkingBudgetError: ComputedRef<string>
  budgetRange: Ref<{ min?: number; max?: number; default?: number } | null>

  // Media generation (accept Ref for compatibility with useMediaParams)
  showMediaParams: ComputedRef<boolean>
  isVideoGeneration: Ref<boolean>
  isImageGeneration: Ref<boolean>
  mediaParamConfig: ComputedRef<{
    resolution?: { default: string; options: Array<{ value: string; label: string }> }
    duration?: { min: number; max: number; step: number; default: number; unit: string }
    cameraFixed?: { default: boolean; supported: boolean }
    watermark?: { default: boolean; supported: boolean }
  } | null>

  // Utils
  formatSize: (size: number) => string

  // Emits
  emit: {
    (e: 'update:temperature', value: number): void
    (e: 'update:contextLength', value: number): void
    (e: 'update:maxTokens', value: number): void
    (e: 'update:thinkingBudget', value: number | undefined): void
    (e: 'update:reasoningEffort', value: 'minimal' | 'low' | 'medium' | 'high'): void
    (e: 'update:verbosity', value: 'low' | 'medium' | 'high'): void
    (e: 'update:mediaResolution', value: string | undefined): void
    (e: 'update:mediaDuration', value: number | undefined): void
    (e: 'update:mediaCameraFixed', value: boolean | undefined): void
    (e: 'update:mediaWatermark', value: boolean | undefined): void
    (e: 'update:mediaAspectRatio', value: string | undefined): void
  }
}

/**
 * Composable that defines all field configurations for ChatConfig
 * Using data-driven approach to eliminate template repetition
 */
export function useChatConfigFields(options: UseChatConfigFieldsOptions) {
  const { t } = useI18n()

  // === Slider Fields ===
  const sliderFields = computed<SliderFieldConfig[]>(() => {
    const fields: SliderFieldConfig[] = []

    // Hide slider fields for media generation models
    if (options.showMediaParams.value) {
      return fields
    }

    // Temperature (hidden for GPT-5 and media generation)
    if (!options.isGPT5Model.value) {
      fields.push({
        key: 'temperature',
        type: 'slider',
        icon: 'lucide:thermometer',
        label: t('settings.model.temperature.label'),
        description: t('settings.model.temperature.description'),
        min: 0,
        max: 2,
        step: 0.1,
        getValue: () => options.temperature.value,
        setValue: (val) => options.emit('update:temperature', val)
      })
    }

    // Context Length
    fields.push({
      key: 'contextLength',
      type: 'slider',
      icon: 'lucide:pencil-ruler',
      label: t('settings.model.contextLength.label'),
      description: t('settings.model.contextLength.description'),
      min: 2048,
      max: options.contextLengthLimit.value ?? 16384,
      step: 1024,
      formatter: options.formatSize,
      getValue: () => options.contextLength.value,
      setValue: (val) => options.emit('update:contextLength', val)
    })

    // Response Length
    fields.push({
      key: 'maxTokens',
      type: 'slider',
      icon: 'lucide:message-circle-reply',
      label: t('settings.model.responseLength.label'),
      description: t('settings.model.responseLength.description'),
      min: 1024,
      max:
        !options.maxTokensLimit.value || options.maxTokensLimit.value < 8192
          ? 8192
          : options.maxTokensLimit.value,
      step: 128,
      formatter: options.formatSize,
      getValue: () => options.maxTokens.value,
      setValue: (val) => options.emit('update:maxTokens', val)
    })

    return fields
  })

  // === Input Fields ===
  const inputFields = computed<InputFieldConfig[]>(() => {
    const fields: InputFieldConfig[] = []

    // Thinking Budget
    if (options.showThinkingBudget.value) {
      fields.push({
        key: 'thinkingBudget',
        type: 'input',
        icon: 'lucide:brain',
        label: t('settings.model.modelConfig.thinkingBudget.label'),
        description: t('settings.model.modelConfig.thinkingBudget.description'),
        inputType: 'number',
        min: options.budgetRange.value?.min,
        max: options.budgetRange.value?.max,
        step: 128,
        placeholder: t('settings.model.modelConfig.thinkingBudget.placeholder'),
        getValue: () => options.thinkingBudget.value,
        setValue: (val) => options.emit('update:thinkingBudget', val as number | undefined),
        error: () => options.thinkingBudgetError.value,
        hint: () => {
          if (options.thinkingBudget.value === undefined) {
            return t('settings.model.modelConfig.currentUsingModelDefault')
          }
          return t('settings.model.modelConfig.thinkingBudget.range', {
            min: options.budgetRange.value?.min,
            max: options.budgetRange.value?.max
          })
        }
      })
    }

    // Media Duration (for video generation)
    if (
      options.showMediaParams.value &&
      options.isVideoGeneration.value &&
      options.mediaParamConfig.value?.duration
    ) {
      const config = options.mediaParamConfig.value.duration
      fields.push({
        key: 'mediaDuration',
        type: 'input',
        icon: 'lucide:clock',
        label: t('settings.model.media.duration.label'),
        description: t('settings.model.media.duration.description'),
        inputType: 'number',
        min: config.min,
        max: config.max,
        step: config.step,
        placeholder: config.default.toString(),
        getValue: () => config.default,
        setValue: (val) => options.emit('update:mediaDuration', val as number | undefined),
        hint: () =>
          t('settings.model.media.duration.range', {
            min: config.min,
            max: config.max,
            unit: config.unit === 'minutes' ? t('common.minutes') : t('common.seconds')
          })
      })
    }

    return fields
  })

  // === Select Fields ===
  const selectFields = computed<SelectFieldConfig[]>(() => {
    const fields: SelectFieldConfig[] = []

    // Reasoning Effort
    if (options.reasoningEffort.value !== undefined) {
      const getReasoningEffortOptions = (): SelectOption[] => {
        // Grok only supports low and high
        if (options.providerId.value === 'grok') {
          return [
            {
              value: 'low',
              label: t('settings.model.modelConfig.reasoningEffort.options.low')
            },
            {
              value: 'high',
              label: t('settings.model.modelConfig.reasoningEffort.options.high')
            }
          ]
        }

        // Other models support all four
        return [
          {
            value: 'minimal',
            label: t('settings.model.modelConfig.reasoningEffort.options.minimal')
          },
          {
            value: 'low',
            label: t('settings.model.modelConfig.reasoningEffort.options.low')
          },
          {
            value: 'medium',
            label: t('settings.model.modelConfig.reasoningEffort.options.medium')
          },
          {
            value: 'high',
            label: t('settings.model.modelConfig.reasoningEffort.options.high')
          }
        ]
      }

      fields.push({
        key: 'reasoningEffort',
        type: 'select',
        icon: 'lucide:brain',
        label: t('settings.model.modelConfig.reasoningEffort.label'),
        description: t('settings.model.modelConfig.reasoningEffort.description'),
        options: getReasoningEffortOptions,
        placeholder: t('settings.model.modelConfig.reasoningEffort.placeholder'),
        getValue: () => options.reasoningEffort.value,
        setValue: (val) =>
          options.emit('update:reasoningEffort', val as 'minimal' | 'low' | 'medium' | 'high')
      })
    }

    // Verbosity（存在该参数即显示）
    if (options.verbosity.value !== undefined) {
      fields.push({
        key: 'verbosity',
        type: 'select',
        icon: 'lucide:message-square-text',
        label: t('settings.model.modelConfig.verbosity.label'),
        description: t('settings.model.modelConfig.verbosity.description'),
        options: [
          { value: 'low', label: t('settings.model.modelConfig.verbosity.options.low') },
          { value: 'medium', label: t('settings.model.modelConfig.verbosity.options.medium') },
          { value: 'high', label: t('settings.model.modelConfig.verbosity.options.high') }
        ],
        placeholder: t('settings.model.modelConfig.verbosity.placeholder'),
        getValue: () => options.verbosity.value,
        setValue: (val) => options.emit('update:verbosity', val as 'low' | 'medium' | 'high')
      })
    }

    // Media Resolution (for video/image generation models)
    if (options.showMediaParams.value && options.mediaParamConfig.value?.resolution) {
      const config = options.mediaParamConfig.value.resolution
      fields.push({
        key: 'mediaResolution',
        type: 'select',
        icon: 'lucide:frame',
        label: t('settings.model.media.resolution.label'),
        description: options.isVideoGeneration.value
          ? t('settings.model.media.resolution.descriptionVideo')
          : t('settings.model.media.resolution.descriptionImage'),
        options: config.options.map((opt) => ({ value: opt.value, label: opt.label })),
        placeholder: t('settings.model.media.resolution.placeholder'),
        getValue: () => options.mediaParamConfig.value?.resolution?.default,
        setValue: (val) => options.emit('update:mediaResolution', val)
      })
    }

    return fields
  })

  // === All Fields Combined ===
  const allFields = computed<FieldConfig[]>(() => {
    return [...sliderFields.value, ...inputFields.value, ...selectFields.value]
  })

  return {
    sliderFields,
    inputFields,
    selectFields,
    allFields
  }
}
