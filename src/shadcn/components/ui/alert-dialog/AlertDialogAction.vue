<script setup lang="ts">
import type { AlertDialogActionProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { AlertDialogAction } from 'reka-ui'
import { mergeProps, useAttrs } from 'vue'
import { cn } from '@shadcn/lib/utils'
import { buttonVariants, type ButtonVariants } from '@shadcn/components/ui/button'

defineOptions({
  inheritAttrs: false
})

const props = defineProps<
  AlertDialogActionProps & {
    class?: HTMLAttributes['class']
    variant?: ButtonVariants['variant']
  }
>()
const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const delegatedProps = reactiveOmit(props, 'class', 'variant')
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
  <AlertDialogAction
    v-bind="forwardedProps()"
    :class="cn(buttonVariants({ variant }), props.class)"
  >
    <slot />
  </AlertDialogAction>
</template>
