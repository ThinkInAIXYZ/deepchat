<script setup lang="ts">
// === Components ===
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'

// === Props ===
defineProps<{
  label: string
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <div class="flex items-center justify-between">
    <div class="min-w-0">
      <Label class="text-xs font-medium">{{ label }}</Label>
    </div>
    <Switch
      :model-value="modelValue"
      @update:model-value="(val) => emit('update:modelValue', val)"
    />
  </div>
</template>
