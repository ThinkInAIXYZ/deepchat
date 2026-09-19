<script setup lang="ts">
// === Components ===
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import ConfigFieldHeader from './ConfigFieldHeader.vue'
import type { SelectOption } from './types'

// === Props ===
defineProps<{
  icon: string
  label: string
  description?: string
  modelValue: string | undefined
  options: SelectOption[]
  placeholder?: string
  hint?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="space-y-4 px-2">
    <ConfigFieldHeader :icon="icon" :label="label" :description="description" />
    <Select
      :model-value="modelValue"
      @update:model-value="(val) => val && emit('update:modelValue', String(val))"
    >
      <SelectTrigger class="text-xs">
        <SelectValue :placeholder="placeholder" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}
        </SelectItem>
      </SelectContent>
    </Select>
    <p v-if="hint" class="text-xs text-muted-foreground">
      {{ hint }}
    </p>
  </div>
</template>
