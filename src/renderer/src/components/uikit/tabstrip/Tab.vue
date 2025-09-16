<script setup lang="ts">
import { IconButton } from '@/components/uikit/icon-button'

type Props = {
  active?: boolean
  closable?: boolean
  class?: string
}
const emit = defineEmits<{
  (e: 'click'): void
  (e: 'close'): void
  (e: 'dragstart', ev: DragEvent): void
  (e: 'dragover', ev: DragEvent): void
}>()

withDefaults(defineProps<Props>(), {
  active: false,
  closable: true
})
</script>

<template>
  <div
    :class="[
      'h-9 px-3 rounded-md flex items-center gap-2 select-none cursor-default',
      'border border-transparent',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'hover:bg-accent hover:text-accent-foreground',
      $props.class
    ]"
    draggable="true"
    @dragstart="$emit('dragstart', $event)"
    @dragover="$emit('dragover', $event)"
    @click="emit('click')"
  >
    <slot />
    <IconButton v-if="closable" class="ml-1" @click.stop="emit('close')">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        class="size-4"
      >
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </IconButton>
  </div>
</template>
