<template>
  <div
    v-if="isBlocked"
    class="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center"
    @click.stop
    @keydown.stop
  >
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md mx-4">
      <!-- Migration Icon -->
      <div class="flex justify-center mb-4">
        <div
          class="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center"
        >
          <Icon icon="lucide:database" class="w-8 h-8 text-blue-600 dark:text-blue-400" />
        </div>
      </div>

      <!-- Title -->
      <h2 class="text-xl font-semibold text-center mb-2 text-gray-900 dark:text-gray-100">
        {{ t('migration.blocking.title') }}
      </h2>

      <!-- Description -->
      <p class="text-gray-600 dark:text-gray-300 text-center mb-4">
        {{ t('migration.blocking.description') }}
      </p>

      <!-- Current Phase -->
      <div v-if="currentPhase" class="mb-4">
        <div
          class="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 mb-2"
        >
          <span>{{ t('migration.blocking.currentPhase') }}:</span>
          <span class="font-medium">{{ getPhaseDisplayName(currentPhase) }}</span>
        </div>

        <!-- Progress Bar -->
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            class="bg-blue-600 h-2 rounded-full transition-all duration-300"
            :style="{ width: `${progressPercentage}%` }"
          ></div>
        </div>

        <!-- Estimated Time -->
        <div
          v-if="estimatedTimeRemaining"
          class="text-center text-sm text-gray-500 dark:text-gray-400 mt-2"
        >
          {{ t('migration.blocking.estimatedTime') }}: {{ formatTime(estimatedTimeRemaining) }}
        </div>
      </div>

      <!-- Loading Animation -->
      <div class="flex justify-center mb-4">
        <Icon
          icon="lucide:loader-2"
          class="w-6 h-6 animate-spin text-blue-600 dark:text-blue-400"
        />
      </div>

      <!-- Warning Message -->
      <div
        class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3"
      >
        <div class="flex items-start">
          <Icon
            icon="lucide:alert-triangle"
            class="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 mr-2 flex-shrink-0"
          />
          <div class="text-sm text-yellow-800 dark:text-yellow-200">
            {{ t('migration.blocking.warning') }}
          </div>
        </div>
      </div>

      <!-- Action Buttons (if any) -->
      <div v-if="showActions" class="flex justify-center mt-4 space-x-3">
        <Button
          v-if="canCancel"
          variant="outline"
          size="sm"
          @click="handleCancel"
          :disabled="isCancelling"
        >
          <Icon v-if="isCancelling" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
          {{ t('migration.blocking.cancel') }}
        </Button>

        <Button variant="ghost" size="sm" @click="showDetails = !showDetails">
          {{
            showDetails ? t('migration.blocking.hideDetails') : t('migration.blocking.showDetails')
          }}
        </Button>
      </div>

      <!-- Details Section -->
      <div v-if="showDetails" class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div class="text-sm text-gray-600 dark:text-gray-300 space-y-2">
          <div v-if="startTime" class="flex justify-between">
            <span>{{ t('migration.blocking.details.startTime') }}:</span>
            <span>{{ formatDateTime(startTime) }}</span>
          </div>
          <div v-if="currentPhase" class="flex justify-between">
            <span>{{ t('migration.blocking.details.phase') }}:</span>
            <span>{{ currentPhase }}</span>
          </div>
          <div v-if="recordsProcessed !== undefined" class="flex justify-between">
            <span>{{ t('migration.blocking.details.recordsProcessed') }}:</span>
            <span>{{ recordsProcessed.toLocaleString() }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'

interface Props {
  isBlocked?: boolean
  currentPhase?: string
  progressPercentage?: number
  estimatedTimeRemaining?: number
  startTime?: number
  recordsProcessed?: number
  canCancel?: boolean
  showActions?: boolean
}

interface Emits {
  (e: 'cancel'): void
}

const props = withDefaults(defineProps<Props>(), {
  isBlocked: false,
  progressPercentage: 0,
  canCancel: false,
  showActions: true
})

const emit = defineEmits<Emits>()
const { t } = useI18n()

// Local state
const showDetails = ref(false)
const isCancelling = ref(false)

// IPC listeners
let uiBlockedListener: ((event: any, data: any) => void) | null = null
let uiUnblockedListener: ((event: any) => void) | null = null

onMounted(() => {
  // Set up IPC listeners for UI blocking/unblocking
  uiBlockedListener = (_event: any, data: any) => {
    console.log('[Migration Blocking] UI blocked:', data)
    // The parent component should handle the blocking state
  }

  uiUnblockedListener = (_event: any) => {
    console.log('[Migration Blocking] UI unblocked')
    // The parent component should handle the unblocking state
  }

  // Register IPC listeners
  window.electron?.ipcRenderer?.on('migration:ui-blocked', uiBlockedListener)
  window.electron?.ipcRenderer?.on('migration:ui-unblocked', uiUnblockedListener)
})

onUnmounted(() => {
  // Clean up IPC listeners
  if (uiBlockedListener) {
    window.electron?.ipcRenderer?.removeListener('migration:ui-blocked', uiBlockedListener)
  }
  if (uiUnblockedListener) {
    window.electron?.ipcRenderer?.removeListener('migration:ui-unblocked', uiUnblockedListener)
  }
})

// Computed properties
const phaseDisplayNames = computed(() => ({
  detection: t('migration.phases.detection'),
  backup: t('migration.phases.backup'),
  schema: t('migration.phases.schema'),
  data: t('migration.phases.data'),
  validation: t('migration.phases.validation'),
  cleanup: t('migration.phases.cleanup'),
  initializing: t('migration.phases.initializing'),
  completing: t('migration.phases.completing')
}))

// Methods
const getPhaseDisplayName = (phase: string): string => {
  return phaseDisplayNames.value[phase as keyof typeof phaseDisplayNames.value] || phase
}

const formatTime = (milliseconds: number): string => {
  const seconds = Math.ceil(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  } else {
    return `${remainingSeconds}s`
  }
}

const formatDateTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString()
}

const handleCancel = async () => {
  if (isCancelling.value) return

  isCancelling.value = true

  try {
    // Emit cancel event to parent
    emit('cancel')

    // Also try to cancel via IPC
    await window.electron?.ipcRenderer?.invoke('migration:cancel')
  } catch (error) {
    console.error('Failed to cancel migration:', error)
  } finally {
    isCancelling.value = false
  }
}

// Prevent keyboard shortcuts and interactions when blocked
const handleKeydown = (event: KeyboardEvent) => {
  if (props.isBlocked) {
    event.preventDefault()
    event.stopPropagation()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown, true)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown, true)
})
</script>

<style scoped>
/* Ensure the overlay is above everything */
.z-\[9999\] {
  z-index: 9999;
}

/* Prevent scrolling when overlay is active */
.fixed.inset-0 {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}
</style>
