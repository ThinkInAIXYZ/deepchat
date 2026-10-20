<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'

interface Props {
  id: string
  label: string
  description?: string
  icon?: string
  modelValue: boolean
  disabled?: boolean
  ariaLabel?: string
  labelMinWidth?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  labelMinWidth: ''
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const accessibleLabel = computed(() => props.ariaLabel ?? props.label)

const handleChecked = (value: boolean | 'indeterminate') => {
  emit('update:modelValue', value === true)
}
</script>

<template>
  <div class="flex min-h-14 w-full items-center gap-4 py-3">
    <Icon v-if="icon" :icon="icon" class="size-4 shrink-0 text-muted-foreground" />
    <div class="min-w-0 flex-1" :style="labelMinWidth ? { flexBasis: labelMinWidth } : undefined">
      <Label :for="id" class="text-sm font-medium leading-5">
        {{ label }}
      </Label>
      <p v-if="description" class="mt-1 text-xs leading-5 text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <slot name="trailing" />
      <Switch
        :id="id"
        :model-value="modelValue"
        :disabled="disabled"
        :aria-label="accessibleLabel"
        @update:model-value="handleChecked"
      />
    </div>
  </div>
</template>
