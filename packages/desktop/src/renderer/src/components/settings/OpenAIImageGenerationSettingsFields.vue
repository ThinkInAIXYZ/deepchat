<template>
  <div :class="containerClass">
    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.imageGeneration.size.label') }}
      </Label>
      <Select :model-value="sizeSelectValue" @update:model-value="onSizeSelect">
        <SelectTrigger :class="triggerClass">
          <SelectValue :placeholder="t('settings.model.modelConfig.imageGeneration.default')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="DEFAULT_SELECT_VALUE">
            {{ t('settings.model.modelConfig.imageGeneration.default') }}
          </SelectItem>
          <SelectItem
            v-for="size in OPENAI_IMAGE_GENERATION_SIZE_PRESETS"
            :key="size"
            :value="size"
          >
            {{ size }}
          </SelectItem>
          <SelectItem :value="CUSTOM_SIZE_VALUE">
            {{ t('settings.model.modelConfig.imageGeneration.size.custom') }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Input
        v-if="isCustomSizeMode"
        :model-value="customSizeDraft"
        :class="{ 'border-destructive': Boolean(customSizeValidationMessage) }"
        :placeholder="t('settings.model.modelConfig.imageGeneration.size.placeholder')"
        @update:model-value="onCustomSizeInput"
        @blur="commitCustomSize"
        @keydown.enter.prevent="commitCustomSize"
      />
      <p v-if="customSizeValidationMessage" :class="errorClass">
        {{ customSizeValidationMessage }}
      </p>
      <p v-if="showExperimentalHint" :class="hintClass">
        {{ t('settings.model.modelConfig.imageGeneration.size.experimental') }}
      </p>
    </div>

    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.imageGeneration.quality.label') }}
      </Label>
      <Select
        :model-value="optionSelectValue(imageGeneration.quality)"
        @update:model-value="onQualitySelect"
      >
        <SelectTrigger :class="triggerClass">
          <SelectValue :placeholder="t('settings.model.modelConfig.imageGeneration.default')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="DEFAULT_SELECT_VALUE">
            {{ t('settings.model.modelConfig.imageGeneration.default') }}
          </SelectItem>
          <SelectItem
            v-for="quality in IMAGE_GENERATION_QUALITY_VALUES"
            :key="quality"
            :value="quality"
          >
            {{ t(`settings.model.modelConfig.imageGeneration.quality.options.${quality}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.imageGeneration.outputFormat.label') }}
      </Label>
      <Select
        :model-value="optionSelectValue(imageGeneration.outputFormat)"
        @update:model-value="onOutputFormatSelect"
      >
        <SelectTrigger :class="triggerClass">
          <SelectValue :placeholder="t('settings.model.modelConfig.imageGeneration.default')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="DEFAULT_SELECT_VALUE">
            {{ t('settings.model.modelConfig.imageGeneration.default') }}
          </SelectItem>
          <SelectItem
            v-for="format in IMAGE_GENERATION_OUTPUT_FORMAT_VALUES"
            :key="format"
            :value="format"
          >
            {{ t(`settings.model.modelConfig.imageGeneration.outputFormat.options.${format}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="showCompressionField" :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.imageGeneration.outputCompression.label') }}
      </Label>
      <Input
        :model-value="compressionDraft"
        inputmode="numeric"
        :class="{ 'border-destructive': Boolean(compressionValidationMessage) }"
        :placeholder="t('settings.model.modelConfig.imageGeneration.outputCompression.placeholder')"
        @update:model-value="onCompressionInput"
        @blur="commitCompression"
        @keydown.enter.prevent="commitCompression"
      />
      <p v-if="compressionValidationMessage" :class="errorClass">
        {{ compressionValidationMessage }}
      </p>
    </div>

    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.imageGeneration.background.label') }}
      </Label>
      <Select
        :model-value="optionSelectValue(imageGeneration.background)"
        @update:model-value="onBackgroundSelect"
      >
        <SelectTrigger :class="triggerClass">
          <SelectValue :placeholder="t('settings.model.modelConfig.imageGeneration.default')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="DEFAULT_SELECT_VALUE">
            {{ t('settings.model.modelConfig.imageGeneration.default') }}
          </SelectItem>
          <SelectItem
            v-for="background in OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES"
            :key="background"
            :value="background"
          >
            {{ t(`settings.model.modelConfig.imageGeneration.background.options.${background}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.imageGeneration.moderation.label') }}
      </Label>
      <Select
        :model-value="optionSelectValue(imageGeneration.moderation)"
        @update:model-value="onModerationSelect"
      >
        <SelectTrigger :class="triggerClass">
          <SelectValue :placeholder="t('settings.model.modelConfig.imageGeneration.default')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="DEFAULT_SELECT_VALUE">
            {{ t('settings.model.modelConfig.imageGeneration.default') }}
          </SelectItem>
          <SelectItem
            v-for="moderation in IMAGE_GENERATION_MODERATION_VALUES"
            :key="moderation"
            :value="moderation"
          >
            {{ t(`settings.model.modelConfig.imageGeneration.moderation.options.${moderation}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import {
  IMAGE_GENERATION_MODERATION_VALUES,
  IMAGE_GENERATION_OUTPUT_FORMAT_VALUES,
  IMAGE_GENERATION_QUALITY_VALUES,
  OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES,
  OPENAI_IMAGE_GENERATION_SIZE_PRESETS,
  normalizeImageGenerationOptions,
  validateOpenAIImageGenerationSize,
  type ImageGenerationOptions
} from '@shared/imageGenerationSettings'

const DEFAULT_SELECT_VALUE = '__default'
const CUSTOM_SIZE_VALUE = '__custom'

const props = withDefaults(
  defineProps<{
    modelValue?: ImageGenerationOptions
    density?: 'default' | 'compact'
  }>(),
  {
    modelValue: undefined,
    density: 'default'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: ImageGenerationOptions | undefined]
}>()

const { t } = useI18n()

const imageGeneration = computed<ImageGenerationOptions>(
  () => normalizeImageGenerationOptions(props.modelValue) ?? {}
)
const sizeSelectDraft = ref<string>(DEFAULT_SELECT_VALUE)
const customSizeDraft = ref('')
const compressionDraft = ref('')

const containerClass = computed(() => (props.density === 'compact' ? 'space-y-3' : 'space-y-4'))
const fieldClass = computed(() => (props.density === 'compact' ? 'space-y-1.5' : 'space-y-2'))
const labelClass = computed(() => (props.density === 'compact' ? 'text-xs font-medium' : ''))
const triggerClass = computed(() => (props.density === 'compact' ? 'h-8 text-xs' : ''))
const hintClass = computed(() =>
  props.density === 'compact'
    ? 'text-[11px] text-muted-foreground'
    : 'text-xs text-muted-foreground'
)
const errorClass = computed(() =>
  props.density === 'compact' ? 'text-[11px] text-destructive' : 'text-xs text-destructive'
)

const isPresetSize = (
  size: string | undefined
): size is (typeof OPENAI_IMAGE_GENERATION_SIZE_PRESETS)[number] =>
  typeof size === 'string' &&
  OPENAI_IMAGE_GENERATION_SIZE_PRESETS.includes(
    size as (typeof OPENAI_IMAGE_GENERATION_SIZE_PRESETS)[number]
  )

const sizeSelectValue = computed(() => {
  if (!imageGeneration.value.size) {
    return sizeSelectDraft.value
  }
  return isPresetSize(imageGeneration.value.size) ? imageGeneration.value.size : CUSTOM_SIZE_VALUE
})

const isCustomSizeMode = computed(() => sizeSelectValue.value === CUSTOM_SIZE_VALUE)

const selectedSizeValidation = computed(() =>
  imageGeneration.value.size ? validateOpenAIImageGenerationSize(imageGeneration.value.size) : null
)

const showExperimentalHint = computed(() => selectedSizeValidation.value?.experimental === true)

const customSizeValidationMessage = computed(() => {
  const size = customSizeDraft.value.trim()
  if (!isCustomSizeMode.value || !size) {
    return ''
  }
  const code = validateOpenAIImageGenerationSize(size).code
  return code ? t(`settings.model.modelConfig.imageGeneration.size.validation.${code}`) : ''
})

const showCompressionField = computed(
  () =>
    imageGeneration.value.outputFormat === 'jpeg' || imageGeneration.value.outputFormat === 'webp'
)

const compressionValidationMessage = computed(() => {
  const value = compressionDraft.value.trim()
  if (!showCompressionField.value || !value) {
    return ''
  }
  const compression = Number(value)
  if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
    return t('settings.model.modelConfig.imageGeneration.outputCompression.validation')
  }
  return ''
})

watch(
  () => imageGeneration.value.size,
  (size) => {
    if (!size) {
      sizeSelectDraft.value = DEFAULT_SELECT_VALUE
      customSizeDraft.value = ''
      return
    }
    if (isPresetSize(size)) {
      sizeSelectDraft.value = size
      customSizeDraft.value = ''
      return
    }
    sizeSelectDraft.value = CUSTOM_SIZE_VALUE
    customSizeDraft.value = size
  },
  { immediate: true }
)

watch(
  () => imageGeneration.value.outputCompression,
  (compression) => {
    compressionDraft.value = compression === undefined ? '' : String(compression)
  },
  { immediate: true }
)

const emitOptions = (patch: ImageGenerationOptions) => {
  const next = normalizeImageGenerationOptions({
    ...imageGeneration.value,
    ...patch
  })
  emit('update:modelValue', next)
}

const optionSelectValue = (value: string | undefined) => value ?? DEFAULT_SELECT_VALUE
const optionFromSelect = (value: unknown): string | undefined =>
  value === DEFAULT_SELECT_VALUE ? undefined : String(value)

const onSizeSelect = (value: unknown) => {
  const selected = String(value)
  sizeSelectDraft.value = selected
  if (selected === DEFAULT_SELECT_VALUE) {
    customSizeDraft.value = ''
    emitOptions({ size: undefined })
    return
  }
  if (selected === CUSTOM_SIZE_VALUE) {
    customSizeDraft.value =
      imageGeneration.value.size && !isPresetSize(imageGeneration.value.size)
        ? imageGeneration.value.size
        : ''
    return
  }
  customSizeDraft.value = ''
  emitOptions({ size: selected })
}

const onCustomSizeInput = (value: string | number) => {
  customSizeDraft.value = String(value)
}

const commitCustomSize = () => {
  const size = customSizeDraft.value.trim()
  if (!size || validateOpenAIImageGenerationSize(size).code) {
    return
  }
  emitOptions({ size })
}

const onQualitySelect = (value: unknown) => {
  emitOptions({ quality: optionFromSelect(value) as ImageGenerationOptions['quality'] })
}

const onOutputFormatSelect = (value: unknown) => {
  const outputFormat = optionFromSelect(value) as ImageGenerationOptions['outputFormat']
  emitOptions({
    outputFormat,
    outputCompression:
      outputFormat === 'jpeg' || outputFormat === 'webp'
        ? imageGeneration.value.outputCompression
        : undefined
  })
}

const onCompressionInput = (value: string | number) => {
  compressionDraft.value = String(value)
}

const commitCompression = () => {
  const value = compressionDraft.value.trim()
  if (!value) {
    emitOptions({ outputCompression: undefined })
    return
  }
  if (compressionValidationMessage.value) {
    return
  }
  emitOptions({ outputCompression: Number(value) })
}

const onBackgroundSelect = (value: unknown) => {
  emitOptions({ background: optionFromSelect(value) as ImageGenerationOptions['background'] })
}

const onModerationSelect = (value: unknown) => {
  emitOptions({ moderation: optionFromSelect(value) as ImageGenerationOptions['moderation'] })
}
</script>
