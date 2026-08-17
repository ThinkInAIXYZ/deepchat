<script setup lang="ts">
import type { CheckboxRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { Check } from "@lucide/vue"
import { CheckboxIndicator, CheckboxRoot } from "reka-ui"
import { cn } from '@shadcn/lib/utils'

type ExtendedCheckboxProps = Omit<CheckboxRootProps, "modelValue"> & {
  class?: HTMLAttributes["class"]
}

const props = defineProps<ExtendedCheckboxProps>()

// Explicit undefined defaults opt out of Vue's boolean-prop casting: an
// absent model must stay undefined so the other model can drive the state
// instead of pinning it to false.
const modelValue = defineModel<boolean | "indeterminate">({ default: undefined as never })
/** Optional alias that allows using v-model:checked */
const checked = defineModel<boolean>("checked", { default: undefined as never })

const resolvedModelValue = computed<CheckboxRootProps["modelValue"]>(
  () => checked.value ?? modelValue.value
)

const forwardedProps = computed<Omit<ExtendedCheckboxProps, "class">>(() => {
  const { class: _class, ...rest } = props
  return rest
})

const handleUpdate = (value: boolean | "indeterminate") => {
  modelValue.value = value
  // Only mirror into the alias when it is actually in use; writing an unbound
  // defineModel stores a local value that would shadow modelValue above.
  if (checked.value !== undefined) {
    checked.value = value === "indeterminate" ? true : value
  }
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
