<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import { cn } from '@shadcn/lib/utils'

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
  <div
    :class="
      cn(
        'w-full flex items-center gap-3',
        description ? 'flex-col items-start gap-1.5 py-1' : 'h-10'
      )
    "
  >
    <div class="flex min-w-0 w-full flex-1 items-center gap-3">
      <Icon v-if="icon" :icon="icon" class="size-4 shrink-0 text-muted-foreground" />
      <Label
        :for="id"
        class="min-w-0 flex-1 truncate text-sm font-medium"
        :style="labelMinWidth ? { minWidth: labelMinWidth } : undefined"
      >
        {{ label }}
      </Label>
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
    <p v-if="description" class="pl-7 text-xs leading-5 text-muted-foreground">
      {{ description }}
    </p>
  </div>
</template>
