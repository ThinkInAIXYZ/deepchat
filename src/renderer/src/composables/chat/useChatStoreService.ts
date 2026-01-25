import { ref, computed, onMounted, watch } from 'vue'
import type {
  UserMessageContent,
  AssistantMessageBlock,
  AssistantMessage,
  UserMessage,
  Message
} from '@shared/chat'
import type { CONVERSATION } from '@shared/presenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'
import {
  clearCachedMessagesForThread,
  clearMessageDomInfo,
  deleteCachedMessage,
  getCachedMessage
} from '@/lib/messageRuntimeCache'
import { getMessageTextForContext } from '@/lib/utils'
import { useChatAudio } from '@/composables/chat/useChatAudio'
import { useThreadExport } from '@/composables/chat/useThreadExport'
import { useDeeplink } from '@/composables/chat/useDeeplink'
import { useChatConfig } from '@/composables/chat/useChatConfig'
import { useThreadManagement } from '@/composables/chat/useThreadManagement'
import { useMessageCache } from '@/composables/chat/useMessageCache'
import { useVariantManagement } from '@/composables/chat/useVariantManagement'
import { useExecutionAdapter } from '@/composables/chat/useExecutionAdapter'
import { useChatEvents } from '@/composables/chat/useChatEvents'
import { useChatAdapter } from '@/composables/chat/useChatAdapter'

export type WorkingStatus = 'working' | 'error' | 'completed' | 'none'

type PendingContextMention = {
  id: string
  label: string
  category: 'context'
  content: string
}

type PendingScrollTarget = {
  messageId?: string
  childConversationId?: string
}

export type MessageListItem = {
  id: string
  message: Message | null
}

export const useChatStoreService = () => {
  const conversationCore = useConversationCore()
  const chatAdapter = useChatAdapter()
  useChatMode() // Initialize chat mode but don't destructure unused values

  const activeThreadId = ref<string | null>(null)
  const threads = ref<
    {
      dt: string
      dtThreads: CONVERSATION[]
    }[]
  >([])
  const messageIds = ref<string[]>([])
  const messageCacheVersion = ref(0)
  const generatingThreadIds = ref(new Set<string>())
  const childThreadsByMessageId = ref<Map<string, CONVERSATION[]>>(new Map())
  const pendingContextMentions = ref<Map<string, PendingContextMention>>(new Map())
  const pendingScrollTargetByConversation = ref<Map<string, PendingScrollTarget>>(new Map())

  const threadsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())

  const generatingMessagesCache = ref<Map<string, { message: Message; threadId: string }>>(
    new Map()
  )

  const selectedVariantsMap = ref<Record<string, string>>({})

  const audioComposable = useChatAudio()
  const exportComposable = useThreadExport()
  const deeplinkComposable = useDeeplink(activeThreadId)
  const configComposable = useChatConfig(activeThreadId, threads, selectedVariantsMap)
  let threadManagementComposable: ReturnType<typeof useThreadManagement>

  const getTabId = () => window.api.getWebContentsId()

  const getActiveThreadId = () => activeThreadId.value
  const getMessageIds = () => messageIds.value
  const getGeneratingMessagesCache = () => generatingMessagesCache.value

  const setActiveThreadId = (threadId: string | null) => {
    activeThreadId.value = threadId
  }
  const setMessageIds = (ids: string[]) => {
    messageIds.value = ids
    messageCacheVersion.value += 1
  }
  const getCurrentThreadMessages = () => {
    if (!activeThreadId.value) return []
    return messageCacheComposable.getLoadedMessages()
  }

  const activeThread = computed(() => {
    return threads.value.flatMap((t) => t.dtThreads).find((t) => t.id === activeThreadId.value)
  })

  // ACP mode is no longer available after cleanup
  const isAcpMode = computed(() => false)
  const activeAcpAgentId = computed(() => null as string | null)

  const activeAgentMcpSelectionsState = ref<string[] | null>(null)
  let activeAgentMcpSelectionsRequestId = 0

  const refreshActiveAgentMcpSelections = async () => {
    const requestId = ++activeAgentMcpSelectionsRequestId

    if (!isAcpMode.value || !activeAcpAgentId.value) {
      activeAgentMcpSelectionsState.value = null
      return
    }

    try {
      const selections = await chatAdapter.getAgentMcpSelections(activeAcpAgentId.value)
      if (activeAgentMcpSelectionsRequestId !== requestId) return
      activeAgentMcpSelectionsState.value = Array.isArray(selections) ? selections : []
    } catch (error) {
      if (activeAgentMcpSelectionsRequestId !== requestId) return
      console.warn('[Chat Store] Failed to load ACP agent MCP selections:', error)
      activeAgentMcpSelectionsState.value = []
    }
  }

  watch(
    [isAcpMode, activeAcpAgentId],
    () => {
      void refreshActiveAgentMcpSelections()
    },
    { immediate: true }
  )

  const activeAgentMcpSelections = computed(() => activeAgentMcpSelectionsState.value)

  const resolveVariantMessage = (
    message: Message,
    currentSelectedVariants: Record<string, string>
  ) => {
    if (message.role === 'assistant' && currentSelectedVariants[message.id]) {
      const selectedVariantId = currentSelectedVariants[message.id]
      if (!selectedVariantId) return message
      const selectedVariant = (message as AssistantMessage).variants?.find(
        (v) => v.id === selectedVariantId
      )
      if (selectedVariant) {
        const newMsg = JSON.parse(JSON.stringify(message))
        newMsg.content = selectedVariant.content
        newMsg.usage = selectedVariant.usage
        newMsg.model_id = selectedVariant.model_id
        newMsg.model_provider = selectedVariant.model_provider
        newMsg.model_name = selectedVariant.model_name
        return newMsg
      }
    }

    return message
  }

  const messageItems = computed((): MessageListItem[] => {
    const ids = messageIds.value
    const cacheVersion = messageCacheVersion.value
    const currentSelectedVariants = selectedVariantsMap.value
    if (cacheVersion < 0) return []

    return ids.map((messageId) => {
      const cached = getCachedMessage(messageId)
      if (!cached) {
        return { id: messageId, message: null }
      }
      return {
        id: messageId,
        message: resolveVariantMessage(cached, currentSelectedVariants)
      }
    })
  })

  const variantAwareMessages = computed((): Array<Message> => {
    return messageItems.value
      .map((item) => item.message)
      .filter((message): message is Message => Boolean(message))
  })

  const messageCount = computed(() => {
    const cacheVersion = messageCacheVersion.value
    if (cacheVersion < 0) return 0
    return messageIds.value.length
  })

  const setAgentWorkspacePreference = (workspacePath: string | null) => {
    configComposable.setAgentWorkspacePreference(workspacePath)
  }

  const queueScrollTarget = (conversationId: string, target: PendingScrollTarget) => {
    deeplinkComposable.queueScrollTarget(conversationId, target)
  }

  const enrichMessageWithExtra = async (message: Message): Promise<Message> => {
    if (
      Array.isArray((message as AssistantMessage).content) &&
      (message as AssistantMessage).content.some((block) => block.extra)
    ) {
      const attachments = await conversationCore.getMessageExtraInfo(message.id, 'search_result')
      ;(message as AssistantMessage).content = (message as AssistantMessage).content.map(
        (block) => {
          if (block.type === 'search' && block.extra) {
            return {
              ...block,
              extra: {
                ...block.extra,
                pages: attachments.map((attachment) => ({
                  title: attachment.title,
                  url: attachment.url,
                  content: attachment.content,
                  description: attachment.description,
                  icon: attachment.icon
                }))
              }
            }
          }
          return block
        }
      )
      const assistantMessage = message as AssistantMessage
      if (assistantMessage.variants && assistantMessage.variants.length > 0) {
        assistantMessage.variants = await Promise.all(
          assistantMessage.variants.map((variant) => enrichMessageWithExtra(variant))
        )
      }
    }

    return message
  }

  threadManagementComposable = useThreadManagement(
    activeThreadId,
    threads,
    messageIds,
    selectedVariantsMap,
    childThreadsByMessageId,
    pendingContextMentions,
    pendingScrollTargetByConversation,
    generatingThreadIds,
    generatingMessagesCache,
    configComposable,
    setActiveThreadId,
    setMessageIds,
    getTabId
  )

  const messageCacheComposable = useMessageCache(
    messageIds,
    messageCacheVersion,
    setMessageIds,
    enrichMessageWithExtra
  )

  const maybeQueueContextMention = async () => {
    const threadId = activeThreadId.value
    if (!threadId) return
    if (pendingContextMentions.value.has(threadId)) return
    if (messageIds.value.length > 0) return

    const active = activeThread.value
    if (!active?.parentMessageId) return

    const parentMessage = await conversationCore.getMessage(active.parentMessageId)
    const parentText = getMessageTextForContext(parentMessage)
    if (!parentText.trim()) return

    const selectionLabel = active.parentSelection?.selectedText ?? ''
    deeplinkComposable.setPendingContextMention(threadId, parentText, selectionLabel)
  }

  const updateThreadWorkingStatus = (threadId: string, status: WorkingStatus) => {
    if (activeThreadId.value === threadId && (status === 'completed' || status === 'error')) {
      threadsWorkingStatus.value.delete(threadId)
      return
    }

    const oldStatus = threadsWorkingStatus.value.get(threadId)
    if (oldStatus !== status) {
      threadsWorkingStatus.value.set(threadId, status)
    }
  }

  const getThreadWorkingStatus = (threadId: string): WorkingStatus | null => {
    return threadsWorkingStatus.value.get(threadId) || null
  }

  const loadMessages = async () => {
    if (!activeThreadId.value) return

    try {
      childThreadsByMessageId.value = new Map()
      const messageIds = (await conversationCore.getMessageIds(activeThreadId.value!)) || []
      setMessageIds(Array.isArray(messageIds) ? messageIds : [])
      const activeThread = activeThreadId.value
      for (const [, cached] of generatingMessagesCache.value) {
        if (cached.threadId === activeThread) {
          const enriched = await enrichMessageWithExtra(cached.message)
          if (!enriched.is_variant) {
            messageCacheComposable.cacheMessageForView(enriched)
            messageCacheComposable.ensureMessageId(enriched.id)
          }
        }
      }
      await messageCacheComposable.prefetchMessagesForRange(0, Math.min(messageIds.length - 1, 50))
      await threadManagementComposable.refreshChildThreadsForActiveThread()
      await maybeQueueContextMention()
    } catch (error) {
      console.error('Failed to load messages:', error)
      throw error
    }
  }

  const executionAdapter = useExecutionAdapter({
    activeThreadId,
    selectedVariantsMap,
    generatingThreadIds,
    generatingMessagesCache,
    threadsWorkingStatus,
    updateThreadWorkingStatus,
    loadMessages,
    enrichMessageWithExtra,
    audioComposable,
    messageCacheComposable,
    getTabId
  })
  const runtimeAdapter = executionAdapter

  const sendMessage = async (content: UserMessageContent | AssistantMessageBlock[]) => {
    return executionAdapter.sendMessage(content)
  }

  const retryMessage = async (messageId: string) => {
    if (!activeThreadId.value) return
    try {
      const aiResponseMessage = await executionAdapter.requestRetryMessage(messageId)
      let didUpdateVariant = false
      generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: activeThreadId.value!
      })
      if (aiResponseMessage.parentId) {
        const mainMessage = messageCacheComposable.findMainAssistantMessageByParentId(
          aiResponseMessage.parentId
        )
        if (mainMessage) {
          if (!mainMessage.variants) {
            mainMessage.variants = []
          }
          const existingIndex = mainMessage.variants.findIndex((v) => v.id === aiResponseMessage.id)
          if (existingIndex !== -1) {
            mainMessage.variants[existingIndex] = aiResponseMessage
          } else {
            mainMessage.variants.push(aiResponseMessage)
          }
          messageCacheComposable.cacheMessageForView({ ...mainMessage })
          messageCacheComposable.ensureMessageId(mainMessage.id)
          await variantManagementComposable.updateSelectedVariant(
            mainMessage.id,
            aiResponseMessage.id
          )
          didUpdateVariant = true
        }
      }
      await loadMessages()
      if (aiResponseMessage.parentId && !didUpdateVariant) {
        const mainMessage = await conversationCore.getMainMessageByParentId(
          activeThreadId.value!,
          aiResponseMessage.parentId
        )
        if (mainMessage) {
          await variantManagementComposable.updateSelectedVariant(
            mainMessage.id,
            aiResponseMessage.id
          )
        }
      }
      generatingThreadIds.value.add(activeThreadId.value!)
      updateThreadWorkingStatus(activeThreadId.value!, 'working')
    } catch (error) {
      console.error('Failed to retry message:', error)
      throw error
    }
  }

  const retryFromUserMessage = async (userMessageId: string) => {
    return variantManagementComposable.retryFromUserMessage(userMessageId, retryMessage)
  }

  const deleteMessage = async (messageId: string) => {
    const threadId = activeThreadId.value
    if (!threadId) return

    try {
      const messages = messageCacheComposable.getLoadedMessages()
      let parentMessage: AssistantMessage | undefined
      let parentIndex = -1
      const mainMsgIndex = messages.findIndex((m) => m.id === messageId)
      if (mainMsgIndex !== -1 && (messages[mainMsgIndex] as AssistantMessage).is_variant === 0) {
        if (selectedVariantsMap.value[messageId]) {
          delete selectedVariantsMap.value[messageId]
          await variantManagementComposable.updateSelectedVariant(messageId, null)
        }
      } else {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as AssistantMessage
          if (msg.role === 'assistant' && msg.variants?.some((v) => v.id === messageId)) {
            parentMessage = msg
            parentIndex = i
            break
          }
        }

        if (parentMessage && parentIndex !== -1) {
          const remainingVariants = parentMessage.variants?.filter((v) => v.id !== messageId) || []
          parentMessage.variants = remainingVariants
          messages[parentIndex] = { ...parentMessage }
          const newSelectedVariantId =
            remainingVariants.length > 0 ? remainingVariants[remainingVariants.length - 1].id : null
          await variantManagementComposable.updateSelectedVariant(
            parentMessage.id,
            newSelectedVariantId
          )
        }
      }

      await conversationCore.deleteMessage(messageId)
      deleteCachedMessage(messageId)
      await loadMessages()
    } catch (error) {
      console.error('Failed to delete message:', error)
      await loadMessages()
    }
  }

  const clearAllMessages = async (threadId: string) => {
    if (!threadId) return
    try {
      await conversationCore.clearAllMessages(threadId)
      clearCachedMessagesForThread(threadId)
      if (threadId === activeThreadId.value) {
        setMessageIds([])
        clearMessageDomInfo()
      }
      const cache = generatingMessagesCache.value
      for (const [messageId, cached] of cache.entries()) {
        if (cached.threadId === threadId) {
          cache.delete(messageId)
        }
      }
      generatingThreadIds.value.delete(threadId)
      generatingThreadIds.value = new Set(generatingThreadIds.value)
      threadsWorkingStatus.value.delete(threadId)
    } catch (error) {
      console.error('Failed to clear messages:', error)
      throw error
    }
  }

  const cancelGenerating = async (threadId: string) => {
    return executionAdapter.cancelGenerating(threadId)
  }
  const continueStream = async (conversationId: string, messageId: string) => {
    return executionAdapter.continueStream(conversationId, messageId)
  }

  const handleMessageEdited = async (msgId: string) => {
    const cached = generatingMessagesCache.value.get(msgId)
    if (cached) {
      const updatedMessage = await conversationCore.getMessage(msgId)
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      cached.message = enrichedMessage as AssistantMessage | UserMessage

      if (cached.threadId === activeThreadId.value) {
        if (enrichedMessage.is_variant && enrichedMessage.parentId) {
          const mainMessage = await conversationCore.getMainMessageByParentId(
            cached.threadId,
            enrichedMessage.parentId
          )
          if (mainMessage) {
            const enrichedMainMessage = await enrichMessageWithExtra(mainMessage)
            messageCacheComposable.cacheMessageForView(
              enrichedMainMessage as AssistantMessage | UserMessage
            )
            messageCacheComposable.ensureMessageId(enrichedMainMessage.id)
            return
          }
        }

        messageCacheComposable.cacheMessageForView(
          enrichedMessage as AssistantMessage | UserMessage
        )
        if (!enrichedMessage.is_variant) {
          messageCacheComposable.ensureMessageId(enrichedMessage.id)
        }
      }
    } else if (activeThreadId.value) {
      const updatedMessage = await conversationCore.getMessage(msgId)
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      if (enrichedMessage.is_variant && enrichedMessage.parentId) {
        const mainMessage = await conversationCore.getMainMessageByParentId(
          activeThreadId.value!,
          enrichedMessage.parentId
        )
        if (mainMessage) {
          const enrichedMainMessage = await enrichMessageWithExtra(mainMessage)
          messageCacheComposable.cacheMessageForView(
            enrichedMainMessage as AssistantMessage | UserMessage
          )
          messageCacheComposable.ensureMessageId(enrichedMainMessage.id)
          return
        }
      }

      messageCacheComposable.cacheMessageForView(enrichedMessage as AssistantMessage | UserMessage)
      if (!enrichedMessage.is_variant) {
        messageCacheComposable.ensureMessageId(enrichedMessage.id)
      }
    }
  }

  const handleMeetingInstruction = async (data: { prompt: string }) => {
    if (!activeThreadId.value) {
      console.warn('Received meeting command, but no active session. Command ignored.')
      return
    }
    try {
      await sendMessage({
        text: data.prompt,
        files: [],
        links: [],
        think: false,
        search: false,
        content: [{ type: 'text', content: data.prompt }]
      })
    } catch (error) {
      console.error('Error occurred while processing meeting command:', error)
    }
  }

  const variantManagementComposable = useVariantManagement(
    activeThreadId,
    selectedVariantsMap,
    generatingThreadIds,
    generatingMessagesCache,
    configComposable,
    executionAdapter.requestRegenerateFromUserMessage,
    updateThreadWorkingStatus,
    loadMessages,
    messageCacheComposable.cacheMessageForView,
    messageCacheComposable.ensureMessageId
  )

  const handleStreamResponse = runtimeAdapter.handleStreamResponse
  const handleStreamEnd = runtimeAdapter.handleStreamEnd
  const handleStreamError = runtimeAdapter.handleStreamError

  const chatEventsComposable = useChatEvents(
    activeThreadId,
    threads,
    selectedVariantsMap,
    threadsWorkingStatus,
    getTabId,
    setActiveThreadId,
    loadMessages,
    handleMessageEdited,
    handleMeetingInstruction,
    sendMessage,
    queueScrollTarget,
    refreshActiveAgentMcpSelections,
    threadManagementComposable,
    configComposable,
    deeplinkComposable,
    variantManagementComposable,
    runtimeAdapter
  )

  onMounted(() => {
    chatEventsComposable.initializeEventListeners()
  })

  const showProviderSelector = () => {
    window.dispatchEvent(new CustomEvent('show-provider-selector'))
  }

  return {
    activeThreadId,
    threads,
    messageIds,
    generatingThreadIds,
    selectedVariantsMap,
    childThreadsByMessageId,
    activeThread,
    messageItems,
    variantAwareMessages,
    messageCount,
    activeContextMention: deeplinkComposable.activeContextMention,
    activePendingScrollTarget: deeplinkComposable.activePendingScrollTarget,
    isAcpMode,
    activeAgentMcpSelections,
    loadMessages,
    sendMessage,
    handleStreamResponse,
    handleStreamEnd,
    handleStreamError,
    handleMessageEdited,
    prefetchMessagesForRange: messageCacheComposable.prefetchMessagesForRange,
    ensureMessagesLoadedByIds: messageCacheComposable.ensureMessagesLoadedByIds,
    prefetchAllMessages: messageCacheComposable.prefetchAllMessages,
    recordMessageDomInfo: messageCacheComposable.recordMessageDomInfo,
    hasMessageDomInfo: messageCacheComposable.hasMessageDomInfo,
    chatConfig: configComposable.chatConfig,
    updateChatConfig: configComposable.updateChatConfig,
    loadChatConfig: configComposable.loadChatConfig,
    setAgentWorkspacePreference,
    retryMessage,
    deleteMessage,
    cancelGenerating,
    clearAllMessages,
    continueStream,
    deeplinkCache: deeplinkComposable.deeplinkCache,
    clearDeeplinkCache: deeplinkComposable.clearDeeplinkCache,
    consumeContextMention: deeplinkComposable.consumeContextMention,
    consumePendingScrollMessage: deeplinkComposable.consumePendingScrollMessage,
    createNewEmptyThread: threadManagementComposable.createNewEmptyThread,
    createThread: threadManagementComposable.createThread,
    setActiveThread: threadManagementComposable.setActiveThread,
    openThreadInNewTab: threadManagementComposable.openThreadInNewTab,
    clearActiveThread: threadManagementComposable.clearActiveThread,
    renameThread: threadManagementComposable.renameThread,
    toggleThreadPinned: threadManagementComposable.toggleThreadPinned,
    forkThread: threadManagementComposable.forkThread,
    createChildThreadFromSelection: threadManagementComposable.createChildThreadFromSelection,
    clearSelectedVariantForMessage: variantManagementComposable.clearSelectedVariantForMessage,
    updateSelectedVariant: variantManagementComposable.updateSelectedVariant,
    regenerateFromUserMessage: variantManagementComposable.regenerateFromUserMessage,
    retryFromUserMessage,
    updateThreadWorkingStatus,
    getThreadWorkingStatus,
    threadsWorkingStatus,
    getActiveThreadId,
    setActiveThreadId,
    getMessageIds,
    getGeneratingMessagesCache,
    getCurrentThreadMessages,
    exportThread: exportComposable.exportThread,
    submitToNowledgeMem: exportComposable.submitToNowledgeMem,
    testNowledgeMemConnection: exportComposable.testNowledgeMemConnection,
    updateNowledgeMemConfig: exportComposable.updateNowledgeMemConfig,
    getNowledgeMemConfig: exportComposable.getNowledgeMemConfig,
    showProviderSelector
  }
}
