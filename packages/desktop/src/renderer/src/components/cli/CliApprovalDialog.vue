<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { useCliApprovalStore } from '@/stores/cliApproval'

const store = useCliApprovalStore()
const { t } = useI18n()

const displayData = computed(() => {
  if (store.request?.displayData === undefined) return ''
  return JSON.stringify(store.request.displayData, null, 2)
})

const description = computed(() =>
  t('components.messageBlockPermissionRequest.description.write', {
    toolName: store.request?.operation ?? '',
    serverName: 'DeepChat CLI'
  })
)

const onDialogToggle = (open: boolean) => {
  if (!open) void store.deny()
}
</script>

<template>
  <Dialog :open="store.isOpen" @update:open="onDialogToggle">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {{ t('components.messageBlockPermissionRequest.title') }}
        </DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <div v-if="store.request" class="space-y-3">
        <div class="rounded-md border bg-muted/40 p-3 text-sm">
          <div class="font-mono font-medium break-all">{{ store.request.operation }}</div>
          <div class="mt-1 text-xs text-muted-foreground">
            {{ store.request.principal }} · {{ store.request.effect }}
          </div>
        </div>
        <pre
          v-if="displayData"
          class="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border p-3 text-xs"
          >{{ displayData }}</pre
        >
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="store.isSubmitting" @click="store.deny">
          {{ t('components.messageBlockPermissionRequest.deny') }}
        </Button>
        <Button :disabled="store.isSubmitting" @click="store.approve">
          <Spinner v-if="store.isSubmitting" data-icon="inline-start" />
          {{ t('components.messageBlockPermissionRequest.allowOnce') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
