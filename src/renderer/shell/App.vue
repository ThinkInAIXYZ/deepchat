<template>
  <div class="w-screen h-screen" :class="isWinMacOS ? '' : 'bg-background'">
    <AppBar />
    <main class="content-container">
      <!-- WebContentsView will be rendered here by the main process -->
    </main>
  </div>
</template>

<script setup lang="ts">
import AppBar from './components/AppBar.vue'
import { ref, onMounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
const isWinMacOS = ref(false)
const devicePresenter = usePresenter('devicePresenter')
// Shell component setup
onMounted(() => {
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isWinMacOS.value = deviceInfo.platform === 'darwin' || deviceInfo.platform === 'win32'
  })
})
</script>

<style>
html,
body {
  background-color: transparent;
}
</style>
