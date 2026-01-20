<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      :enter-from-class="'translate-x-full'"
      :leave-to-class="'translate-x-full'"
    >
      <div
        v-if="layoutStore.isThreadSidebarOpen"
        class="fixed inset-0 z-50 flex justify-end"
        :dir="langStore.dir"
        @click.self="closeSidebar"
      >
        <div
          v-if="layoutStore.isThreadSidebarOpen"
          :class="[
            'h-full w-60 max-w-60 shadow-lg bg-card',
            langStore.dir === 'rtl' ? 'border-l' : 'border-r',
            'border-border'
          ]"
          @click.stop
        >
          <ThreadsView class="h-full" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import ThreadsView from './ThreadsView.vue'
import { useLayoutStore } from '@/stores/layoutStore'
import { useLanguageStore } from '@/stores/language'

const layoutStore = useLayoutStore()
const langStore = useLanguageStore()

const closeSidebar = () => {
  layoutStore.closeThreadSidebar()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && layoutStore.isThreadSidebarOpen) {
    closeSidebar()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>
