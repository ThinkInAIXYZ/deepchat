<template>
  <AlertDialog :open="snapshot.promptOpen" @update:open="handleOpenChange">
    <AlertDialogContent class="w-[calc(100vw-2rem)] max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{
            snapshot.risk === 'busy'
              ? t('settings.leaveGuard.busyTitle')
              : t('settings.leaveGuard.dirtyTitle')
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            snapshot.risk === 'busy'
              ? t('settings.leaveGuard.busyDescription')
              : t('settings.leaveGuard.dirtyDescription')
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="settingsLeaveGuard.stay()">
          {{ t('settings.leaveGuard.stay') }}
        </AlertDialogCancel>
        <AlertDialogAction
          v-if="snapshot.risk === 'dirty'"
          variant="destructive"
          @click="settingsLeaveGuard.discardAndLeave()"
        >
          {{ t('settings.leaveGuard.discard') }}
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
import { onBeforeUnmount, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const { t } = useI18n()
const snapshot = shallowRef(settingsLeaveGuard.getSnapshot())
const stop = settingsLeaveGuard.subscribe((next) => {
  snapshot.value = next
})

const handleOpenChange = (open: boolean) => {
  if (!open) settingsLeaveGuard.stay()
}

onBeforeUnmount(stop)
</script>
