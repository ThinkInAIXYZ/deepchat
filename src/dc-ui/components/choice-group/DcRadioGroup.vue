<script setup lang="ts">
import { useId } from 'vue'
import { Label } from '@shadcn/components/ui/label'
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

const optionId = (option: DcChoiceOption) => `${uid}-${option.value}`

const handleUpdate = (value: unknown) => {
  if (typeof value === 'string') {
    emit('update:modelValue', value)
  }
}
</script>

<template>
  <RadioGroup
    :model-value="props.modelValue ?? undefined"
    :disabled="props.disabled"
    class="flex w-full flex-col gap-0.5"
    @update:model-value="handleUpdate"
  >
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
        <RadioGroupItem :id="optionId(option)" :value="option.value" :disabled="option.disabled" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-[13px] leading-5">{{ option.label }}</span>
        <span v-if="option.description" class="block text-xs leading-4 text-muted-foreground">
          {{ option.description }}
        </span>
      </span>
    </Label>
  </RadioGroup>
</template>
