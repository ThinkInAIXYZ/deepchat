import { defineStore } from 'pinia'
import { ref, computed, onMounted, watch } from 'vue'
import type {
  UserMessageContent,
  AssistantMessageBlock,
  AssistantMessage,
  UserMessage,
  Message
} from '@shared/chat'
import type { CONVERSATION } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'
import {
  clearCachedMessagesForThread,
  clearMessageDomInfo,
  deleteCachedMessage,
  getCachedMessage
} from '@/lib/messageRuntimeCache'
import { getMessageTextForContext } from '@/lib/utils'
// Composables
import { useChatAudio } from '@/composables/chat/useChatAudio'
import { useThreadExport } from '@/composables/chat/useThreadExport'
import { useDeeplink } from '@/composables/chat/useDeeplink'
import { useChatConfig } from '@/composables/chat/useChatConfig'
import { useThreadManagement } from '@/composables/chat/useThreadManagement'
import { useMessageCache } from '@/composables/chat/useMessageCache'
import { useVariantManagement } from '@/composables/chat/useVariantManagement'
import { useExecutionAdapter } from '@/composables/chat/useExecutionAdapter'
import { useChatEvents } from '@/composables/chat/useChatEvents'

// 定义会话工作状态类型
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

export const useChatStore = defineStore('chat', () => {
  const conversationCore = useConversationCore()
  const configP = usePresenter('configPresenter')
  const { currentMode } = useChatMode()

  // 状态 - Single WebContents Architecture (simplified from Map<tabId, ...>)
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
  const isSidebarOpen = ref(false)
  const isMessageNavigationOpen = ref(false)
  const childThreadsByMessageId = ref<Map<string, CONVERSATION[]>>(new Map())
  const pendingContextMentions = ref<Map<string, PendingContextMention>>(new Map())
  const pendingScrollTargetByConversation = ref<Map<string, PendingScrollTarget>>(new Map())

  // 使用Map来存储会话工作状态 - Single WebContents Architecture
  const threadsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())

  // 添加消息生成缓存 - Single WebContents Architecture
  const generatingMessagesCache = ref<Map<string, { message: Message; threadId: string }>>(
    new Map()
  )

  // 用于管理当前激活会话的 selectedVariantsMap
  const selectedVariantsMap = ref<Record<string, string>>({})

  // Initialize composables
  const audioComposable = useChatAudio()
  const exportComposable = useThreadExport()
  const deeplinkComposable = useDeeplink(activeThreadId)
  const configComposable = useChatConfig(activeThreadId, threads, selectedVariantsMap)
  // Thread management composable (initialized after helper functions are defined)
  let threadManagementComposable: ReturnType<typeof useThreadManagement>

  // Getters - Single WebContents Architecture (simplified)
  // Note: getTabId() is kept for IPC communication with main process
  const getTabId = () => window.api.getWebContentsId()

  // Simple getters for external compatibility (internal code uses .value directly)
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

  const isAcpMode = computed(() => currentMode.value === 'acp agent')
  const activeAcpAgentId = computed(() =>
    isAcpMode.value ? configComposable.chatConfig.value.modelId?.trim() || null : null
  )

  const activeAgentMcpSelectionsState = ref<string[] | null>(null)
  let activeAgentMcpSelectionsRequestId = 0

  const refreshActiveAgentMcpSelections = async () => {
    const requestId = ++activeAgentMcpSelectionsRequestId

    if (!isAcpMode.value || !activeAcpAgentId.value) {
      activeAgentMcpSelectionsState.value = null
      return
    }

    try {
      const selections = await configP.getAgentMcpSelections(activeAcpAgentId.value)
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

  // Actions
  const setAcpWorkdirPreference = (agentId: string, workdir: string | null) => {
    configComposable.setAcpWorkdirPreference(agentId, workdir)
  }

  const setAgentWorkspacePreference = (workspacePath: string | null) => {
    configComposable.setAgentWorkspacePreference(workspacePath)
  }

  const queueScrollTarget = (conversationId: string, target: PendingScrollTarget) => {
    deeplinkComposable.queueScrollTarget(conversationId, target)
  }

  // 处理消息的 extra 信息
  const enrichMessageWithExtra = async (message: Message): Promise<Message> => {
    if (
      Array.isArray((message as AssistantMessage).content) &&
      (message as AssistantMessage).content.some((block) => block.extra)
    ) {
      const attachments = await conversationCore.getMessageExtraInfo(message.id, 'search_result')
      // 更新消息中的 extra 信息
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
      // 处理变体消息的 extra 信息
      const assistantMessage = message as AssistantMessage
      if (assistantMessage.variants && assistantMessage.variants.length > 0) {
        assistantMessage.variants = await Promise.all(
          assistantMessage.variants.map((variant) => enrichMessageWithExtra(variant))
        )
      }
    }

    return message
  }

  // Initialize thread management composable after helper functions are defined
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

  // Initialize message cache composable
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
      // 将正在生成的变体消息缓存起来，但不插入消息列表，避免额外的消息行
      generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: activeThreadId.value!
      })
      // 将新变体挂到主消息，确保流式更新能渲染到当前消息上
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
      // 设置当前会话的workingStatus为working
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
      // 清空本地消息列表
      if (threadId === activeThreadId.value) {
        setMessageIds([])
        clearMessageDomInfo()
      }
      // 清空生成缓存中的相关消息
      const cache = generatingMessagesCache.value
      for (const [messageId, cached] of cache.entries()) {
        if (cached.threadId === threadId) {
          cache.delete(messageId)
        }
      }
      generatingThreadIds.value.delete(threadId)
      generatingThreadIds.value = new Set(generatingThreadIds.value)
      // 从状态Map中移除会话状态
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
    // 首先检查是否在生成缓存中
    const cached = generatingMessagesCache.value.get(msgId)
    if (cached) {
      // 如果在缓存中，获取最新的消息
      const updatedMessage = await conversationCore.getMessage(msgId)
      // 处理 extra 信息
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      // 更新缓存
      cached.message = enrichedMessage as AssistantMessage | UserMessage

      // 如果是当前会话的消息，也更新显示
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

  /**
   * 新增: 处理来自主进程的会议指令
   * @param data 包含指令文本的对象
   */
  const handleMeetingInstruction = async (data: { prompt: string }) => {
    // 确保当前有活动的会话，否则指令无法执行
    if (!activeThreadId.value) {
      console.warn('Received meeting command, but no active session. Command ignored.')
      return
    }
    try {
      // 将收到的指令作为用户输入，调用已有的sendMessage方法
      // 这样可以完全复用UI的加载状态、消息显示等所有逻辑
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

  // Initialize variant management composable
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

  // Initialize chat events composable
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

  /**
   * 显示 provider 选择器（触发事件让界面显示选择器）
   */
  const showProviderSelector = () => {
    // 触发事件让 ChatInput 组件显示 provider 选择器
    window.dispatchEvent(new CustomEvent('show-provider-selector'))
  }

  return {
    // 状态 - Single WebContents Architecture
    isSidebarOpen,
    isMessageNavigationOpen,
    activeThreadId,
    threads,
    messageIds,
    generatingThreadIds,
    selectedVariantsMap,
    childThreadsByMessageId,
    // Getters
    activeThread,
    messageItems,
    variantAwareMessages,
    messageCount,
    activeContextMention: deeplinkComposable.activeContextMention,
    activePendingScrollTarget: deeplinkComposable.activePendingScrollTarget,
    isAcpMode,
    activeAgentMcpSelections,
    // Actions
    loadMessages,
    sendMessage,
    handleStreamResponse,
    handleStreamEnd,
    handleStreamError,
    handleMessageEdited,
    // Message cache composable
    prefetchMessagesForRange: messageCacheComposable.prefetchMessagesForRange,
    ensureMessagesLoadedByIds: messageCacheComposable.ensureMessagesLoadedByIds,
    prefetchAllMessages: messageCacheComposable.prefetchAllMessages,
    recordMessageDomInfo: messageCacheComposable.recordMessageDomInfo,
    hasMessageDomInfo: messageCacheComposable.hasMessageDomInfo,
    // Config composable
    chatConfig: configComposable.chatConfig,
    updateChatConfig: configComposable.updateChatConfig,
    loadChatConfig: configComposable.loadChatConfig,
    setAcpWorkdirPreference,
    setAgentWorkspacePreference,
    // Message actions
    retryMessage,
    deleteMessage,
    cancelGenerating,
    clearAllMessages,
    continueStream,
    // Deeplink composable
    deeplinkCache: deeplinkComposable.deeplinkCache,
    clearDeeplinkCache: deeplinkComposable.clearDeeplinkCache,
    consumeContextMention: deeplinkComposable.consumeContextMention,
    consumePendingScrollMessage: deeplinkComposable.consumePendingScrollMessage,
    // Thread management composable
    createNewEmptyThread: threadManagementComposable.createNewEmptyThread,
    createThread: threadManagementComposable.createThread,
    setActiveThread: threadManagementComposable.setActiveThread,
    openThreadInNewTab: threadManagementComposable.openThreadInNewTab,
    clearActiveThread: threadManagementComposable.clearActiveThread,
    renameThread: threadManagementComposable.renameThread,
    toggleThreadPinned: threadManagementComposable.toggleThreadPinned,
    forkThread: threadManagementComposable.forkThread,
    createChildThreadFromSelection: threadManagementComposable.createChildThreadFromSelection,
    // Variant management composable
    clearSelectedVariantForMessage: variantManagementComposable.clearSelectedVariantForMessage,
    updateSelectedVariant: variantManagementComposable.updateSelectedVariant,
    regenerateFromUserMessage: variantManagementComposable.regenerateFromUserMessage,
    retryFromUserMessage,
    // Working status
    updateThreadWorkingStatus,
    getThreadWorkingStatus,
    threadsWorkingStatus,
    // Legacy getters
    getActiveThreadId,
    setActiveThreadId,
    getMessageIds,
    getGeneratingMessagesCache,
    getCurrentThreadMessages,
    // Export composable
    exportThread: exportComposable.exportThread,
    submitToNowledgeMem: exportComposable.submitToNowledgeMem,
    testNowledgeMemConnection: exportComposable.testNowledgeMemConnection,
    updateNowledgeMemConfig: exportComposable.updateNowledgeMemConfig,
    getNowledgeMemConfig: exportComposable.getNowledgeMemConfig,
    // Other
    showProviderSelector
  }
})
