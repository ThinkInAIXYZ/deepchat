<script setup lang="ts">
import type { ContextMenuTriggerProps } from "reka-ui"
import { ContextMenuTrigger, useForwardProps } from "reka-ui"

const props = defineProps<ContextMenuTriggerProps>()

const forwardedProps = useForwardProps(props)

function openFromKeyboard(event: KeyboardEvent) {
  if (props.disabled || event.defaultPrevented) return
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  const target = event.currentTarget as HTMLElement
  event.preventDefault()
  event.stopPropagation()
  const rect = target.getBoundingClientRect()
  target.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: rect.left,
    clientY: rect.bottom
  }))
}
</script>

<template>
  <ContextMenuTrigger
    data-slot="context-menu-trigger"
    v-bind="forwardedProps"
    @keydown="openFromKeyboard"
  >
    <slot />
  </ContextMenuTrigger>
</template>
