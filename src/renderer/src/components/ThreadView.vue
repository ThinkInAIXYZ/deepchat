<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="chatStore.isSidebarOpen" class="fixed inset-0 z-50" :dir="langStore.dir">
        <div class="absolute inset-0 bg-transparent" @click="closeSidebar"></div>
        <div
          class="relative h-full flex"
          :class="langStore.dir === 'rtl' ? 'justify-end' : 'justify-start'"
        >
          <Transition
            enter-active-class="transition-transform duration-200 ease-out"
            leave-active-class="transition-transform duration-150 ease-in"
            :enter-from-class="langStore.dir === 'rtl' ? 'translate-x-full' : '-translate-x-full'"
            :leave-to-class="langStore.dir === 'rtl' ? 'translate-x-full' : '-translate-x-full'"
          >
            <div
              v-if="chatStore.isSidebarOpen"
              class="h-full w-60 max-w-60 shadow-lg border-r border-border bg-card"
            >
              <ThreadsView class="h-full" />
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import ThreadsView from './ThreadsView.vue'
import { useChatStore } from '@/stores/chat'
import { useLanguageStore } from '@/stores/language'

const chatStore = useChatStore()
const langStore = useLanguageStore()

const closeSidebar = () => {
  chatStore.isSidebarOpen = false
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && chatStore.isSidebarOpen) {
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
