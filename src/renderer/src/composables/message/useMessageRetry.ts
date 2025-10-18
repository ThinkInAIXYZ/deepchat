import { ref, type Ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import type { UserMessage, AssistantMessage } from '@shared/chat'

export function useMessageRetry(messages: Ref<Array<UserMessage | AssistantMessage>>) {
  const chatStore = useChatStore()

  // Simplified ref management - use Map for better type safety
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assistantRefs = ref(new Map<number, any>())

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setAssistantRef = (index: number) => (el: any) => {
    if (el) {
      assistantRefs.value.set(index, el)
    } else {
      assistantRefs.value.delete(index)
    }
  }

  const retryFromUserMessage = async (userMessageIndex: number) => {
    let triggered = false

    // Find next assistant message
    for (let i = userMessageIndex + 1; i < messages.value.length; i++) {
      if (messages.value[i].role === 'assistant') {
        try {
          const assistantRef = assistantRefs.value.get(i)
          if (assistantRef && typeof assistantRef.handleAction === 'function') {
            assistantRef.handleAction('retry')
            triggered = true
          }
        } catch (error) {
          console.error('Failed to trigger retry action:', error)
        }
        break
      }
    }

    // Fallback: regenerate from user message
    if (!triggered) {
      try {
        const userMsg = messages.value[userMessageIndex]
        if (userMsg && userMsg.role === 'user') {
          await chatStore.regenerateFromUserMessage(userMsg.id)
          return true
        }
      } catch (error) {
        console.error('Failed to regenerate from user message:', error)
      }
    }

    return triggered
  }

  return {
    setAssistantRef,
    retryFromUserMessage
  }
}
