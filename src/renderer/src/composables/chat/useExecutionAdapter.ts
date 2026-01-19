import type { Ref } from 'vue'
import type { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import { usePresenter } from '@/composables/usePresenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import { useMessageStreaming } from '@/composables/chat/useMessageStreaming'
import { useWorkspaceStore } from '@/stores/workspace'
import type { WorkingStatus } from '@/stores/chat'

type MessageCacheAdapter = {
  cacheMessageForView: (message: Message) => void
  ensureMessageId: (messageId: string) => void
}

type ExecutionAdapterOptions = {
  activeThreadId: Ref<string | null>
  selectedVariantsMap: Ref<Record<string, string>>
  generatingThreadIds: Ref<Set<string>>
  generatingMessagesCache: Ref<Map<string, { message: Message; threadId: string }>>
  threadsWorkingStatus: Ref<Map<string, WorkingStatus>>
  updateThreadWorkingStatus: (threadId: string, status: WorkingStatus) => void
  loadMessages: () => Promise<void>
  enrichMessageWithExtra: (message: Message) => Promise<Message>
  audioComposable: any
  messageCacheComposable: MessageCacheAdapter
  getTabId: () => number
}

/**
 * Execution adapter for message generation and streaming workflows.
 */
export function useExecutionAdapter(options: ExecutionAdapterOptions) {
  const agentP = usePresenter('agentPresenter')
  const conversationCore = useConversationCore()
  let workspaceStore: ReturnType<typeof useWorkspaceStore> | null = null

  const getWorkspaceStore = () => {
    if (!workspaceStore) {
      workspaceStore = useWorkspaceStore()
    }
    return workspaceStore
  }

  const messageStreamingComposable = useMessageStreaming(
    options.activeThreadId,
    options.generatingThreadIds,
    options.generatingMessagesCache,
    options.threadsWorkingStatus,
    options.updateThreadWorkingStatus,
    options.enrichMessageWithExtra,
    options.audioComposable,
    options.messageCacheComposable
  )

  const sendMessage = async (content: UserMessageContent | AssistantMessageBlock[]) => {
    const threadId = options.activeThreadId.value
    if (!threadId || !content) return

    try {
      options.generatingThreadIds.value.add(threadId)
      options.updateThreadWorkingStatus(threadId, 'working')

      const aiResponseMessage = await agentP.sendMessage(
        threadId,
        JSON.stringify(content),
        options.getTabId(),
        options.selectedVariantsMap.value
      )

      if (!aiResponseMessage) {
        throw new Error('Failed to create assistant message')
      }

      options.generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId
      })
      options.messageCacheComposable.cacheMessageForView(aiResponseMessage)
      options.messageCacheComposable.ensureMessageId(aiResponseMessage.id)

      await options.loadMessages()
    } catch (error) {
      console.error('Failed to send message:', error)
      if (threadId) {
        options.generatingThreadIds.value.delete(threadId)
        options.generatingThreadIds.value = new Set(options.generatingThreadIds.value)
        options.updateThreadWorkingStatus(threadId, 'error')
      }
      throw error
    }
  }

  const continueStream = async (conversationId: string, messageId: string) => {
    if (!conversationId || !messageId) return
    try {
      options.generatingThreadIds.value.add(conversationId)
      options.generatingThreadIds.value = new Set(options.generatingThreadIds.value)
      options.updateThreadWorkingStatus(conversationId, 'working')

      const aiResponseMessage = await agentP.continueLoop(
        conversationId,
        messageId,
        options.selectedVariantsMap.value
      )

      if (!aiResponseMessage) {
        console.error('Failed to create assistant message')
        return
      }

      options.generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: conversationId
      })
      options.messageCacheComposable.cacheMessageForView(aiResponseMessage)
      options.messageCacheComposable.ensureMessageId(aiResponseMessage.id)

      await options.loadMessages()
    } catch (error) {
      console.error('Failed to continue generation:', error)
      throw error
    }
  }

  const requestRetryMessage = async (messageId: string) => {
    return agentP.retryMessage(messageId, options.selectedVariantsMap.value)
  }

  const requestRegenerateFromUserMessage = async (
    conversationId: string,
    userMessageId: string
  ) => {
    return agentP.regenerateFromUserMessage(
      conversationId,
      userMessageId,
      options.selectedVariantsMap.value
    )
  }

  const cancelGenerating = async (threadId: string) => {
    if (!threadId) return
    try {
      await getWorkspaceStore().terminateAllRunningCommands()

      const cache = options.generatingMessagesCache.value
      const generatingMessage = Array.from(cache.entries()).find(
        ([, cached]) => cached.threadId === threadId
      ) as string[]
      if (generatingMessage) {
        const [messageId] = generatingMessage
        await agentP.cancelLoop(messageId)
        cache.delete(messageId)
        options.generatingThreadIds.value.delete(threadId)
        if (options.activeThreadId.value === threadId) {
          options.threadsWorkingStatus.value.delete(threadId)
        } else {
          options.updateThreadWorkingStatus(threadId, 'completed')
        }
        const updatedMessage = await conversationCore.getMessage(messageId)
        const enrichedMessage = await options.enrichMessageWithExtra(updatedMessage)
        options.messageCacheComposable.cacheMessageForView(enrichedMessage)
        if (!enrichedMessage.is_variant) {
          options.messageCacheComposable.ensureMessageId(enrichedMessage.id)
        }
      }
    } catch (error) {
      console.error('Failed to cancel generation:', error)
    }
  }

  return {
    sendMessage,
    continueStream,
    cancelGenerating,
    requestRetryMessage,
    requestRegenerateFromUserMessage,
    handleStreamResponse: messageStreamingComposable.handleStreamResponse,
    handleStreamEnd: messageStreamingComposable.handleStreamEnd,
    handleStreamError: messageStreamingComposable.handleStreamError
  }
}
