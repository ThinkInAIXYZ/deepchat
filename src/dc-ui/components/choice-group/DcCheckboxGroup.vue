<script setup lang="ts">
import { useId } from 'vue'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Label } from '@shadcn/components/ui/label'
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

const optionId = (option: DcChoiceOption) => `${uid}-${option.value}`

const isChecked = (option: DcChoiceOption): boolean => props.modelValue.includes(option.value)

// Emit in options order (not click order) so submitted answers read naturally.
const toggle = (option: DcChoiceOption, checked: boolean | 'indeterminate') => {
  const selected = new Set(props.modelValue)
  if (checked === true) {
    selected.add(option.value)
  } else {
    selected.delete(option.value)
  }
  emit(
    'update:modelValue',
    props.options.filter((entry) => selected.has(entry.value)).map((entry) => entry.value)
  )
}
</script>

<template>
  <div role="group" class="flex w-full flex-col gap-0.5">
    <Label
      v-for="option in props.options"
      :key="option.value"
      :for="optionId(option)"
      :class="
        cn(
          'flex w-full cursor-pointer items-start gap-1.5 rounded-lg px-1 py-1.5 font-normal transition-colors hover:bg-foreground/[0.04]',
          (props.disabled || option.disabled) && 'pointer-events-none opacity-60'
        )
      "
    >
      <span class="flex h-5 w-5 shrink-0 items-center justify-center">
        <Checkbox
          :id="optionId(option)"
          :model-value="isChecked(option)"
          :disabled="props.disabled || option.disabled"
          @update:model-value="toggle(option, $event)"
        />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-[13px] leading-5">{{ option.label }}</span>
        <span v-if="option.description" class="block text-xs leading-4 text-muted-foreground">
          {{ option.description }}
        </span>
      </span>
    </Label>
  </div>
</template>
