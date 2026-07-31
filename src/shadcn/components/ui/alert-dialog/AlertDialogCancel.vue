<script setup lang="ts">
import type { AlertDialogCancelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { AlertDialogCancel } from 'reka-ui'
import { mergeProps, useAttrs } from 'vue'
import { cn } from '@shadcn/lib/utils'
import { buttonVariants } from '@shadcn/components/ui/button'

defineOptions({
  inheritAttrs: false
})

const props = defineProps<AlertDialogCancelProps & { class?: HTMLAttributes['class'] }>()
const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const delegatedProps = reactiveOmit(props, 'class')
const attrs = useAttrs()

function handleClickCapture(event: MouseEvent): void {
  emit('click', event)
}

function forwardedProps() {
  // `useAttrs()` stays current across renders but is not reactive enough to cache in a computed.
  return mergeProps(delegatedProps, attrs, { onClickCapture: handleClickCapture })
}
</script>

<template>
  <AlertDialogCancel
    v-bind="forwardedProps()"
    :class="cn(
      buttonVariants({ variant: 'outline' }),
      'mt-2 sm:mt-0',
      props.class
    )"
  >
    <slot />
  </AlertDialogCancel>
</template>
