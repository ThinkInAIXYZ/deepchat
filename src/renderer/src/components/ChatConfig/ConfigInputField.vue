<script setup lang="ts">
// === Components ===
import { Input } from '@shadcn/components/ui/input'
import ConfigFieldHeader from './ConfigFieldHeader.vue'

// === Props ===
defineProps<{
  icon: string
  label: string
  description?: string
  modelValue: number | string | undefined
  type?: 'text' | 'number'
  min?: number
  max?: number
  step?: number
  placeholder?: string
  error?: string
  hint?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | string | undefined]
}>()

const normalizeNumber = (val: unknown) => {
  if (val === '' || val === null || val === undefined) return undefined
  const numericValue = Number(val)
  if (Number.isNaN(numericValue)) return undefined
  return numericValue
}
</script>

<template>
  <div class="px-2">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0 flex-1">
        <ConfigFieldHeader :icon="icon" :label="label" :description="description" />
      </div>
      <div class="w-36 shrink-0">
        <Input
          :model-value="modelValue"
          class="h-8 text-xs"
          :type="type || 'text'"
          :min="min"
          :max="max"
          :step="step"
          :placeholder="placeholder"
          :class="{ 'border-destructive': error }"
          @update:model-value="
            (val) => emit('update:modelValue', type === 'number' ? normalizeNumber(val) : val)
          "
        />
      </div>
    </div>
    <p v-if="error || hint" class="mt-1 text-[11px] text-muted-foreground">
      <span v-if="error" class="text-red-600 font-medium">
        {{ error }}
      </span>
      <span v-else>
        {{ hint }}
      </span>
    </p>
  </div>
</template>
