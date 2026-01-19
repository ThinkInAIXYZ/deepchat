import { type Ref } from 'vue'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import type { WorkingStatus } from '@/stores/chat'

/**
 * Variant management composable
 * Handles variant selection logic, retry/regenerate with variants
 */
export function useVariantManagement(
  activeThreadId: Ref<string | null>,
  selectedVariantsMap: Ref<Record<string, string>>,
  generatingThreadIds: Ref<Set<string>>,
  generatingMessagesCache: Ref<Map<string, { message: any; threadId: string }>>,
  configComposable: any,
  requestRegenerateFromUserMessage: (conversationId: string, userMessageId: string) => Promise<any>,
  updateThreadWorkingStatus: (threadId: string, status: WorkingStatus) => void,
  loadMessages: () => Promise<void>,
  cacheMessageForView: (message: any) => void,
  ensureMessageId: (messageId: string) => void
) {
  const conversationCore = useConversationCore()

  // 标志：是否正在更新变体选择（用于防止 LIST_UPDATED 循环）
  let isUpdatingVariant = false

  /**
   * Get the isUpdatingVariant flag
   */
  const getIsUpdatingVariant = () => isUpdatingVariant

  /**
   * Regenerate from a user message
   * @param userMessageId User message ID to regenerate from
   */
  const regenerateFromUserMessage = async (userMessageId: string) => {
    const activeThread = activeThreadId.value
    if (!activeThread) return
    try {
      generatingThreadIds.value.add(activeThread)
      updateThreadWorkingStatus(activeThread, 'working')

      const aiResponseMessage = await requestRegenerateFromUserMessage(activeThread, userMessageId)

      generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: activeThreadId.value!
      })
      cacheMessageForView(aiResponseMessage)
      ensureMessageId(aiResponseMessage.id)

      await loadMessages()
    } catch (error) {
      console.error('Failed to regenerate from user message:', error)
      throw error
    }
  }

  /**
   * Retry from a user message
   * @param userMessageId User message ID to retry from
   * @param retryMessage Retry message function
   */
  const retryFromUserMessage = async (
    userMessageId: string,
    retryMessage: (messageId: string) => Promise<void>
  ) => {
    const activeThread = activeThreadId.value
    if (!activeThread) return false

    try {
      const mainMessage = await conversationCore.getMainMessageByParentId(
        activeThread,
        userMessageId
      )
      if (mainMessage) {
        await retryMessage(mainMessage.id)
        return true
      }

      await regenerateFromUserMessage(userMessageId)
      return true
    } catch (error) {
      console.error('Failed to retry from user message:', error)
      throw error
    }
  }

  /**
   * Update selected variant for a message
   * @param mainMessageId Main message ID
   * @param selectedVariantId Selected variant ID (null to clear)
   */
  const updateSelectedVariant = async (mainMessageId: string, selectedVariantId: string | null) => {
    const threadId = activeThreadId.value
    if (!threadId) return

    isUpdatingVariant = true

    // 更新内存中的映射
    if (selectedVariantId && selectedVariantId !== mainMessageId) {
      selectedVariantsMap.value[mainMessageId] = selectedVariantId
    } else {
      delete selectedVariantsMap.value[mainMessageId]
    }

    // 同步更新 chatConfig
    if (configComposable.chatConfig.value) {
      configComposable.chatConfig.value.selectedVariantsMap = { ...selectedVariantsMap.value }
    }

    // 持久化到后端
    try {
      await conversationCore.updateConversationSettings(threadId, {
        selectedVariantsMap: selectedVariantsMap.value
      })
    } catch (error) {
      console.error('Failed to update selected variant:', error)
    } finally {
      setTimeout(() => {
        isUpdatingVariant = false
      }, 100)
    }
  }

  /**
   * Clear selected variant for a message
   * @param mainMessageId Main message ID
   * @returns True if variant was cleared
   */
  const clearSelectedVariantForMessage = (mainMessageId: string): boolean => {
    if (!mainMessageId) return false
    if (!selectedVariantsMap.value[mainMessageId]) return false
    void updateSelectedVariant(mainMessageId, null)
    return true
  }

  return {
    // Variant selection
    updateSelectedVariant,
    clearSelectedVariantForMessage,
    getIsUpdatingVariant,

    // Regenerate/retry
    regenerateFromUserMessage,
    retryFromUserMessage
  }
}
