import { defineStore } from 'pinia'
import { ref } from 'vue'

export const createTraceDialogStore = () => {
  const messageId = ref<string | null>(null)
  const agentId = ref<string | null>(null)

  const open = (nextMessageId: string, nextAgentId?: string | null) => {
    messageId.value = nextMessageId
    agentId.value = nextAgentId ?? null
  }

  const close = () => {
    messageId.value = null
    agentId.value = null
  }

  return {
    messageId,
    agentId,
    open,
    close
  }
}

export const useTraceDialogStore = defineStore('traceDialog', createTraceDialogStore)
