<script setup lang="ts">
import type { CheckboxRootEmits, CheckboxRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { Check } from "lucide-vue-next"
import { CheckboxIndicator, CheckboxRoot } from "reka-ui"
import { cn } from '@shadcn/lib/utils'

type ExtendedCheckboxProps = CheckboxRootProps & {
  class?: HTMLAttributes["class"]
  /** Optional alias that allows using v-model:checked */
  checked?: boolean
}

const props = defineProps<ExtendedCheckboxProps>()
const emits = defineEmits<CheckboxRootEmits & { 'update:checked': [boolean] }>()

const resolvedModelValue = computed<CheckboxRootProps["modelValue"]>(() => props.checked ?? props.modelValue)

const forwardedProps = computed<Omit<ExtendedCheckboxProps, 'class' | 'checked' | 'modelValue'>>(() => {
  const { class: _class, checked: _checked, modelValue: _modelValue, ...rest } = props
  return rest
})

const handleUpdate = (value: boolean | 'indeterminate') => {
  emits('update:modelValue', value)
  emits('update:checked', value === 'indeterminate' ? true : value)
}
</script>

<template>
  <CheckboxRoot
    data-slot="checkbox"
    v-bind="forwardedProps"
    :model-value="resolvedModelValue"
    @update:model-value="handleUpdate"
    :class="
      cn('peer border-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
         props.class)"
  >
    <CheckboxIndicator
      data-slot="checkbox-indicator"
      class="flex items-center justify-center text-current transition-none"
    >
      <slot>
        <Check class="size-3.5" />
      </slot>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
