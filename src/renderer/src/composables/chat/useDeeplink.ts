import { ref, computed, type Ref } from 'vue'
import { formatContextLabel } from '@/lib/utils'

/**
 * Deeplink data structure
 */
export type DeeplinkData = {
  msg?: string
  modelId?: string
  systemPrompt?: string
  autoSend?: boolean
  mentions?: string[]
}

/**
 * Pending context mention structure
 */
export type PendingContextMention = {
  id: string
  label: string
  category: 'context'
  content: string
}

/**
 * Pending scroll target structure
 */
export type PendingScrollTarget = {
  messageId?: string
  childConversationId?: string
}

/**
 * Deeplink composable
 * Handles deeplink events, context mentions, and scroll targets
 */
export function useDeeplink(activeThreadId: Ref<string | null>) {
  // Deeplink cache
  const deeplinkCache = ref<DeeplinkData | null>(null)

  // Pending context mentions by thread ID
  const pendingContextMentions = ref<Map<string, PendingContextMention>>(new Map())

  // Pending scroll targets by conversation ID
  const pendingScrollTargetByConversation = ref<Map<string, PendingScrollTarget>>(new Map())

  /**
   * Get active context mention for current thread
   */
  const activeContextMention = computed(() => {
    const threadId = activeThreadId.value
    if (!threadId) return null
    return pendingContextMentions.value.get(threadId) ?? null
  })

  /**
   * Get active pending scroll target for current thread
   */
  const activePendingScrollTarget = computed(() => {
    const threadId = activeThreadId.value
    if (!threadId) return null
    return pendingScrollTargetByConversation.value.get(threadId) ?? null
  })

  /**
   * Set pending context mention for a thread
   */
  const setPendingContextMention = (threadId: string, content: string, label?: string) => {
    if (!threadId || !content.trim()) {
      return
    }
    const displayLabel = formatContextLabel(label ?? '')
    const next = new Map(pendingContextMentions.value)
    next.set(threadId, {
      id: displayLabel,
      label: displayLabel,
      category: 'context',
      content
    })
    pendingContextMentions.value = next
  }

  /**
   * Consume (remove) context mention for a thread
   */
  const consumeContextMention = (threadId: string) => {
    if (!threadId) return
    const next = new Map(pendingContextMentions.value)
    next.delete(threadId)
    pendingContextMentions.value = next
  }

  /**
   * Queue a scroll target for a conversation
   */
  const queueScrollTarget = (conversationId: string, target: PendingScrollTarget) => {
    if (!conversationId || (!target.messageId && !target.childConversationId)) return
    const next = new Map(pendingScrollTargetByConversation.value)
    next.set(conversationId, target)
    pendingScrollTargetByConversation.value = next
  }

  /**
   * Consume (remove) pending scroll target for a conversation
   */
  const consumePendingScrollMessage = (conversationId: string) => {
    if (!conversationId) return
    const next = new Map(pendingScrollTargetByConversation.value)
    next.delete(conversationId)
    pendingScrollTargetByConversation.value = next
  }

  /**
   * Clear deeplink cache
   */
  const clearDeeplinkCache = () => {
    deeplinkCache.value = null
  }

  /**
   * Set deeplink data
   */
  const setDeeplinkData = (data: DeeplinkData) => {
    deeplinkCache.value = data
  }

  return {
    // State
    deeplinkCache,
    pendingContextMentions,
    pendingScrollTargetByConversation,

    // Computed
    activeContextMention,
    activePendingScrollTarget,

    // Methods
    setPendingContextMention,
    consumeContextMention,
    queueScrollTarget,
    consumePendingScrollMessage,
    clearDeeplinkCache,
    setDeeplinkData
  }
}
