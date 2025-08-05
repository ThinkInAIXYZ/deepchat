<template>
  <AlertDialog :open="showDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          <div class="flex items-center space-x-2">
            <template v-if="dialogRequest?.icon">
              <Icon v-bind="getIconProps(dialogRequest?.icon)" class="h-6 w-6" />
            </template>
            <span>{{ dialogRequest?.i18n ? t(dialogRequest?.title) : dialogRequest?.title }}</span>
          </div>
        </AlertDialogTitle>
        <AlertDialogDescription v-if="dialogRequest?.description">
          <div class="space-y-2">
            {{ dialogRequest.i18n ? t(dialogRequest.description) : dialogRequest.description }}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <template v-for="(button) in dialogRequest?.buttons" :key="button.key">
          <AlertDialogAction v-if="button.default" @click="handleClick(button.key)">
            {{ dialogRequest?.i18n ? t(button.label) : button.label }}
            <span
              v-if="timeoutSeconds && button.default"
              class="inline-block min-w-8 text-right"
            >
              [{{ timeoutSeconds }}]
            </span>
          </AlertDialogAction>
          <AlertDialogCancel v-else @click="handleClick(button.key)">
            {{ dialogRequest?.i18n ? t(button.label) : button.label }}
          </AlertDialogCancel>
        </template>
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
} from '@/components/ui/alert-dialog'
import { useDialogStore } from '@/stores/dialog'
import { Icon } from '@iconify/vue'
import { DialogIcon } from '@shared/presenter'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const dialog = useDialogStore()
const dialogRequest = computed(() => dialog.dialogRequest)
const showDialog = computed(() => dialog.showDialog)
const timeoutSeconds = computed(() => {
  if (dialog.timeoutMilliseconds > 0) {
    return perfectTime(dialog.timeoutMilliseconds)
  }
  return null
})

const handleClick = (button: string) => {
  if (!dialogRequest.value) return
  dialog.handleResponse({
    id: dialogRequest.value.id,
    button: button
  })
}

/**
 * convert milliseconds to human-readable format
 * @param ms milliseconds
 * @return string in the format of "1 s", "2 m", "3 h", etc. max is weeks
 */
const perfectTime = (ms: number) => {
  if (ms < 0 || !Number.isFinite(ms)) return '0 s'
  if (ms < 1000) return '1 s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d`
  const weeks = Math.floor(days / 7)
  return `${weeks} w`
}

const getIconProps = (icon: DialogIcon) => {
  return { ...icon }
}

</script>
