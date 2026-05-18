<template>
  <div :class="containerClass">
    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.videoGeneration.size.label') }}
      </Label>
      <Input
        :model-value="videoGeneration.size ?? ''"
        :class="inputClass"
        :placeholder="t('settings.model.modelConfig.videoGeneration.size.placeholder')"
        @update:model-value="onTextFieldUpdate('size', $event)"
      />
    </div>

    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.videoGeneration.seconds.label') }}
      </Label>
      <Input
        :model-value="videoGeneration.seconds ?? ''"
        :class="inputClass"
        :placeholder="t('settings.model.modelConfig.videoGeneration.seconds.placeholder')"
        @update:model-value="onTextFieldUpdate('seconds', $event)"
      />
    </div>

    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.videoGeneration.duration.label') }}
      </Label>
      <Input
        :model-value="durationDraft"
        :class="inputClass"
        inputmode="numeric"
        :placeholder="t('settings.model.modelConfig.videoGeneration.duration.placeholder')"
        @update:model-value="onDurationInput"
      />
      <p :class="hintClass">
        {{ t('settings.model.modelConfig.videoGeneration.duration.description') }}
      </p>
    </div>

    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.videoGeneration.ratio.label') }}
      </Label>
      <Input
        :model-value="videoGeneration.ratio ?? ''"
        :class="inputClass"
        :placeholder="t('settings.model.modelConfig.videoGeneration.ratio.placeholder')"
        @update:model-value="onTextFieldUpdate('ratio', $event)"
      />
    </div>

    <div :class="fieldClass">
      <Label :class="labelClass">
        {{ t('settings.model.modelConfig.videoGeneration.resolution.label') }}
      </Label>
      <Input
        :model-value="videoGeneration.resolution ?? ''"
        :class="inputClass"
        :placeholder="t('settings.model.modelConfig.videoGeneration.resolution.placeholder')"
        @update:model-value="onTextFieldUpdate('resolution', $event)"
      />
    </div>

    <div class="flex items-center justify-between gap-3 rounded-md border p-3">
      <div class="space-y-0.5">
        <Label :class="labelClass">
          {{ t('settings.model.modelConfig.videoGeneration.watermark.label') }}
        </Label>
        <p :class="hintClass">
          {{ t('settings.model.modelConfig.videoGeneration.watermark.description') }}
        </p>
      </div>
      <Switch
        :model-value="Boolean(videoGeneration.watermark)"
        @update:model-value="onBooleanFieldUpdate('watermark', $event)"
      />
    </div>

    <div class="flex items-center justify-between gap-3 rounded-md border p-3">
      <div class="space-y-0.5">
        <Label :class="labelClass">
          {{ t('settings.model.modelConfig.videoGeneration.generateAudio.label') }}
        </Label>
        <p :class="hintClass">
          {{ t('settings.model.modelConfig.videoGeneration.generateAudio.description') }}
        </p>
      </div>
      <Switch
        :model-value="Boolean(videoGeneration.generateAudio)"
        @update:model-value="onBooleanFieldUpdate('generateAudio', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  normalizeVideoGenerationOptions,
  type VideoGenerationOptions
} from '@shared/videoGenerationSettings'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'

const props = withDefaults(
  defineProps<{
    modelValue?: VideoGenerationOptions
    density?: 'default' | 'compact'
  }>(),
  {
    modelValue: undefined,
    density: 'default'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: VideoGenerationOptions | undefined]
}>()

const { t } = useI18n()

const videoGeneration = computed<VideoGenerationOptions>(
  () => normalizeVideoGenerationOptions(props.modelValue) ?? {}
)

const containerClass = computed(() => (props.density === 'compact' ? 'space-y-3' : 'space-y-4'))
const fieldClass = computed(() => (props.density === 'compact' ? 'space-y-1.5' : 'space-y-2'))
const labelClass = computed(() => (props.density === 'compact' ? 'text-xs font-medium' : ''))
const hintClass = computed(() =>
  props.density === 'compact'
    ? 'text-[11px] text-muted-foreground'
    : 'text-xs text-muted-foreground'
)
const inputClass = computed(() => (props.density === 'compact' ? 'h-8 text-xs' : ''))
const durationDraft = computed(() =>
  typeof videoGeneration.value.duration === 'number' ? String(videoGeneration.value.duration) : ''
)

const emitOptions = (patch: VideoGenerationOptions) => {
  const next = normalizeVideoGenerationOptions({
    ...videoGeneration.value,
    ...patch
  })
  emit('update:modelValue', next)
}

const normalizeTextInput = (value: unknown): string | undefined => {
  const trimmed = String(value ?? '').trim()
  return trimmed ? trimmed : undefined
}

const onTextFieldUpdate = (field: 'size' | 'seconds' | 'ratio' | 'resolution', value: unknown) => {
  emitOptions({ [field]: normalizeTextInput(value) })
}

const onDurationInput = (value: unknown) => {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) {
    emitOptions({ duration: undefined })
    return
  }

  const parsed = Number.parseInt(trimmed, 10)
  emitOptions({ duration: Number.isFinite(parsed) ? parsed : undefined })
}

const onBooleanFieldUpdate = (field: 'watermark' | 'generateAudio', value: unknown) => {
  emitOptions({ [field]: Boolean(value) })
}
</script>
