import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'

export const useStreamStateStore = defineStore('streamState', () => {
  const isStreaming = ref(false)
  const streamingBlocks = ref<AssistantMessageBlock[]>([])
  const currentStreamSessionId = ref<string | null>(null)
  const currentStreamMessageId = ref<string | null>(null)
  const streamRevision = ref(0)

  function setStream(sessionId: string, blocks: AssistantMessageBlock[], messageId?: string): void {
    isStreaming.value = true
    currentStreamSessionId.value = sessionId
    currentStreamMessageId.value = messageId ?? null
    streamingBlocks.value = blocks
    streamRevision.value += 1
  }

  function clearStreamingState(): void {
    isStreaming.value = false
    streamingBlocks.value = []
    currentStreamSessionId.value = null
    currentStreamMessageId.value = null
    streamRevision.value += 1
  }

  return {
    isStreaming,
    streamingBlocks,
    currentStreamSessionId,
    currentStreamMessageId,
    streamRevision,
    setStream,
    clearStreamingState
  }
})
