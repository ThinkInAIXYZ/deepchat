<template>
  <div
    ref="tabItem"
    draggable="true"
    class="shrink-0 hover:bg-card/80 text-xs font-medium text-foreground px-2 h-full flex items-center justify-between group border-r first:border-l border-border"
    :class="[active ? 'bg-card' : '']"
    @dragstart="onDragStart"
    @click="onClick"
  >
    <div class="flex items-center truncate max-w-36" :dir="langStore.dir">
      <slot></slot>
    </div>

    <Icon
      icon="lucide:x"
      class="w-5 h-5 ml-2 text-muted-foreground opacity-0 transition-opacity duration-200 rounded hover:text-foreground p-0.5 hover:bg-accent-foreground/10"
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
