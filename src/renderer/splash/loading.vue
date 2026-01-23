<template>
  <div class="w-screen h-screen flex items-center justify-center select-none overflow-hidden">
    <main class="flex items-center gap-4 w-full px-5">
      <div class="flex-shrink-0">
        <img
          src="@/assets/logo.png"
          alt="DeepChat"
          class="w-10 h-10 rounded-xl shadow-lg object-contain"
          draggable="false"
        />
      </div>

      <div class="w-[220px] flex flex-col">
        <div class="w-full">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${progressClamped}%` }"></div>
          </div>
        </div>

        <div class="mt-1.5 flex items-center justify-between text-[#4b5563] font-light text-sm">
          <span class="truncate">{{ message }}</span>
          <span class="tabular-nums">{{ progressText }}</span>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type SplashUpdatePayload = {
  phase?: string
  progress?: number
  message?: string
}

const message = ref('Starting...')
const progress = ref(0)

const progressClamped = computed(() => Math.max(0, Math.min(100, progress.value)))
const progressText = computed(() => `${progressClamped.value.toFixed(0)}%`)

const onSplashUpdate = (_event: unknown, payload: SplashUpdatePayload) => {
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    message.value = payload.message
  }
  if (typeof payload?.progress === 'number' && Number.isFinite(payload.progress)) {
    progress.value = payload.progress
  }
}

onMounted(() => {
  window.electron?.ipcRenderer?.on('splash-update', onSplashUpdate)
})

onBeforeUnmount(() => {
  window.electron?.ipcRenderer?.removeListener('splash-update', onSplashUpdate)
})
</script>

<style scoped>
.progress-track {
  background: transparent;
  border: 1px solid #9ca3af;
  border-radius: 9999px;
  height: 6px;
  position: relative;
  overflow: hidden;
}

.progress-fill {
  background: linear-gradient(90deg, #3b82f6, #22d3ee);
  height: 100%;
  border-radius: 9999px;
  position: relative;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.8);
  transition: width 200ms ease-out;
}
</style>
