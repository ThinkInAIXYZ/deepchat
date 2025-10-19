// === Vue Core ===
import { computed, Ref } from 'vue'

// === Stores ===
import { useChatStore } from '@/stores/chat'

interface SendButtonStateOptions {
  variant: 'chat' | 'newThread'
  inputText: Ref<string>
  currentContextLength: Ref<number>
  contextLength?: number
}

/**
 * Manages send button disabled state and streaming status
 */
export function useSendButtonState(options: SendButtonStateOptions) {
  const { variant, inputText, currentContextLength, contextLength } = options

  // === Stores ===
  const chatStore = useChatStore()

  // === Computed ===
  const disabledSend = computed(() => {
    if (variant === 'newThread') {
      return inputText.value.length <= 0 || currentContextLength.value > (contextLength ?? 200000)
    }

    // chat variant
    const activeThreadId = chatStore.getActiveThreadId()
    if (activeThreadId) {
      return (
        chatStore.generatingThreadIds.has(activeThreadId) ||
        inputText.value.length <= 0 ||
        currentContextLength.value > (contextLength ?? chatStore.chatConfig.contextLength)
      )
    }
    return false
  })

  const isStreaming = computed(() => {
    if (variant === 'newThread') return false

    const activeThreadId = chatStore.getActiveThreadId()
    if (activeThreadId) {
      return chatStore.generatingThreadIds.has(activeThreadId)
    }
    return false
  })

  return {
    disabledSend,
    isStreaming
  }
}
