<template>
  <Dialog v-model:open="isOpen" :modal="true">
    <DialogContent class="sm:max-w-md" :can-close="canCancel">
      <DialogHeader>
        <DialogTitle>{{ t('migration.progress.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('migration.progress.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <!-- Current Operation -->
        <div class="space-y-2">
          <div class="flex items-center justify-between text-sm">
            <span class="font-medium">{{ currentOperation }}</span>
            <span class="text-muted-foreground">{{ Math.round(progress) }}%</span>
          </div>
          <Progress :model-value="progress" class="h-2" />
        </div>

        <!-- Phase Information -->
        <div class="text-sm text-muted-foreground">
          <div class="flex items-center justify-between">
            <span>{{ t('migration.progress.phase') }}: {{ currentPhase }}</span>
            <span v-if="estimatedTimeRemaining">
              {{ t('migration.progress.timeRemaining') }}: {{ formatTime(estimatedTimeRemaining) }}
            </span>
          </div>
          <div class="mt-1">
            {{ t('migration.progress.records') }}: {{ recordsProcessed.toLocaleString() }} /
            {{ totalRecords.toLocaleString() }}
          </div>
        </div>

        <!-- Detailed Progress -->
        <div class="space-y-2">
          <div class="text-xs text-muted-foreground">{{ t('migration.progress.details') }}:</div>
          <div class="max-h-32 overflow-y-auto space-y-1 text-xs">
            <div
              v-for="(step, index) in progressSteps"
              :key="index"
              class="flex items-center space-x-2"
              :class="{
                'text-green-600': step.status === 'completed',
                'text-blue-600': step.status === 'in-progress',
                'text-muted-foreground': step.status === 'pending'
              }"
            >
              <Icon :icon="getStepIcon(step.status)" class="w-3 h-3 flex-shrink-0" />
              <span>{{ step.description }}</span>
            </div>
          </div>
        </div>

        <!-- Warnings (if any) -->
        <div v-if="warnings.length > 0" class="space-y-2">
          <div class="text-xs font-medium text-yellow-600">
            {{ t('migration.progress.warnings') }}:
          </div>
          <div class="max-h-20 overflow-y-auto space-y-1 text-xs text-yellow-600">
            <div v-for="(warning, index) in warnings" :key="index">• {{ warning }}</div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button
          v-if="canCancel && !isCancelling"
          variant="outline"
          @click="handleCancel"
          :disabled="isCancelling"
        >
          {{ t('migration.progress.cancel') }}
        </Button>
        <Button v-if="isCancelling" variant="outline" disabled>
          <Icon icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
          {{ t('migration.progress.cancelling') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
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
import { Progress } from '@/components/ui/progress'
import { Icon } from '@iconify/vue'

export interface MigrationProgressStep {
  id: string
  description: string
  status: 'pending' | 'in-progress' | 'completed' | 'error'
}

export interface MigrationProgressData {
  phase: string
  currentOperation: string
  progress: number
  recordsProcessed: number
  totalRecords: number
  estimatedTimeRemaining?: number
  warnings?: string[]
  steps?: MigrationProgressStep[]
}

interface Props {
  open: boolean
  canCancel?: boolean
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'cancel'): void
}

const props = withDefaults(defineProps<Props>(), {
  canCancel: true
})

const emit = defineEmits<Emits>()
const { t } = useI18n()

// Reactive state
const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const currentPhase = ref('')
const currentOperation = ref('')
const progress = ref(0)
const recordsProcessed = ref(0)
const totalRecords = ref(0)
const estimatedTimeRemaining = ref<number | undefined>()
const warnings = ref<string[]>([])
const progressSteps = ref<MigrationProgressStep[]>([])
const isCancelling = ref(false)

// Event listeners
let migrationProgressListener: ((event: any, data: MigrationProgressData) => void) | null = null
let migrationCompleteListener: ((event: any) => void) | null = null
let migrationErrorListener: ((event: any, error: string) => void) | null = null

onMounted(() => {
  // Set up IPC listeners for migration progress
  migrationProgressListener = (_event: any, data: MigrationProgressData) => {
    updateProgress(data)
  }

  migrationCompleteListener = (_event: any) => {
    // Migration completed successfully
    progress.value = 100
    currentOperation.value = t('migration.progress.completed')
    // Keep dialog open briefly to show completion, then close
    setTimeout(() => {
      isOpen.value = false
    }, 2000)
  }

  migrationErrorListener = (_event: any, error: string) => {
    // Migration failed - this will be handled by the error dialog
    console.error('Migration failed:', error)
    isOpen.value = false
  }

  // Register IPC listeners
  window.electron?.ipcRenderer?.on('migration:progress', migrationProgressListener)
  window.electron?.ipcRenderer?.on('migration:complete', migrationCompleteListener)
  window.electron?.ipcRenderer?.on('migration:error', migrationErrorListener)
})

onUnmounted(() => {
  // Clean up IPC listeners
  if (migrationProgressListener) {
    window.electron?.ipcRenderer?.removeListener('migration:progress', migrationProgressListener)
  }
  if (migrationCompleteListener) {
    window.electron?.ipcRenderer?.removeListener('migration:complete', migrationCompleteListener)
  }
  if (migrationErrorListener) {
    window.electron?.ipcRenderer?.removeListener('migration:error', migrationErrorListener)
  }
})

// Update progress data
const updateProgress = (data: MigrationProgressData) => {
  currentPhase.value = data.phase
  currentOperation.value = data.currentOperation
  progress.value = data.progress
  recordsProcessed.value = data.recordsProcessed
  totalRecords.value = data.totalRecords
  estimatedTimeRemaining.value = data.estimatedTimeRemaining

  if (data.warnings) {
    warnings.value = data.warnings
  }

  if (data.steps) {
    progressSteps.value = data.steps
  }
}

// Handle cancel button click
const handleCancel = async () => {
  if (isCancelling.value) return

  isCancelling.value = true

  try {
    // Send cancel request to main process
    await window.electron?.ipcRenderer?.invoke('migration:cancel')
    emit('cancel')
  } catch (error) {
    console.error('Failed to cancel migration:', error)
  } finally {
    isCancelling.value = false
  }
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

// Get icon for step status
const getStepIcon = (status: string): string => {
  switch (status) {
    case 'completed':
      return 'lucide:check'
    case 'in-progress':
      return 'lucide:loader-2'
    case 'error':
      return 'lucide:x'
    default:
      return 'lucide:circle'
  }
}

// Watch for dialog close to reset cancelling state
watch(isOpen, (newValue) => {
  if (!newValue) {
    isCancelling.value = false
  }
})
</script>
