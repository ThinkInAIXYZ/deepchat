<template>
  <Dialog v-model:open="isOpen" :modal="true">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center space-x-2">
          <Icon icon="lucide:alert-triangle" class="w-5 h-5 text-red-500" />
          <span>{{ t('migration.error.title') }}</span>
        </DialogTitle>
        <DialogDescription>
          {{ t('migration.error.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <!-- Error Summary -->
        <div class="p-3 bg-red-50 border border-red-200 rounded-md">
          <div class="flex items-start space-x-2">
            <Icon icon="lucide:x-circle" class="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div class="flex-1">
              <div class="font-medium text-red-800">{{ errorSummary }}</div>
              <div v-if="errorDetails" class="text-sm text-red-700 mt-1">
                {{ errorDetails }}
              </div>
            </div>
          </div>
        </div>

        <!-- Error Type Specific Information -->
        <div v-if="errorType" class="space-y-3">
          <div class="text-sm font-medium">{{ t('migration.error.troubleshooting') }}:</div>

          <!-- Disk Space Error -->
          <div v-if="errorType === 'insufficient_disk_space'" class="space-y-2">
            <div class="text-sm text-muted-foreground">
              {{ t('migration.error.diskSpace.description') }}
            </div>
            <div class="text-sm">
              <div class="font-medium">{{ t('migration.error.diskSpace.required') }}:</div>
              <div class="ml-4">{{ formatSize(requiredSpace || 0) }}</div>
            </div>
            <div class="text-sm">
              <div class="font-medium">{{ t('migration.error.diskSpace.available') }}:</div>
              <div class="ml-4">{{ formatSize(availableSpace || 0) }}</div>
            </div>
            <div class="text-sm text-blue-600">
              {{ t('migration.error.diskSpace.suggestion') }}
            </div>
          </div>

          <!-- Permission Error -->
          <div v-else-if="errorType === 'permission_denied'" class="space-y-2">
            <div class="text-sm text-muted-foreground">
              {{ t('migration.error.permission.description') }}
            </div>
            <div class="text-sm text-blue-600">
              {{ t('migration.error.permission.suggestion') }}
            </div>
          </div>

          <!-- Corrupted Data Error -->
          <div v-else-if="errorType === 'corrupted_source_data'" class="space-y-2">
            <div class="text-sm text-muted-foreground">
              {{ t('migration.error.corruption.description') }}
            </div>
            <div class="text-sm text-blue-600">
              {{ t('migration.error.corruption.suggestion') }}
            </div>
          </div>

          <!-- Schema Mismatch Error -->
          <div v-else-if="errorType === 'schema_mismatch'" class="space-y-2">
            <div class="text-sm text-muted-foreground">
              {{ t('migration.error.schema.description') }}
            </div>
            <div class="text-sm text-blue-600">
              {{ t('migration.error.schema.suggestion') }}
            </div>
          </div>

          <!-- Generic Error -->
          <div v-else class="space-y-2">
            <div class="text-sm text-muted-foreground">
              {{ t('migration.error.generic.description') }}
            </div>
            <div class="text-sm text-blue-600">
              {{ t('migration.error.generic.suggestion') }}
            </div>
          </div>
        </div>

        <!-- Technical Details (Collapsible) -->
        <div v-if="technicalDetails" class="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            @click="showTechnicalDetails = !showTechnicalDetails"
            class="p-0 h-auto text-sm text-muted-foreground hover:text-foreground"
          >
            <Icon
              :icon="showTechnicalDetails ? 'lucide:chevron-down' : 'lucide:chevron-right'"
              class="w-4 h-4 mr-1"
            />
            {{ t('migration.error.technicalDetails') }}
          </Button>

          <div v-if="showTechnicalDetails" class="p-3 bg-gray-50 border rounded-md">
            <pre class="text-xs text-gray-700 whitespace-pre-wrap">{{ technicalDetails }}</pre>
          </div>
        </div>

        <!-- Recovery Options -->
        <div v-if="recoveryOptions.length > 0" class="space-y-3">
          <div class="text-sm font-medium">{{ t('migration.error.recoveryOptions') }}:</div>
          <div class="space-y-2">
            <div
              v-for="(option, index) in recoveryOptions"
              :key="index"
              class="flex items-start space-x-2 text-sm"
            >
              <Icon icon="lucide:arrow-right" class="w-3 h-3 mt-1 text-blue-500 flex-shrink-0" />
              <span>{{ option }}</span>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="flex-col sm:flex-row gap-2">
        <!-- Action Buttons -->
        <div class="flex space-x-2">
          <Button v-if="canRetry" @click="handleRetry" :disabled="isRetrying">
            <Icon v-if="isRetrying" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ t('migration.error.retry') }}
          </Button>

          <Button
            v-if="canRollback"
            variant="outline"
            @click="handleRollback"
            :disabled="isRollingBack"
          >
            <Icon v-if="isRollingBack" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ t('migration.error.rollback') }}
          </Button>

          <Button variant="outline" @click="handleGetHelp">
            <Icon icon="lucide:help-circle" class="w-4 h-4 mr-2" />
            {{ t('migration.error.getHelp') }}
          </Button>

          <Button variant="outline" @click="handleShowTroubleshooting">
            <Icon icon="lucide:book-open" class="w-4 h-4 mr-2" />
            {{ t('migration.error.troubleshooting') }}
          </Button>
        </div>

        <!-- Close Button -->
        <Button variant="ghost" @click="handleClose">
          {{ t('migration.error.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
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

export interface MigrationErrorData {
  type:
    | 'insufficient_disk_space'
    | 'permission_denied'
    | 'corrupted_source_data'
    | 'schema_mismatch'
    | 'network_timeout'
    | 'unknown_error'
  summary: string
  details?: string
  technicalDetails?: string
  recoverable: boolean
  canRetry: boolean
  canRollback: boolean
  requiredSpace?: number
  availableSpace?: number
  recoveryOptions?: string[]
}

interface Props {
  open: boolean
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'retry'): void
  (e: 'rollback'): void
  (e: 'get-help'): void
  (e: 'show-troubleshooting'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const { t } = useI18n()

// Reactive state
const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const errorType = ref<string>('')
const errorSummary = ref('')
const errorDetails = ref('')
const technicalDetails = ref('')
const canRetry = ref(false)
const canRollback = ref(false)
const requiredSpace = ref<number>()
const availableSpace = ref<number>()
const recoveryOptions = ref<string[]>([])
const showTechnicalDetails = ref(false)
const isRetrying = ref(false)
const isRollingBack = ref(false)

// Event listeners
let migrationErrorListener: ((event: any, data: MigrationErrorData) => void) | null = null

onMounted(() => {
  // Set up IPC listener for migration errors
  migrationErrorListener = (_event: any, data: MigrationErrorData) => {
    updateErrorData(data)
    isOpen.value = true
  }

  // Register IPC listener
  window.electron?.ipcRenderer?.on('migration:error', migrationErrorListener)
})

onUnmounted(() => {
  // Clean up IPC listener
  if (migrationErrorListener) {
    window.electron?.ipcRenderer?.removeListener('migration:error', migrationErrorListener)
  }
})

// Update error data
const updateErrorData = (data: MigrationErrorData) => {
  errorType.value = data.type
  errorSummary.value = data.summary
  errorDetails.value = data.details || ''
  technicalDetails.value = data.technicalDetails || ''
  canRetry.value = data.canRetry
  canRollback.value = data.canRollback
  requiredSpace.value = data.requiredSpace
  availableSpace.value = data.availableSpace
  recoveryOptions.value = data.recoveryOptions || []
}

// Handle retry button click
const handleRetry = async () => {
  if (isRetrying.value) return

  isRetrying.value = true

  try {
    // Send retry request to main process
    await window.electron?.ipcRenderer?.invoke('migration:retry')
    emit('retry')
    isOpen.value = false
  } catch (error) {
    console.error('Failed to retry migration:', error)
  } finally {
    isRetrying.value = false
  }
}

// Handle rollback button click
const handleRollback = async () => {
  if (isRollingBack.value) return

  isRollingBack.value = true

  try {
    // Send rollback request to main process
    await window.electron?.ipcRenderer?.invoke('migration:rollback')
    emit('rollback')
    isOpen.value = false
  } catch (error) {
    console.error('Failed to rollback migration:', error)
  } finally {
    isRollingBack.value = false
  }
}

// Handle get help button click
const handleGetHelp = () => {
  emit('get-help')
  // Open help documentation or support page
  window.electron?.ipcRenderer?.invoke(
    'open-external-url',
    'https://docs.deepchat.com/migration-troubleshooting'
  )
}

// Handle show troubleshooting guide
const handleShowTroubleshooting = () => {
  emit('show-troubleshooting')
}

// Handle close button click
const handleClose = () => {
  isOpen.value = false
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
</script>
