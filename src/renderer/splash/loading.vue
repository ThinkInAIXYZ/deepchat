<template>
  <div
    class="min-h-screen flex flex-col justify-center items-center overflow-hidden select-none text-white font-['Geist',-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,sans-serif]"
    style="
      background: linear-gradient(135deg, hsl(var(--primary-600)) 0%, hsl(var(--primary-800)) 100%);
    "
  >
    <div class="text-center max-w-sm w-full px-6 animate-fade-in">
      <!-- Logo -->
      <div class="mb-6">
        <div
          class="w-20 h-20 mx-auto flex items-center justify-center rounded-full border border-white/30 shadow-2xl"
          style="
            background: rgba(255, 255, 255, 0.25);
            backdrop-filter: blur(20px);
            box-shadow:
              0 8px 32px rgba(0, 0, 0, 0.3),
              0 0 0 1px rgba(255, 255, 255, 0.1),
              inset 0 1px 0 rgba(255, 255, 255, 0.2);
          "
        >
          <img
            src="@/assets/logo.png"
            alt="DeepChat Logo"
            class="w-12 h-12 object-contain"
            style="
              filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4))
                drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2)) brightness(1.1) contrast(1.2);
            "
          />
        </div>
      </div>

      <!-- App Name -->
      <h1 class="text-2xl font-semibold mb-2 opacity-90" style="font-weight: var(--display-weight)">
        DeepChat
      </h1>

      <!-- Progress Bar -->
      <div class="mb-6">
        <div
          class="w-full h-1 rounded-full overflow-hidden mb-3"
          style="background: rgba(255, 255, 255, 0.2)"
        >
          <div
            class="h-full rounded-full transition-all duration-300 ease-out"
            style="
              background: linear-gradient(
                90deg,
                hsl(var(--primary-200)) 0%,
                hsl(var(--primary-100)) 100%
              );
            "
            :style="{ width: `${progress}%` }"
          />
        </div>
        <div class="text-xs opacity-80 text-right">{{ Math.round(progress) }}%</div>
      </div>

      <!-- Status Message -->
      <p class="text-sm opacity-80 min-h-5 mb-6">{{ statusMessage }}</p>

      <!-- Loading Spinner -->
      <div
        class="w-5 h-5 mx-auto border-2 border-white/30 border-t-white rounded-full animate-spin"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// Reactive state
const progress = ref(0)
const statusMessage = ref('')

onMounted(() => {
  // Set initial status message
  statusMessage.value = 'loading...'

  // Listen for progress updates from main process
  if (window.electron?.ipcRenderer) {
    const handleProgressUpdate = (_: any, data: { progress: number; message?: string }) => {
      progress.value = data.progress
      if (data.message) {
        statusMessage.value = data.message
      }
    }

    const handleMessageUpdate = (_: any, data: { message: string }) => {
      statusMessage.value = data.message
    }

    window.electron.ipcRenderer.on('splash-update', handleProgressUpdate)
    window.electron.ipcRenderer.on('splash-message', handleMessageUpdate)
  }
})

onUnmounted(() => {
  // Cleanup listeners
  window.electron.ipcRenderer.removeAllListeners('splash-update')
  window.electron.ipcRenderer.removeAllListeners('splash-message')
})
</script>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in {
  animation: fadeIn 0.5s ease-in;
}
</style>
