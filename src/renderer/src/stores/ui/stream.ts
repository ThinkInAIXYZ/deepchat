import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'

export const useStreamStateStore = defineStore('streamState', () => {
  const isStreaming = ref(false)
  const streamingBlocks = ref<AssistantMessageBlock[]>([])
  const currentStreamSessionId = ref<string | null>(null)
  const currentStreamRequestId = ref<string | null>(null)
  const currentStreamMessageId = ref<string | null>(null)
  const currentStreamUpdatedAt = ref(0)
  const currentStreamMetadata = ref<{ providerId?: string; modelId?: string } | null>(null)
  const streamRevision = ref(0)

  function setStream(
    sessionId: string,
    blocks: AssistantMessageBlock[],
    messageId?: string,
    metadata?: { providerId?: string; modelId?: string },
    requestId?: string,
    updatedAt?: number
  ): void {
    isStreaming.value = true
    currentStreamSessionId.value = sessionId
    currentStreamRequestId.value = requestId ?? messageId ?? null
    currentStreamMessageId.value = messageId ?? null
    currentStreamUpdatedAt.value = updatedAt ?? 0
    currentStreamMetadata.value = metadata ?? null
    streamingBlocks.value = blocks
    streamRevision.value += 1
  }

  function clearStreamingState(): void {
    isStreaming.value = false
    streamingBlocks.value = []
    currentStreamSessionId.value = null
    currentStreamRequestId.value = null
    currentStreamMessageId.value = null
    currentStreamUpdatedAt.value = 0
    currentStreamMetadata.value = null
    streamRevision.value += 1
  }

  return {
    isStreaming,
    streamingBlocks,
    currentStreamSessionId,
    currentStreamRequestId,
    currentStreamMessageId,
    currentStreamUpdatedAt,
    currentStreamMetadata,
    streamRevision,
    setStream,
    clearStreamingState
  }
})
