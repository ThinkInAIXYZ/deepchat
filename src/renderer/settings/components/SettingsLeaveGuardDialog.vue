<template>
  <AlertDialog :open="snapshot.promptOpen">
    <AlertDialogContent
      class="w-[calc(100vw-2rem)] max-w-md"
      @escape-key-down="settingsLeaveGuard.cancelLeave()"
      @pointer-down-outside="settingsLeaveGuard.cancelLeave()"
    >
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
        <DcButton
          data-testid="settings-leave-guard-cancel"
          type="button"
          variant="outline"
          class="mt-2 sm:mt-0"
          @click="settingsLeaveGuard.cancelLeave()"
        >
          {{ t('settings.leaveGuard.stay') }}
        </DcButton>
        <DcButton
          v-if="snapshot.risk === 'dirty'"
          data-testid="settings-leave-guard-discard"
          type="button"
          variant="destructive"
          @click="settingsLeaveGuard.discardAndLeave()"
        >
          {{ t('settings.leaveGuard.discard') }}
        </DcButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { DcButton } from '@dc-ui/components/button'
import { onBeforeUnmount, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const { t } = useI18n()
const snapshot = shallowRef(settingsLeaveGuard.getSnapshot())
const stop = settingsLeaveGuard.subscribe((next) => {
  snapshot.value = next
})

onBeforeUnmount(stop)
</script>
