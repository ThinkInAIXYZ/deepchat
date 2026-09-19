<template>
  <AlertDialog :open="open" @update:open="handleOpenChange">
    <AlertDialogContent class="w-[calc(100vw-2rem)] max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle>
          <div class="flex items-center space-x-2">
            <Icon icon="lucide:alert-triangle" class="h-5 w-5 text-amber-500" />
            <span class="text-base font-semibold">{{ t('update.taskRunningTitle') }}</span>
          </div>
        </AlertDialogTitle>
        <AlertDialogDescription class="text-sm text-muted-foreground">
          {{ t('update.taskRunningDescription') }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <AlertDialogCancel class="flex-1 sm:flex-none" @click="handleCancel">
          {{ t('common.cancel') }}
        </AlertDialogCancel>
        <AlertDialogAction class="flex-1 sm:flex-none" @click="handleUpdateNow">
          {{ t('update.updateNow') }}
        </AlertDialogAction>
        <AlertDialogAction class="flex-1 sm:flex-none" @click="handleUpdateAfterTasks">
          {{ t('update.updateAfterTasksComplete') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  cancel: []
  'update-now': []
  'update-after-tasks': []
}>()

const handleOpenChange = (value: boolean) => {
  emit('update:open', value)
}

const handleCancel = () => {
  emit('cancel')
}

const handleUpdateNow = () => {
  emit('update-now')
}

const handleUpdateAfterTasks = () => {
  emit('update-after-tasks')
}
</script>
