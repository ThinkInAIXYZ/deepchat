<template>
  <div
    ref="tabItem"
    draggable="true"
    class="shrink-0 text-xs font-medium pl-2 pr-1 h-7 mt-0.5 rounded-md flex items-center justify-between transition-all duration-200 group"
    :class="[
      active
        ? 'bg-white dark:bg-white/10 shadow-sm dark:shadow-[inset_0_0px_1px_0_rgba(255,255,255,0.3)]'
        : 'bg-transparent text-secondary-foreground hover:bg-black/20 active:bg-zinc-900/20'
    ]"
    @dragstart="onDragStart"
    @click="onClick"
  >
    <div class="flex items-center truncate max-w-36" :dir="langStore.dir">
      <slot></slot>
    </div>
    <button
      class="ml-2 opacity-0 transition-opacity duration-200 rounded-full hover:bg-zinc-500/20 p-0.5"
      :class="[size > 1 ? 'group-hover:opacity-100 ' : 'pointer-events-none cursor-default']"
      @click.stop="onClose"
    >
      <Icon icon="lucide:x" class="w-3 h-3" />
    </button>
  </div>
</template>
<script setup lang="ts">
import { useLanguageStore } from '@/stores/language'
import { Icon } from '@iconify/vue'
import { ref } from 'vue'
const langStore = useLanguageStore()

const tabItem = ref<HTMLElement | null>(null)

const emit = defineEmits<{
  (e: 'click'): void
  (e: 'close'): void
  (e: 'dragstart', event: DragEvent): void
}>()

defineProps<{
  active: boolean
  size: number
  index: number
}>()

const onClick = () => {
  emit('click')

  if (tabItem.value instanceof HTMLElement) {
    setTimeout(() => {
      tabItem.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }
}

const onClose = () => {
  emit('close')
}

const onDragStart = (event: DragEvent) => {
  emit('dragstart', event)
}
</script>
