<template>
  <span
    :data-testid="`tape-inspector-resize-${column}`"
    class="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize touch-none hover:bg-ring/50"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="value"
    tabindex="0"
    @pointerdown="emit('resizeStart', $event)"
    @pointermove="emit('resizeMove', $event)"
    @pointerup="emit('resizeEnd', $event)"
    @pointercancel="emit('resizeCancel')"
    @keydown.left.prevent="emit('resizeBy', -16)"
    @keydown.right.prevent="emit('resizeBy', 16)"
  />
</template>

<script setup lang="ts">
defineProps<{
  column: string
  label: string
  min: number
  max: number
  value: number
}>()

const emit = defineEmits<{
  resizeStart: [event: PointerEvent]
  resizeMove: [event: PointerEvent]
  resizeEnd: [event: PointerEvent]
  resizeCancel: []
  resizeBy: [delta: number]
}>()
</script>
