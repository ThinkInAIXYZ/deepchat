<script setup lang="ts">
import { useId } from 'vue'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { cn } from '@shadcn/lib/utils'
import type { DcChoiceOption } from './types'

interface Props {
  options: DcChoiceOption[]
  modelValue?: string[]
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => [],
  disabled: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const uid = useId()

const labelId = (option: DcChoiceOption) => `${uid}-${option.value}`

const isChecked = (option: DcChoiceOption): boolean => props.modelValue.includes(option.value)

// Emit in options order (not click order) so submitted answers read naturally.
const setChecked = (option: DcChoiceOption, checked: boolean) => {
  const selected = new Set(props.modelValue)
  if (checked) {
    selected.add(option.value)
  } else {
    selected.delete(option.value)
  }
  emit(
    'update:modelValue',
    props.options.filter((entry) => selected.has(entry.value)).map((entry) => entry.value)
  )
}

// The row handles mouse toggling itself instead of relying on native label
// forwarding, which misfires against reka-ui's button-based checkbox. Clicks
// that land on the checkbox are ignored here and handled by its own emit.
const onRowClick = (option: DcChoiceOption, event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('[data-slot="checkbox"]')) return
  setChecked(option, !isChecked(option))
}

const onCheckboxUpdate = (option: DcChoiceOption, checked: boolean | 'indeterminate') => {
  setChecked(option, checked === true)
}
</script>

<template>
  <div role="group" class="flex w-full flex-col gap-0.5">
    <div
      v-for="option in props.options"
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
        <Checkbox
          :model-value="isChecked(option)"
          :disabled="props.disabled || option.disabled"
          :aria-labelledby="labelId(option)"
          @update:model-value="onCheckboxUpdate(option, $event)"
        />
      </span>
      <span class="min-w-0 flex-1">
        <span :id="labelId(option)" class="block text-[13px] leading-5">{{ option.label }}</span>
        <span v-if="option.description" class="block text-xs leading-4 text-muted-foreground">
          {{ option.description }}
        </span>
      </span>
    </div>
  </div>
</template>
