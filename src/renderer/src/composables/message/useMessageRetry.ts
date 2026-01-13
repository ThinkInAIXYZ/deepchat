import { ref, type Ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import type { Message } from '@shared/chat'

export function useMessageRetry(messages: Ref<Array<Message | null>>) {
  const chatStore = useChatStore()

  // Simplified ref management - use Map for better type safety
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assistantRefs = ref(new Map<string, any>())

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setAssistantRef = (messageId?: string) => (el: any) => {
    if (!messageId) return
    if (el) {
      assistantRefs.value.set(messageId, el)
    } else {
      assistantRefs.value.delete(messageId)
    }
  }

  const retryFromUserMessage = async (userMessageId?: string) => {
    if (!userMessageId) return false

    let triggered = false
    const orderedMessages = messages.value

    // Find next assistant message
    const userMessageIndex = orderedMessages.findIndex((msg) => msg?.id === userMessageId)
    if (userMessageIndex === -1) return false

    for (let i = userMessageIndex + 1; i < orderedMessages.length; i++) {
      const nextMessage = orderedMessages[i]
      if (nextMessage?.role === 'assistant') {
        try {
          const assistantRef = assistantRefs.value.get(nextMessage.id)
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
        const userMsg = orderedMessages[userMessageIndex]
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
