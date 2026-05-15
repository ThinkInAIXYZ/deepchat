<template>
  <div class="space-y-4">
    <div class="space-y-2">
      <Label>{{ t('settings.provider.voiceai.title') }}</Label>
      <p class="text-xs text-muted-foreground">
        {{ t('settings.provider.voiceai.description') }}
      </p>
    </div>

    <div class="space-y-2">
      <Label>{{ t('settings.provider.voiceai.agentId.label') }}</Label>
      <Input
        :model-value="tts.voice ?? ''"
        :placeholder="t('settings.provider.voiceai.agentId.placeholder')"
        @update:model-value="onVoiceInput"
      />
    </div>

    <div class="space-y-2">
      <Label>{{ t('settings.provider.voiceai.audioFormat.label') }}</Label>
      <Select
        :model-value="optionSelectValue(tts.responseFormat)"
        @update:model-value="onResponseFormatSelect"
      >
        <SelectTrigger>
          <SelectValue :placeholder="t('settings.provider.voiceai.audioFormat.placeholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="DEFAULT_SELECT_VALUE">
            {{ t('settings.model.modelConfig.currentUsingModelDefault') }}
          </SelectItem>
          <SelectItem v-for="format in TTS_RESPONSE_FORMAT_VALUES" :key="format" :value="format">
            {{ format.toUpperCase() }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="space-y-2">
      <Label>{{ t('settings.provider.voiceai.temperature.label') }}</Label>
      <Input
        :model-value="speedDraft"
        inputmode="decimal"
        placeholder="0.25 - 4.0"
        @update:model-value="onSpeedInput"
        @blur="commitSpeed"
        @keydown.enter.prevent="commitSpeed"
      />
      <p class="text-xs text-muted-foreground">
        {{ t('settings.provider.voiceai.temperature.helper') }}
      </p>
    </div>

    <div class="space-y-2">
      <Label>{{ t('settings.model.modelConfig.timeout.label') }}</Label>
      <Input
        :model-value="tts.instructions ?? ''"
        :placeholder="t('settings.model.modelConfig.name.placeholder')"
        @update:model-value="onInstructionsInput"
      />
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
  TTS_RESPONSE_FORMAT_VALUES,
  normalizeTtsSettings,
  type TtsResponseFormat,
  type TtsSettings
} from '@shared/ttsSettings'

const DEFAULT_SELECT_VALUE = '__default'

const props = withDefaults(
  defineProps<{
    modelValue?: TtsSettings
  }>(),
  {
    modelValue: undefined
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: TtsSettings | undefined]
}>()

const { t } = useI18n()

const tts = computed<TtsSettings>(() => normalizeTtsSettings(props.modelValue) ?? {})
const speedDraft = ref('')

watch(
  () => tts.value.speed,
  (speed) => {
    speedDraft.value = typeof speed === 'number' ? String(speed) : ''
  },
  { immediate: true }
)

const emitSettings = (patch: TtsSettings) => {
  const next = normalizeTtsSettings({
    ...tts.value,
    ...patch
  })
  emit('update:modelValue', next)
}

const optionSelectValue = (value: string | undefined) => value ?? DEFAULT_SELECT_VALUE

const onVoiceInput = (value: string | number) => {
  const next = String(value)
  emitSettings({ voice: next.trim() || undefined })
}

const onResponseFormatSelect = (value: unknown) => {
  const selected = String(value)
  if (selected === DEFAULT_SELECT_VALUE) {
    emitSettings({ responseFormat: undefined })
    return
  }
  emitSettings({ responseFormat: selected as TtsResponseFormat })
}

const onSpeedInput = (value: string | number) => {
  speedDraft.value = String(value)
}

const commitSpeed = () => {
  const value = speedDraft.value.trim()
  if (!value) {
    emitSettings({ speed: undefined })
    return
  }

  const speed = Number(value)
  if (!Number.isFinite(speed)) {
    return
  }

  emitSettings({ speed })
}

const onInstructionsInput = (value: string | number) => {
  const next = String(value)
  emitSettings({ instructions: next.trim() || undefined })
}
</script>
