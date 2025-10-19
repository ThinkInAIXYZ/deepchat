<script setup lang="ts">
// === Components ===
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
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
</script>

<template>
  <div class="space-y-4 px-2">
    <ConfigFieldHeader :icon="icon" :label="label" :description="description" />

    <div class="space-y-3 pl-4 border-l-2 border-muted">
      <div class="space-y-2">
        <Label class="text-sm">{{ label }}</Label>
        <Input
          :model-value="modelValue"
          :type="type || 'text'"
          :min="min"
          :max="max"
          :step="step"
          :placeholder="placeholder"
          :class="{ 'border-destructive': error }"
          @update:model-value="
            (val) => emit('update:modelValue', type === 'number' ? Number(val) : val)
          "
        />
        <p class="text-xs text-muted-foreground">
          <span v-if="error" class="text-red-600 font-medium">
            {{ error }}
          </span>
          <span v-else-if="hint">
            {{ hint }}
          </span>
        </p>
      </div>
    </div>
  </div>
</template>
