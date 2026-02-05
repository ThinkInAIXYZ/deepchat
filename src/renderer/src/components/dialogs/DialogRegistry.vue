<template>
  <UpdateDialog />
  <MessageDialog />
  <TraceDialog
    :message-id="traceDialog.messageId"
    :agent-id="traceDialog.agentId"
    @close="traceDialog.close"
  />
</template>

<script setup lang="ts">
import UpdateDialog from '@/components/ui/UpdateDialog.vue'
import MessageDialog from '@/components/ui/MessageDialog.vue'
import TraceDialog from '@/components/trace/TraceDialog.vue'
import { useTraceDialogStore } from '@/stores/traceDialog'

const traceDialog = useTraceDialogStore()
</script>
