<script setup lang="ts">
import type { AlertDialogContentEmits, AlertDialogContentProps } from 'reka-ui'
import { watch, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import {
  AlertDialogContent,
  injectDialogRootContext,
  AlertDialogOverlay,
  AlertDialogPortal,
  useForwardPropsEmits
} from 'reka-ui'
import { cn } from '@shadcn/lib/utils'

const props = defineProps<AlertDialogContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<AlertDialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
const dialog = injectDialogRootContext()
let returnFocus: HTMLElement | null = null
watch(
  dialog.open,
  (open) => {
    if (open) returnFocus = document.activeElement as HTMLElement | null
  },
  { immediate: true, flush: 'sync' }
)

function restoreProgrammaticTrigger(event: Event) {
  if (event.defaultPrevented || dialog.triggerElement.value?.isConnected) return
  event.preventDefault()
  if (returnFocus?.isConnected && returnFocus !== document.body) {
    returnFocus.focus({ preventScroll: true })
  } else if (
    document.activeElement === document.body ||
    dialog.contentElement.value?.contains(document.activeElement)
  ) {
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
  }
}
</script>

<template>
  <AlertDialogPortal>
    <AlertDialogOverlay
      data-slot="alert-dialog-overlay"
      class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
    />
    <AlertDialogContent
      data-slot="alert-dialog-content"
      v-bind="forwarded"
      @close-auto-focus="restoreProgrammaticTrigger"
      :class="
        cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg',
          props.class
        )
      "
    >
      <slot />
    </AlertDialogContent>
  </AlertDialogPortal>
</template>
