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
      'group h-9 px-3 rounded-md flex items-center gap-2 select-none cursor-default',
      'min-w-[128px] max-w-[200px] overflow-hidden',
      'border',
      active
        ? 'bg-white/10 text-foreground border-[color:var(--border)]'
        : 'text-secondary-foreground hover:bg-white/5 border-transparent',
      $props.class
    ]"
    draggable="true"
    @dragstart="$emit('dragstart', $event)"
    @dragover="$emit('dragover', $event)"
    @click="emit('click')"
  >
    <slot />
    <IconButton
      v-if="closable"
      class="ml-1 transition-opacity"
      :class="active ? 'opacity-80 group-hover:opacity-100' : 'opacity-50 group-hover:opacity-80'"
      @click.stop="emit('close')"
    >
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
