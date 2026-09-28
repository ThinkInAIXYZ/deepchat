<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { useAcpExtensionsStore } from '@/stores/acpExtensions'
import AcpElicitationForm from './AcpElicitationForm.vue'

const store = useAcpExtensionsStore()
const { t } = useI18n()
const request = computed(() =>
  store.requests.find(
    (entry) => !entry.conversationId || entry.conversationId !== store.dockedConversationId
  )
)
</script>

<template>
  <Dialog
    :open="Boolean(request)"
    @update:open="
      (open) => {
        if (!open && request) store.respond(request.requestId, 'cancel')
      }
    "
  >
    <DialogContent v-if="request" class="max-w-xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{
          t('chat.acpExtensions.inputTitle', { agent: request.agentName })
        }}</DialogTitle>
        <DialogDescription>{{ request.message }}</DialogDescription>
      </DialogHeader>
      <AcpElicitationForm :key="request.requestId" :request="request" />
    </DialogContent>
  </Dialog>
</template>
