<template>
  <div class="p-6 space-y-4">
    <h2 class="text-2xl font-bold">Migration System Demo</h2>

    <div class="space-y-2">
      <p class="text-muted-foreground">
        This demo shows how the migration system components work together.
      </p>

      <div class="flex space-x-2">
        <Button @click="showConfirmation"> Show Migration Confirmation </Button>

        <Button @click="showProgress"> Show Migration Progress </Button>

        <Button @click="showError"> Show Migration Error </Button>

        <Button @click="showTroubleshooting"> Show Troubleshooting Guide </Button>
      </div>
    </div>

    <!-- Migration Manager handles all dialogs -->
    <MigrationManager
      @migration-started="onMigrationStarted"
      @migration-completed="onMigrationCompleted"
      @migration-cancelled="onMigrationCancelled"
      @migration-error="onMigrationError"
    />

    <!-- Individual components for testing -->
    <MigrationProgressDialog
      v-model:open="demoProgressDialog"
      :can-cancel="true"
      @cancel="onProgressCancel"
    />

    <MigrationErrorDialog
      v-model:open="demoErrorDialog"
      @retry="onErrorRetry"
      @rollback="onErrorRollback"
      @get-help="onGetHelp"
      @show-troubleshooting="onShowTroubleshooting"
    />

    <MigrationTroubleshootingGuide v-model:open="demoTroubleshootingDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import {
  MigrationManager,
  MigrationProgressDialog,
  MigrationErrorDialog,
  MigrationTroubleshootingGuide,
  type MigrationErrorData
} from './index'

// Demo dialog states
const demoProgressDialog = ref(false)
const demoErrorDialog = ref(false)
const demoTroubleshootingDialog = ref(false)

// Demo functions
const showConfirmation = () => {
  // Simulate legacy database detection by directly calling the event handler
  // In real implementation, this would come from the main process
  const mockData = {
    databases: [
      {
        type: 'sqlite' as const,
        path: '/path/to/conversations.db',
        version: 1,
        size: 1024 * 1024 * 50, // 50MB
        recordCount: 1500
      },
      {
        type: 'duckdb' as const,
        path: '/path/to/knowledge.db',
        version: 1,
        size: 1024 * 1024 * 200, // 200MB
        recordCount: 5000
      }
    ],
    estimatedDuration: 300000 // 5 minutes
  }

  // Simulate the event by directly triggering the handler
  // This is for demo purposes only
  console.log('Demo: Simulating migration:detected event', mockData)
}

const showProgress = () => {
  demoProgressDialog.value = true

  // Simulate progress updates
  let progress = 0
  const interval = setInterval(() => {
    progress += 10

    const mockProgressData = {
      phase: progress < 50 ? 'conversations' : 'vectors',
      currentOperation:
        progress < 50 ? 'Migrating conversations...' : 'Migrating vector embeddings...',
      progress,
      recordsProcessed: Math.floor((progress / 100) * 6500),
      totalRecords: 6500,
      estimatedTimeRemaining: ((100 - progress) / 100) * 300000,
      warnings: progress > 30 ? ['Some old data format detected'] : [],
      steps: [
        { id: '1', description: 'Backup creation', status: 'completed' as const },
        {
          id: '2',
          description: 'Schema migration',
          status: progress > 20 ? ('completed' as const) : ('in-progress' as const)
        },
        {
          id: '3',
          description: 'Data migration',
          status: progress > 60 ? ('in-progress' as const) : ('pending' as const)
        },
        {
          id: '4',
          description: 'Validation',
          status: progress > 90 ? ('in-progress' as const) : ('pending' as const)
        }
      ]
    }

    // For demo purposes, log the progress data
    console.log('Demo: Simulating migration:progress event', mockProgressData)

    if (progress >= 100) {
      clearInterval(interval)
      setTimeout(() => {
        console.log('Demo: Simulating migration:complete event')
      }, 1000)
    }
  }, 1000)
}

const showError = () => {
  demoErrorDialog.value = true

  // Simulate error
  const errorData: MigrationErrorData = {
    type: 'insufficient_disk_space',
    summary: 'Not enough disk space to complete migration',
    details: 'The migration requires 500MB of free space, but only 200MB is available.',
    technicalDetails:
      'Error: ENOSPC: no space left on device, write\n  at WriteStream.write (/path/to/file)',
    recoverable: true,
    canRetry: true,
    canRollback: true,
    requiredSpace: 500 * 1024 * 1024,
    availableSpace: 200 * 1024 * 1024,
    recoveryOptions: [
      'Free up disk space by deleting temporary files',
      'Move large files to external storage',
      'Use disk cleanup tools'
    ]
  }

  // For demo purposes, log the error data
  console.log('Demo: Simulating migration:error event', errorData)
}

const showTroubleshooting = () => {
  demoTroubleshootingDialog.value = true
}

// Event handlers
const onMigrationStarted = () => {
  console.log('Migration started')
}

const onMigrationCompleted = () => {
  console.log('Migration completed')
}

const onMigrationCancelled = () => {
  console.log('Migration cancelled')
}

const onMigrationError = (error: string) => {
  console.log('Migration error:', error)
}

const onProgressCancel = () => {
  console.log('Progress cancelled')
  demoProgressDialog.value = false
}

const onErrorRetry = () => {
  console.log('Error retry')
  demoErrorDialog.value = false
}

const onErrorRollback = () => {
  console.log('Error rollback')
  demoErrorDialog.value = false
}

const onGetHelp = () => {
  console.log('Get help')
}

const onShowTroubleshooting = () => {
  console.log('Show troubleshooting')
  demoTroubleshootingDialog.value = true
}
</script>
