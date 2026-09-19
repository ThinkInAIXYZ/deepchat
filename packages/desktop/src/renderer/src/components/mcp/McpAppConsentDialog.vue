<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { DcButton } from '@dc-ui/components/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { useMcpAppConsentStore } from '@/stores/mcpAppConsent'

const store = useMcpAppConsentStore()
const { t } = useI18n()

const onDialogToggle = (open: boolean) => {
  if (!open) {
    void store.deny()
  }
}
</script>

<template>
  <Dialog :open="store.isOpen" @update:open="onDialogToggle">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t('mcp.apps.consent.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('mcp.apps.consent.description') }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="store.request" class="space-y-3">
        <div class="rounded-md border bg-muted/40 p-3 text-sm">
          <div class="font-medium">{{ store.request.title }}</div>
          <div class="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs">
            {{ store.request.detail }}
          </div>
        </div>
        <div
          v-if="store.request.argumentsPreview"
          class="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-md border p-3 font-mono text-xs"
        >
          {{ store.request.argumentsPreview }}
        </div>
      </div>

      <DialogFooter>
        <DcButton variant="outline" :disabled="store.isSubmitting" @click="store.deny">
          {{ t('mcp.apps.consent.deny') }}
        </DcButton>
        <DcButton :disabled="store.isSubmitting" @click="store.approve">
          <Spinner v-if="store.isSubmitting" data-icon="inline-start" />
          {{ t('mcp.apps.consent.allowOnce') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
