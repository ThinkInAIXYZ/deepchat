<template>
  <div
    ref="tabItem"
    draggable="true"
    class="shrink-0 hover:bg-bg-card/80 text-xs font-medium text-foreground px-3 h-full flex items-center justify-between transition-all duration-200 group border-r first:border-l border-border"
    :class="[active ? 'bg-bg-card/60' : '']"
    @dragstart="onDragStart"
    @click="onClick"
  >
    <div class="flex items-center truncate max-w-36" :dir="langStore.dir">
      <slot></slot>
    </div>

    <Icon
      icon="lucide:x"
      class="w-5 h-5 ml-2 text-muted-foreground opacity-0 transition-opacity duration-200 rounded-full hover:text-foreground p-0.5"
      :class="[size > 1 ? 'group-hover:opacity-100' : 'pointer-events-none cursor-default']"
      @click.stop="onClose"
    />
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
