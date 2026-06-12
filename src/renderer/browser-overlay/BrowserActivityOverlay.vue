<template>
  <div class="activity-overlay" :class="{ reduced: reducedMotion }" aria-hidden="true">
    <div class="halo" :class="{ active: haloVisible }" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { YoBrowserActivityPayload } from '@shared/types/browser'

const HALO_SETTLE_MS = 900
const ACTIVITY_SAFETY_TTL_MS = 2500

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const pendingActivities = new Map<string, number>()
const activityCleanupTimers = new Map<string, number>()
const haloVisible = ref(false)
let haloFadeTimer: number | null = null

const setHaloActive = () => {
  if (haloFadeTimer !== null) {
    window.clearTimeout(haloFadeTimer)
    haloFadeTimer = null
  }
  haloVisible.value = true
}

const scheduleHaloFade = () => {
  if (pendingActivities.size > 0) {
    return
  }

  if (haloFadeTimer !== null) {
    window.clearTimeout(haloFadeTimer)
  }

  haloFadeTimer = window.setTimeout(() => {
    haloVisible.value = false
    haloFadeTimer = null
  }, HALO_SETTLE_MS)
}

const completeActivity = (id: string) => {
  pendingActivities.delete(id)
  const cleanupTimer = activityCleanupTimers.get(id)
  if (cleanupTimer !== undefined) {
    window.clearTimeout(cleanupTimer)
    activityCleanupTimers.delete(id)
  }
  scheduleHaloFade()
}

const startActivity = (payload: YoBrowserActivityPayload) => {
  const existingCleanupTimer = activityCleanupTimers.get(payload.id)
  if (existingCleanupTimer !== undefined) {
    window.clearTimeout(existingCleanupTimer)
    activityCleanupTimers.delete(payload.id)
  }

  pendingActivities.set(payload.id, Date.now())
  setHaloActive()

  const cleanupTimer = window.setTimeout(() => {
    activityCleanupTimers.delete(payload.id)
    completeActivity(payload.id)
  }, ACTIVITY_SAFETY_TTL_MS)
  activityCleanupTimers.set(payload.id, cleanupTimer)
}

const handleActivity = (payload: YoBrowserActivityPayload) => {
  if (payload.phase === 'started') {
    startActivity(payload)
    return
  }

  completeActivity(payload.id)
}

const stopActivityListener = window.yoBrowserOverlay.onActivityChanged(handleActivity)

onBeforeUnmount(() => {
  stopActivityListener()

  if (haloFadeTimer !== null) {
    window.clearTimeout(haloFadeTimer)
  }

  activityCleanupTimers.forEach((timer) => window.clearTimeout(timer))
  activityCleanupTimers.clear()
})
</script>

<style scoped>
.activity-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.halo {
  position: absolute;
  inset: 2px;
  border: 1px solid transparent;
  border-radius: 8px;
  opacity: 0;
  box-shadow: inset 0 0 0 1px transparent;
  transition:
    opacity 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.halo::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  border: 2px solid transparent;
  background: linear-gradient(90deg, rgb(56 189 248), rgb(52 211 153), rgb(56 189 248)) border-box;
  mask:
    linear-gradient(#000 0 0) padding-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  opacity: 0;
  animation: halo-flow 2.8s linear infinite;
}

.halo.active {
  border-color: rgb(186 230 253 / 0.85);
  opacity: 1;
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 0.45),
    inset 0 0 24px rgb(56 189 248 / 0.18),
    0 0 20px rgb(56 189 248 / 0.38),
    0 0 42px rgb(52 211 153 / 0.2);
}

.halo.active::before {
  opacity: 0.78;
}

@keyframes halo-flow {
  from {
    filter: hue-rotate(0deg);
  }
  to {
    filter: hue-rotate(360deg);
  }
}

.reduced .halo::before {
  animation: none;
}
</style>
