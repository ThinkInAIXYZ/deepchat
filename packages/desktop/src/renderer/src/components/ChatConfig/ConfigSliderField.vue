<script setup lang="ts">
// === Vue Core ===
import { computed } from 'vue'

// === Components ===
import { Slider } from '@shadcn/components/ui/slider'
import ConfigFieldHeader from './ConfigFieldHeader.vue'

// === Props ===
const props = defineProps<{
  icon: string
  label: string
  description: string
  modelValue: number
  min: number
  max: number
  step: number
  disabled?: boolean
  hint?: string
  formatter?: (value: number) => string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

// Slider expects array format
const sliderValue = computed({
  get: () => [props.modelValue],
  set: (value) => {
    if (!props.disabled) {
      emit('update:modelValue', value[0])
    }
  }
})

const displayValue = computed(() => {
  return props.formatter ? props.formatter(props.modelValue) : String(props.modelValue)
})
</script>

<template>
  <div class="space-y-4 px-2">
    <ConfigFieldHeader
      :icon="icon"
      :label="label"
      :description="description"
      :value="displayValue"
    />
    <Slider v-model="sliderValue" :min="min" :max="max" :step="step" :disabled="disabled" />
    <p v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
  </div>
</template>
