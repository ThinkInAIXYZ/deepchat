<template>
  <div>
    <!-- Migration Progress Dialog -->
    <MigrationProgressDialog
      v-model:open="showProgressDialog"
      :can-cancel="canCancelMigration"
      @cancel="handleMigrationCancel"
    />

    <!-- Migration Error Dialog -->
    <MigrationErrorDialog
      v-model:open="showErrorDialog"
      @retry="handleMigrationRetry"
      @rollback="handleMigrationRollback"
      @get-help="handleGetHelp"
      @show-troubleshooting="handleShowTroubleshooting"
    />

    <!-- Migration Troubleshooting Guide -->
    <MigrationTroubleshootingGuide v-model:open="showTroubleshootingDialog" />

    <!-- Migration Blocking Overlay -->
    <MigrationBlockingOverlay
      :is-blocked="migrationState.isBlocked"
      :current-phase="migrationState.currentPhase"
      :progress-percentage="migrationState.progressPercentage"
      :estimated-time-remaining="migrationState.estimatedTimeRemaining"
      :start-time="migrationState.startTime"
      :records-processed="migrationState.recordsProcessed"
      :can-cancel="canCancelMigration"
      @cancel="handleMigrationCancel"
    />

    <!-- Migration Confirmation Dialog -->
    <Dialog v-model:open="showConfirmationDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('migration.confirmation.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('migration.confirmation.description') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <!-- Migration Information -->
          <div class="p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div class="flex items-start space-x-2">
              <Icon icon="lucide:info" class="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div class="flex-1 text-sm">
                <div class="font-medium text-blue-800">
                  {{ t('migration.confirmation.info.title') }}
                </div>
                <div class="text-blue-700 mt-1">
                  {{ t('migration.confirmation.info.description') }}
                </div>
              </div>
            </div>
          </div>

          <!-- Database Information -->
          <div v-if="legacyDatabases.length > 0" class="space-y-2">
            <div class="text-sm font-medium">{{ t('migration.confirmation.databases') }}:</div>
            <div class="space-y-1">
              <div
                v-for="db in legacyDatabases"
                :key="db.path"
                class="flex items-center justify-between text-sm p-2 bg-gray-50 rounded"
              >
                <div class="flex items-center space-x-2">
                  <Icon
                    :icon="db.type === 'sqlite' ? 'lucide:database' : 'lucide:brain'"
                    class="w-4 h-4 text-muted-foreground"
                  />
                  <span>{{ db.type.toUpperCase() }}</span>
                </div>
                <div class="text-muted-foreground">
                  {{ formatSize(db.size) }} • {{ db.recordCount.toLocaleString() }} records
                </div>
              </div>
            </div>
          </div>

          <!-- Backup Information -->
          <div class="p-3 bg-green-50 border border-green-200 rounded-md">
            <div class="flex items-start space-x-2">
              <Icon
                icon="lucide:shield-check"
                class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0"
              />
              <div class="flex-1 text-sm">
                <div class="font-medium text-green-800">
                  {{ t('migration.confirmation.backup.title') }}
                </div>
                <div class="text-green-700 mt-1">
                  {{ t('migration.confirmation.backup.description') }}
                </div>
              </div>
            </div>
          </div>

          <!-- Estimated Time -->
          <div v-if="estimatedDuration" class="text-sm text-muted-foreground">
            {{ t('migration.confirmation.estimatedTime') }}: {{ formatTime(estimatedDuration) }}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="handleConfirmationCancel">
            {{ t('migration.confirmation.cancel') }}
          </Button>
          <Button @click="handleConfirmationProceed" :disabled="isStartingMigration">
            <Icon
              v-if="isStartingMigration"
              icon="lucide:loader-2"
              class="w-4 h-4 mr-2 animate-spin"
            />
            {{ t('migration.confirmation.proceed') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import {
  MigrationProgressDialog,
  MigrationErrorDialog,
  MigrationTroubleshootingGuide
} from './index'
import MigrationBlockingOverlay from './MigrationBlockingOverlay.vue'
import { useMigrationState } from '@/composables/useMigrationState'

export interface LegacyDatabaseInfo {
  type: 'sqlite' | 'duckdb'
  path: string
  version: number
  size: number
  recordCount: number
}

interface Emits {
  (e: 'migration-started'): void
  (e: 'migration-completed'): void
  (e: 'migration-cancelled'): void
  (e: 'migration-error', error: string): void
}

const emit = defineEmits<Emits>()
const { t } = useI18n()

// Migration state management
const { migrationState } = useMigrationState()

// Dialog states
const showConfirmationDialog = ref(false)
const showProgressDialog = ref(false)
const showErrorDialog = ref(false)
const showTroubleshootingDialog = ref(false)

// Migration state
const isStartingMigration = ref(false)
const canCancelMigration = ref(true)
const legacyDatabases = ref<LegacyDatabaseInfo[]>([])
const estimatedDuration = ref<number>()

// Event listeners
let migrationDetectedListener: ((event: any, data: any) => void) | null = null
let migrationStartedListener: ((event: any) => void) | null = null
let migrationCompleteListener: ((event: any) => void) | null = null
let migrationCancelledListener: ((event: any) => void) | null = null
let migrationErrorListener: ((event: any, error: string) => void) | null = null

onMounted(() => {
  // Set up IPC listeners
  migrationDetectedListener = (_event: any, data: any) => {
    legacyDatabases.value = data.databases
    estimatedDuration.value = data.estimatedDuration
    showConfirmationDialog.value = true
  }

  migrationStartedListener = (_event: any) => {
    showConfirmationDialog.value = false
    showProgressDialog.value = true
    canCancelMigration.value = true
    emit('migration-started')
  }

  migrationCompleteListener = (_event: any) => {
    showProgressDialog.value = false
    emit('migration-completed')
  }

  migrationCancelledListener = (_event: any) => {
    showProgressDialog.value = false
    canCancelMigration.value = true
    emit('migration-cancelled')
  }

  migrationErrorListener = (_event: any, error: string) => {
    showProgressDialog.value = false
    showErrorDialog.value = true
    emit('migration-error', error)
  }

  // Register IPC listeners
  window.electron?.ipcRenderer?.on('migration:detected', migrationDetectedListener)
  window.electron?.ipcRenderer?.on('migration:started', migrationStartedListener)
  window.electron?.ipcRenderer?.on('migration:complete', migrationCompleteListener)
  window.electron?.ipcRenderer?.on('migration:cancelled', migrationCancelledListener)
  window.electron?.ipcRenderer?.on('migration:error', migrationErrorListener)

  // Check for legacy databases on mount
  checkForLegacyDatabases()
})

onUnmounted(() => {
  // Clean up IPC listeners
  if (migrationDetectedListener) {
    window.electron?.ipcRenderer?.removeListener('migration:detected', migrationDetectedListener)
  }
  if (migrationStartedListener) {
    window.electron?.ipcRenderer?.removeListener('migration:started', migrationStartedListener)
  }
  if (migrationCompleteListener) {
    window.electron?.ipcRenderer?.removeListener('migration:complete', migrationCompleteListener)
  }
  if (migrationCancelledListener) {
    window.electron?.ipcRenderer?.removeListener('migration:cancelled', migrationCancelledListener)
  }
  if (migrationErrorListener) {
    window.electron?.ipcRenderer?.removeListener('migration:error', migrationErrorListener)
  }
})

// Check for legacy databases
const checkForLegacyDatabases = async () => {
  try {
    await window.electron?.ipcRenderer?.invoke('migration:check-legacy-databases')
  } catch (error) {
    console.error('Failed to check for legacy databases:', error)
  }
}

// Handle confirmation dialog proceed
const handleConfirmationProceed = async () => {
  if (isStartingMigration.value) return

  isStartingMigration.value = true

  try {
    // Start migration process
    await window.electron?.ipcRenderer?.invoke('migration:start')
  } catch (error) {
    console.error('Failed to start migration:', error)
    isStartingMigration.value = false
  }
}

// Handle confirmation dialog cancel
const handleConfirmationCancel = () => {
  showConfirmationDialog.value = false
}

// Handle migration cancel
const handleMigrationCancel = () => {
  canCancelMigration.value = false
}

// Handle migration retry
const handleMigrationRetry = () => {
  showErrorDialog.value = false
  showProgressDialog.value = true
}

// Handle migration rollback
const handleMigrationRollback = () => {
  showErrorDialog.value = false
  // Rollback will be handled by the main process
}

// Handle get help
const handleGetHelp = () => {
  // This will be handled by the error dialog component
}

// Handle show troubleshooting
const handleShowTroubleshooting = () => {
  showTroubleshootingDialog.value = true
}

// Format file size
const formatSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`
}

// Format time in minutes and seconds
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

// Expose methods for external use
defineExpose({
  checkForLegacyDatabases,
  showConfirmationDialog: () => {
    showConfirmationDialog.value = true
  }
})
</script>
