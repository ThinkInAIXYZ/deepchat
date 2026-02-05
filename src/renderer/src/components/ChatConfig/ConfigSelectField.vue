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
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="px-2">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0 flex-1">
        <ConfigFieldHeader :icon="icon" :label="label" :description="description" />
      </div>
      <div class="w-36 shrink-0">
        <Select
          :model-value="modelValue"
          :disabled="disabled"
          @update:model-value="(val) => val && emit('update:modelValue', String(val))"
        >
          <SelectTrigger class="h-8 text-xs" :disabled="disabled">
            <SelectValue :placeholder="placeholder" />
          </SelectTrigger>
          <SelectContent :portal="false">
            <SelectItem v-for="option in options" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
    <p v-if="hint" class="mt-1 text-[11px] text-muted-foreground">
      {{ hint }}
    </p>
  </div>
</template>
