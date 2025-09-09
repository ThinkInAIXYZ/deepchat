<template>
  <div
    class="w-screen h-screen flex flex-col"
    :class="[isMacOS ? 'bg-transparent' : themeStore.isDark ? 'bg-zinc-900' : 'bg-zinc-200']"
  >
    <AppBar />
    <main class="content-container flex-1">
      <!-- WebContentsView will be rendered here by the main process -->
    </main>
  </div>
</template>

<script setup lang="ts">
import AppBar from './components/AppBar.vue'
import { ref, onMounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useThemeStore } from '@/stores/theme'
const isMacOS = ref(false)
const themeStore = useThemeStore()
const devicePresenter = usePresenter('devicePresenter')
// Shell component setup
onMounted(() => {
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })
})
</script>

<style>
html,
body {
  @apply bg-transparent;
}
</style>
