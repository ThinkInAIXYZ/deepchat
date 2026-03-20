<template>
  <div class="splash-shell">
    <div class="loader-stage">
      <div class="loader-wrapper">
        <span class="loader-letter">D</span>
        <span class="loader-letter">e</span>
        <span class="loader-letter">e</span>
        <span class="loader-letter">p</span>
        <span class="loader-letter">C</span>
        <span class="loader-letter">h</span>
        <span class="loader-letter">a</span>
        <span class="loader-letter">t</span>
        <div class="loader"></div>
      </div>
    </div>

    <div v-if="activities.length > 0" class="activity-feed">
      <div v-for="activity in activities" :key="activity.key" class="activity-item">
        <span v-if="activity.status === 'completed'" class="status-icon status-icon--completed"
          >✔</span
        >
        <span v-else-if="activity.status === 'failed'" class="status-icon status-icon--failed"
          >!</span
        >
        <span v-else class="status-dot status-dot--running" aria-hidden="true"></span>
        <span class="activity-label">{{ getActivityLabel(activity.name) }}</span>
      </div>
    </div>

    <div class="logo-corner">
      <img
        src="@/assets/logo.png"
        alt="DeepChat Logo"
        class="logo-mark"
        style="filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.24))"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

type SplashActivityStatus = 'running' | 'completed' | 'failed'

interface SplashActivityItem {
  key: string
  name: string
  status: SplashActivityStatus
}

interface SplashUpdatePayload {
  activities?: SplashActivityItem[]
}

const activities = ref<SplashActivityItem[]>([])

const ACTIVITY_LABELS: Record<string, string> = {
  'config-initialization': 'Loading configuration',
  'database-initialization': 'Opening local database',
  'protocol-registration': 'Registering app protocol',
  'presenter-initialization': 'Initializing presenters',
  'event-listener-setup': 'Attaching event listeners',
  'acp-registry-migration': 'Migrating registry data',
  'window-creation': 'Creating main window',
  'tray-setup': 'Starting tray integration',
  'rtk-health-check': 'Checking runtime health',
  'legacy-import': 'Queueing legacy import',
  'usage-stats-backfill': 'Queueing usage stats backfill',
  'startup-error': 'Startup error'
}

const getActivityLabel = (name: string) => {
  if (ACTIVITY_LABELS[name]) {
    return ACTIVITY_LABELS[name]
  }

  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const handleSplashUpdate = (_event: unknown, payload: SplashUpdatePayload) => {
  activities.value = payload.activities?.slice(0, 3) ?? []
}

onMounted(() => {
  window.electron?.ipcRenderer?.on?.('splash-update', handleSplashUpdate)
})

onBeforeUnmount(() => {
  window.electron?.ipcRenderer?.removeListener?.('splash-update', handleSplashUpdate)
})
</script>

<style scoped>
.splash-shell {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  user-select: none;
  color: white;
  background: linear-gradient(135deg, var(--base-900) 0%, var(--base-950) 100%);
  font-family:
    'Geist',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
}

.loader-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
}

.loader-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 154px;
  height: 154px;
  font-family:
    'Geist',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  font-size: 1.04em;
  font-weight: 300;
  color: white;
  border-radius: 50%;
  background-color: transparent;
  user-select: none;
}

.loader {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  background-color: transparent;
  animation: loader-rotate 2s linear infinite;
  z-index: 0;
}

@keyframes loader-rotate {
  0% {
    transform: rotate(90deg);
    box-shadow:
      0 8px 16px 0 var(--primary-200) inset,
      0 16px 32px 0 var(--primary-500) inset,
      0 32px 64px 0 var(--primary-800) inset;
  }
  25% {
    transform: rotate(180deg);
    box-shadow:
      0 10px 20px 0 var(--primary-100) inset,
      0 20px 40px 0 var(--primary-400) inset,
      0 40px 80px 0 var(--primary-700) inset;
  }
  50% {
    transform: rotate(270deg);
    box-shadow:
      0 12px 24px 0 var(--primary-200) inset,
      0 24px 48px 0 var(--primary-500) inset,
      0 48px 96px 0 var(--primary-900) inset;
  }
  75% {
    transform: rotate(360deg);
    box-shadow:
      0 10px 20px 0 var(--primary-100) inset,
      0 20px 40px 0 var(--primary-400) inset,
      0 40px 80px 0 var(--primary-700) inset;
  }
  100% {
    transform: rotate(450deg);
    box-shadow:
      0 8px 16px 0 var(--primary-200) inset,
      0 16px 32px 0 var(--primary-500) inset,
      0 32px 64px 0 var(--primary-800) inset;
  }
}

.loader-letter {
  display: inline-block;
  opacity: 0.6;
  transform: translateY(0);
  animation: loader-letter-anim 2s infinite;
  z-index: 1;
  border-radius: 50ch;
  border: none;
  color: var(--primary-200);
}

.activity-feed {
  position: absolute;
  left: 24px;
  bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 220px;
  max-width: calc(100% - 104px);
  font-size: 12px;
  line-height: 1.32;
  color: rgb(203 213 225 / 92%);
  z-index: 0;
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 16px;
}

.activity-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-item:first-child {
  margin-bottom: -16px;
  opacity: 0.5;
  transform: translateY(-16px);
}

.status-icon {
  flex: 0 0 10px;
  width: 10px;
  font-size: 12px;
  line-height: 1;
  text-align: center;
}

.status-icon--completed {
  color: var(--primary-100);
}

.status-icon--failed {
  color: #f87171;
  font-weight: 600;
}

.status-dot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.status-dot--running {
  background: #4ade80;
  box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
  animation: status-breathe 1.5s ease-in-out infinite;
}

.logo-corner {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 2;
}

.logo-mark {
  width: 32px;
  height: 32px;
  object-fit: contain;
  opacity: 0.68;
}

.loader-letter:nth-child(1) {
  animation-delay: 0s;
}
.loader-letter:nth-child(2) {
  animation-delay: 0.1s;
}
.loader-letter:nth-child(3) {
  animation-delay: 0.2s;
}
.loader-letter:nth-child(4) {
  animation-delay: 0.3s;
}
.loader-letter:nth-child(5) {
  animation-delay: 0.4s;
}
.loader-letter:nth-child(6) {
  animation-delay: 0.5s;
}
.loader-letter:nth-child(7) {
  animation-delay: 0.6s;
}
.loader-letter:nth-child(8) {
  animation-delay: 0.7s;
}

@keyframes loader-letter-anim {
  0%,
  100% {
    opacity: 0.6;
    transform: translateY(0);
  }
  20% {
    opacity: 1;
    transform: scale(1.15);
    color: var(--primary-100);
  }
  40% {
    opacity: 0.8;
    transform: translateY(0);
  }
}

@keyframes status-breathe {
  0%,
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5);
    opacity: 0.72;
  }
  50% {
    transform: scale(1.16);
    box-shadow: 0 0 0 5px rgba(74, 222, 128, 0);
    opacity: 1;
  }
}

@media (max-width: 420px) {
  .loader-wrapper {
    width: 146px;
    height: 146px;
    font-size: 0.96em;
  }

  .activity-feed {
    width: 204px;
    max-width: calc(100% - 96px);
    bottom: 24px;
    font-size: 11.5px;
    gap: 5px;
  }
}
</style>
