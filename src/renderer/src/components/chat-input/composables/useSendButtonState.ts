// === Vue Core ===
import { computed, Ref, unref } from 'vue'
import type { MaybeRef } from 'vue'

// === Stores ===
import { useChatStore } from '@/stores/chat'

interface SendButtonStateOptions {
  variant: 'agent' | 'newThread' | 'acp'
  inputText: Ref<string>
  currentContextLength: Ref<number>
  contextLength?: MaybeRef<number | undefined>
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
    const length = unref(contextLength)

    if (variant === 'newThread') {
      return inputText.value.length <= 0 || currentContextLength.value > (length ?? 200000)
    }

    // chat variant
    const activeSessionId = chatStore.getActiveSessionId()
    if (activeSessionId) {
      return (
        chatStore.generatingSessionIds.has(activeSessionId) ||
        inputText.value.length <= 0 ||
        currentContextLength.value > (length ?? 200000)
      )
    }
    return false
  })

  const isStreaming = computed(() => {
    if (variant === 'newThread') return false

    const activeSessionId = chatStore.getActiveSessionId()
    if (activeSessionId) {
      return chatStore.generatingSessionIds.has(activeSessionId)
    }
    return false
  })

  return {
    disabledSend,
    isStreaming
  }
}
