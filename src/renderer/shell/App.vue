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
import { useDeviceVersion } from '@/composables/useDeviceVersion'

// Detect platform to apply proper styling
const { isWinMacOS } = useDeviceVersion()
</script>

<style>
html,
body {
  background-color: transparent;
}
</style>
