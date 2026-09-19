<script setup lang="ts">
import { useId } from 'vue'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { cn } from '@shadcn/lib/utils'
import type { DcChoiceOption } from './types'

interface Props {
  options: DcChoiceOption[]
  modelValue?: string | null
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  disabled: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const uid = useId()

const labelId = (index: number) => `${uid}-option-${index}`

const handleUpdate = (value: unknown) => {
  if (typeof value === 'string') {
    emit('update:modelValue', value)
  }
}

// The row handles mouse selection itself instead of relying on native label
// forwarding, which misfires against reka-ui's button-based radio item. Clicks
// that land on the item are ignored here and handled by the group's emit.
const onRowClick = (option: DcChoiceOption, event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('[data-slot="radio-group-item"]')) return
  if (props.disabled || option.disabled) return
  emit('update:modelValue', option.value)
}
</script>

<template>
  <RadioGroup
    :model-value="props.modelValue ?? undefined"
    :disabled="props.disabled"
    class="flex w-full flex-col gap-0.5"
    @update:model-value="handleUpdate"
  >
    <div
      v-for="(option, index) in props.options"
      :key="option.value"
      data-testid="dc-choice-option"
      :class="
        cn(
          'flex w-full cursor-pointer select-none items-start gap-1.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-foreground/[0.04]',
          (props.disabled || option.disabled) && 'pointer-events-none opacity-60'
        )
      "
      @click="onRowClick(option, $event)"
    >
      <span class="flex h-5 w-5 shrink-0 items-center justify-center">
        <RadioGroupItem
          :value="option.value"
          :disabled="option.disabled"
          :aria-labelledby="labelId(index)"
          :aria-describedby="option.description ? `${labelId(index)}-description` : undefined"
        />
      </span>
      <span class="min-w-0 flex-1">
        <span :id="labelId(index)" class="block text-[13px] leading-5">{{ option.label }}</span>
        <span
          v-if="option.description"
          :id="`${labelId(index)}-description`"
          class="block text-xs leading-4 text-muted-foreground"
        >
          {{ option.description }}
        </span>
      </span>
    </div>
  </RadioGroup>
</template>
