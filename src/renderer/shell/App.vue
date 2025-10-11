<template>
  <div class="w-screen h-screen" :class="['bg-card']">
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
const isMacOS = ref(false)
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
  background-color: transparent;
}
</style>
