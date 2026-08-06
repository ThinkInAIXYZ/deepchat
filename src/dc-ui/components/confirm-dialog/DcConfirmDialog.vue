<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  AlertDialog,
  AlertDialogAsyncAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { Spinner } from '@shadcn/components/ui/spinner'

interface Props {
  open: boolean
  title: string
  description?: string
  icon?: string
  danger?: boolean
  confirmLabel?: string
  cancelLabel?: string
  confirmIcon?: string
  busy?: boolean
  disabledConfirm?: boolean
  confirmAttrs?: Record<string, unknown>
  cancelAttrs?: Record<string, unknown>
  busyDataTestid?: string
}

const props = withDefaults(defineProps<Props>(), {
  danger: true
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()

const resolvedConfirmLabel = computed(() => props.confirmLabel ?? t('common.confirm'))
const resolvedCancelLabel = computed(() => props.cancelLabel ?? t('common.cancel'))

const handleOpenChange = (value: boolean) => {
  emit('update:open', value)
  if (!value) emit('cancel')
}
</script>

<template>
  <AlertDialog :open="open" @update:open="handleOpenChange">
    <AlertDialogContent class="w-[calc(100vw-2rem)] max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle class="flex items-center gap-2">
          <Icon v-if="icon" :icon="icon" class="size-4 text-muted-foreground" />
          <span>{{ title }}</span>
        </AlertDialogTitle>
        <AlertDialogDescription v-if="description">{{ description }}</AlertDialogDescription>
      </AlertDialogHeader>

      <slot />

      <AlertDialogFooter>
        <slot name="actions">
          <AlertDialogCancel v-bind="cancelAttrs" :disabled="busy" @click="emit('cancel')">
            {{ resolvedCancelLabel }}
          </AlertDialogCancel>
          <AlertDialogAsyncAction
            v-bind="confirmAttrs"
            :variant="danger ? 'destructive' : 'default'"
            :disabled="busy || disabledConfirm"
            @click="emit('confirm')"
          >
            <Spinner
              v-if="busy"
              data-icon="inline-start"
              class="size-4"
              :data-testid="busyDataTestid"
            />
            <Icon v-else-if="confirmIcon" :icon="confirmIcon" class="size-4" />
            {{ resolvedConfirmLabel }}
          </AlertDialogAsyncAction>
        </slot>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
