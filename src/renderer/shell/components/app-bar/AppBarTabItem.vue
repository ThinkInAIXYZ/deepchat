<template>
  <div
    ref="tabItem"
    draggable="true"
    class="win-tab group transition-all duration-200"
    :class="{ 'active': active }"
    @dragstart="onDragStart"
    @click="onClick"
  >
    <div class="flex items-center justify-between w-full" :dir="langStore.dir">
      <div class="flex items-center truncate flex-1 min-w-0">
        <slot></slot>
      </div>
      <button
        v-if="size > 1"
        class="ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-sm hover:bg-zinc-500/20 dark:hover:bg-white/10 p-0.5 flex-shrink-0"
        @click.stop="onClose"
      >
        <Icon icon="lucide:x" class="w-3 h-3" />
      </button>
    </div>
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

<style scoped>
.win-tab {
  /* Auto layout matching Figma design */
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: 0px 12px;

  width: 136px;
  min-width: 128px;
  height: 36px;

  border-width: 0px 1px;
  border-style: solid;
  border-color: rgba(0, 0, 0, 0.05);

  /* Inside auto layout */
  flex: none;
  align-self: stretch;
  flex-grow: 0;
}

.win-tab.active {
  background: #FFFFFF;
}

.win-tab:not(.active) {
  background: #F8F9FA;
}

/* Dark mode overrides */
.dark .win-tab {
  border-color: rgba(255, 255, 255, 0.05);
}

.dark .win-tab.active {
  background: #1F2937;
  border-color: rgba(255, 255, 255, 0.1);
}

.dark .win-tab:not(.active) {
  background: rgba(15, 23, 42, 0.5);
}

.dark .win-tab:not(.active):hover {
  background: rgba(30, 41, 59, 0.5);
}
</style>
