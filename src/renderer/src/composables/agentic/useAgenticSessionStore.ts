/**
 * useAgenticSessionStore - Unified Agentic Session Store
 *
 * Simplified chat state management with agentic presenter integration.
 * Replaces useChatStoreService with agent-agnostic architecture.
 *
 * Key Changes (Phase 6 - chatConfig removal):
 * - Removed chatConfig (CONVERSATION_SETTINGS) functionality
 * - Removed variant management (selectedVariantsMap, variant selection UI)
 * - Kept only essential SessionInfo fields: modelId, agentId, modeId, workspace
 * - Session configuration now driven by SessionInfo from AgenticPresenter
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { UserMessageContent, Message } from '@shared/chat'
import type { CONVERSATION } from '@shared/presenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import {
  clearCachedMessagesForThread,
  clearMessageDomInfo,
  deleteCachedMessage,
  getCachedMessage
} from '@/lib/messageRuntimeCache'
import { getMessageTextForContext } from '@/lib/utils'
import { useDeeplink } from '@/composables/chat/useDeeplink'
import { useAgenticExecution } from '@/composables/agentic/useAgenticExecution'
import { useMessageCache } from '@/composables/chat/useMessageCache'
import { useAgenticEvents } from '@/composables/agentic/useAgenticEvents'
import { useSessionExport } from '@/composables/agentic/useSessionExport'
import { useSessionManagement as useOldSessionManagement } from '@/composables/chat/useSessionManagement'

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

export function useAgenticSessionStore() {
  const conversationCore = useConversationCore()

  // ============================================================================
  // State
  // ============================================================================

  const activeSessionId = ref<string | null>(null)
  const sessions = ref<
    {
      dt: string
      dtThreads: CONVERSATION[]
    }[]
  >([])
  const messageIds = ref<string[]>([])
  const messageCacheVersion = ref(0)
  const generatingSessionIds = ref(new Set<string>())
  const childThreadsByMessageId = ref<Map<string, CONVERSATION[]>>(new Map())
  const pendingContextMentions = ref<Map<string, PendingContextMention>>(new Map())
  const pendingScrollTargetByConversation = ref<Map<string, PendingScrollTarget>>(new Map())

  const sessionsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())

  const generatingMessagesCache = ref<Map<string, { message: Message; sessionId: string }>>(
    new Map()
  )

  // ============================================================================
  // Composables
  // ============================================================================

  const exportComposable = useSessionExport()
  const deeplinkComposable = useDeeplink(activeSessionId)

  const getTabId = () => window.api.getWebContentsId()

  // ============================================================================
  // Getters
  // ============================================================================

  const getActiveSessionId = () => activeSessionId.value
  const getMessageIds = () => messageIds.value
  const getGeneratingMessagesCache = () => generatingMessagesCache.value

  const setActiveSessionId = (sessionId: string | null) => {
    activeSessionId.value = sessionId
  }

  const setMessageIds = (ids: string[]) => {
    messageIds.value = ids
    messageCacheVersion.value += 1
  }

  const getCurrentThreadMessages = () => {
    if (!activeSessionId.value) return []
    return messageCacheComposable.getLoadedMessages()
  }

  const activeThread = computed(() => {
    return sessions.value.flatMap((t) => t.dtThreads).find((t) => t.id === activeSessionId.value)
  })

  // ============================================================================
  // Message Items (No variant resolution)
  // ============================================================================

  const messageItems = computed((): MessageListItem[] => {
    const ids = messageIds.value
    const cacheVersion = messageCacheVersion.value
    if (cacheVersion < 0) return []

    return ids.map((messageId) => {
      const cached = getCachedMessage(messageId)
      if (!cached) {
        return { id: messageId, message: null }
      }
      return {
        id: messageId,
        message: cached // No variant resolution
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

  // ============================================================================
  // Configuration & Context
  // ============================================================================

  const enrichMessageWithExtra = async (message: Message): Promise<Message> => {
    const assistantMessage = message as { content?: Array<{ type?: string; extra?: unknown }> }
    if (
      Array.isArray(assistantMessage.content) &&
      assistantMessage.content.some((block) => block.extra)
    ) {
      const attachments = await conversationCore.getMessageExtraInfo(message.id, 'search_result')
      assistantMessage.content = assistantMessage.content.map((block) => {
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
      })
    }

    return message
  }

  const messageCacheComposable = useMessageCache(
    messageIds,
    messageCacheVersion,
    setMessageIds,
    enrichMessageWithExtra
  )

  const maybeQueueContextMention = async () => {
    const sessionId = activeSessionId.value
    if (!sessionId) return
    if (pendingContextMentions.value.has(sessionId)) return
    if (messageIds.value.length > 0) return

    const active = activeThread.value
    if (!active?.parentMessageId) return

    const parentMessage = await conversationCore.getMessage(active.parentMessageId)
    const parentText = getMessageTextForContext(parentMessage)
    if (!parentText.trim()) return

    const selectionLabel = active.parentSelection?.selectedText ?? ''
    deeplinkComposable.setPendingContextMention(sessionId, parentText, selectionLabel)
  }

  const updateSessionWorkingStatus = (sessionId: string, status: WorkingStatus) => {
    if (activeSessionId.value === sessionId && (status === 'completed' || status === 'error')) {
      sessionsWorkingStatus.value.delete(sessionId)
      return
    }

    const oldStatus = sessionsWorkingStatus.value.get(sessionId)
    if (oldStatus !== status) {
      sessionsWorkingStatus.value.set(sessionId, status)
    }
  }

  const getSessionWorkingStatus = (sessionId: string): WorkingStatus | null => {
    return sessionsWorkingStatus.value.get(sessionId) || null
  }

  // ============================================================================
  // Agentic Events Integration
  // ============================================================================

  // Use the agentic events composable for type-safe event handling
  const agenticEvents = useAgenticEvents()

  // Subscribe to events
  const unsubscribeSessionUpdated = agenticEvents.onSessionUpdated((event) => {
    if (event.sessionInfo && activeSessionId.value === event.sessionId) {
      // Reload session info when updated
      void loadMessages()
    }
  })

  const unsubscribeStatusChanged = agenticEvents.onStatusChanged((event) => {
    if (event.sessionId) {
      if (event.status === 'generating') {
        generatingSessionIds.value.add(event.sessionId)
      } else {
        generatingSessionIds.value.delete(event.sessionId)
      }
    }
  })

  const unsubscribeMessageEnd = agenticEvents.onMessageEnd((event) => {
    if (event.sessionId === activeSessionId.value) {
      void loadMessages()
    }
  })

  const unsubscribeError = agenticEvents.onError((event) => {
    if (event.sessionId) {
      updateSessionWorkingStatus(event.sessionId, 'error')
    }
  })

  // ============================================================================
  // Session Management (using old composable for now, to be migrated)
  // ============================================================================

  // Import the old session management composable for backward compatibility
  // This will be replaced with agentic session management in a future update

  const sessionManagementComposable = useOldSessionManagement(
    activeSessionId,
    sessions,
    messageIds,
    ref({}), // Empty selectedVariantsMap (variant management removed)
    childThreadsByMessageId,
    pendingContextMentions,
    pendingScrollTargetByConversation,
    generatingSessionIds,
    generatingMessagesCache,
    null, // configComposable removed
    setActiveSessionId,
    setMessageIds,
    getTabId
  )

  // ============================================================================
  // Execution
  // ============================================================================

  const executionComposable = useAgenticExecution({
    activeSessionId,
    generatingSessionIds,
    sessionsWorkingStatus,
    updateSessionWorkingStatus,
    getTabId
  })

  // Legacy execution adapter interface compatibility
  const executionAdapter = {
    sendMessage: executionComposable.sendMessage,
    continueLoop: executionComposable.continueLoop,
    cancelLoop: executionComposable.cancelGeneration,
    requestRetryMessage: executionComposable.retryMessage,
    requestRegenerateFromUserMessage: executionComposable.regenerateFromUserMessage,
    cancelGenerating: executionComposable.cancelGeneration
  }

  // ============================================================================
  // Message Operations (Simplified - No variants)
  // ============================================================================

  const sendMessage = async (content: UserMessageContent) => {
    return executionAdapter.sendMessage(content)
  }

  const retryMessage = async (messageId: string) => {
    if (!activeSessionId.value) return
    try {
      await executionAdapter.requestRetryMessage(messageId)
      await loadMessages()
      generatingSessionIds.value.add(activeSessionId.value!)
      updateSessionWorkingStatus(activeSessionId.value!, 'working')
    } catch (error) {
      console.error('[AgenticSessionStore] Failed to retry message:', error)
      throw error
    }
  }

  const deleteMessage = async (messageId: string) => {
    const sessionId = activeSessionId.value
    if (!sessionId) return

    try {
      await conversationCore.deleteMessage(messageId)
      deleteCachedMessage(messageId)
      await loadMessages()
    } catch (error) {
      console.error('[AgenticSessionStore] Failed to delete message:', error)
      await loadMessages()
    }
  }

  const clearAllMessages = async (sessionId: string) => {
    if (!sessionId) return
    try {
      await conversationCore.clearAllMessages(sessionId)
      clearCachedMessagesForThread(sessionId)
      if (sessionId === activeSessionId.value) {
        setMessageIds([])
        clearMessageDomInfo()
      }
      const cache = generatingMessagesCache.value
      for (const [messageId, cached] of cache.entries()) {
        if (cached.sessionId === sessionId) {
          cache.delete(messageId)
        }
      }
      generatingSessionIds.value.delete(sessionId)
      generatingSessionIds.value = new Set(generatingSessionIds.value)
      sessionsWorkingStatus.value.delete(sessionId)
    } catch (error) {
      console.error('[AgenticSessionStore] Failed to clear messages:', error)
      throw error
    }
  }

  const cancelGenerating = async (sessionId: string) => {
    return executionAdapter.cancelGenerating(sessionId)
  }

  const continueStream = async (_conversationId: string, messageId: string) => {
    return executionAdapter.continueLoop(messageId)
  }

  // ============================================================================
  // Message Loading
  // ============================================================================

  const loadMessages = async () => {
    if (!activeSessionId.value) return

    try {
      childThreadsByMessageId.value = new Map()
      const messageIds = (await conversationCore.getMessageIds(activeSessionId.value!)) || []
      setMessageIds(Array.isArray(messageIds) ? messageIds : [])
      const activeSession = activeSessionId.value
      for (const [, cached] of generatingMessagesCache.value) {
        if (cached.sessionId === activeSession) {
          const enriched = await enrichMessageWithExtra(cached.message)
          if (!enriched.is_variant) {
            messageCacheComposable.cacheMessageForView(enriched)
            messageCacheComposable.ensureMessageId(enriched.id)
          }
        }
      }
      await messageCacheComposable.prefetchMessagesForRange(0, Math.min(messageIds.length - 1, 50))
      await sessionManagementComposable.refreshChildThreadsForActiveThread()
      await maybeQueueContextMention()
    } catch (error) {
      console.error('[AgenticSessionStore] Failed to load messages:', error)
      throw error
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleMessageEdited = async (msgId: string) => {
    const cached = generatingMessagesCache.value.get(msgId)
    if (cached) {
      const updatedMessage = await conversationCore.getMessage(msgId)
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      cached.message = enrichedMessage

      if (cached.sessionId === activeSessionId.value) {
        messageCacheComposable.cacheMessageForView(enrichedMessage)
        if (!enrichedMessage.is_variant) {
          messageCacheComposable.ensureMessageId(enrichedMessage.id)
        }
      }
    } else if (activeSessionId.value) {
      const updatedMessage = await conversationCore.getMessage(msgId)
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      messageCacheComposable.cacheMessageForView(enrichedMessage)
      if (!enrichedMessage.is_variant) {
        messageCacheComposable.ensureMessageId(enrichedMessage.id)
      }
    }
  }

  // Register legacy event listeners for backward compatibility
  const initializeEventListeners = () => {
    // Legacy STREAM_EVENTS are now handled by useAgenticEvents
    // Additional event setup can be done here
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  onMounted(() => {
    initializeEventListeners()
  })

  onUnmounted(() => {
    unsubscribeSessionUpdated()
    unsubscribeStatusChanged()
    unsubscribeMessageEnd()
    unsubscribeError()
  })

  // ============================================================================
  // Public API
  // ============================================================================

  const showProviderSelector = () => {
    window.dispatchEvent(new CustomEvent('show-provider-selector'))
  }

  return {
    // ============================================================================
    // State
    // ============================================================================
    activeSessionId,
    sessions,
    messageIds,
    generatingSessionIds,
    childThreadsByMessageId,
    activeThread,
    messageItems,
    variantAwareMessages,
    messageCount,
    activeContextMention: deeplinkComposable.activeContextMention,
    activePendingScrollTarget: deeplinkComposable.activePendingScrollTarget,
    isAcpMode: computed(() => false),
    sessionsWorkingStatus,

    // ============================================================================
    // Message operations
    // ============================================================================
    loadMessages,
    sendMessage,
    handleMessageEdited,
    prefetchMessagesForRange: messageCacheComposable.prefetchMessagesForRange,
    ensureMessagesLoadedByIds: messageCacheComposable.ensureMessagesLoadedByIds,
    prefetchAllMessages: messageCacheComposable.prefetchAllMessages,
    recordMessageDomInfo: messageCacheComposable.recordMessageDomInfo,
    hasMessageDomInfo: messageCacheComposable.hasMessageDomInfo,

    // ============================================================================
    // Message management
    // ============================================================================
    retryMessage,
    deleteMessage,
    cancelGenerating,
    clearAllMessages,
    continueStream,

    // ============================================================================
    // Deeplink
    // ============================================================================
    deeplinkCache: deeplinkComposable.deeplinkCache,
    clearDeeplinkCache: deeplinkComposable.clearDeeplinkCache,
    consumeContextMention: deeplinkComposable.consumeContextMention,
    consumePendingScrollMessage: deeplinkComposable.consumePendingScrollMessage,

    // ============================================================================
    // Session management (from old composable)
    // ============================================================================
    createNewEmptyThread: sessionManagementComposable.createNewEmptyThread,
    createThread: sessionManagementComposable.createThread,
    setActiveThread: sessionManagementComposable.setActiveThread,
    openThreadInNewTab: sessionManagementComposable.openThreadInNewTab,
    clearActiveThread: sessionManagementComposable.clearActiveThread,
    renameThread: sessionManagementComposable.renameThread,
    toggleThreadPinned: sessionManagementComposable.toggleThreadPinned,
    forkThread: sessionManagementComposable.forkThread,
    createChildThreadFromSelection: sessionManagementComposable.createChildThreadFromSelection,

    // ============================================================================
    // Status getters
    // ============================================================================
    updateSessionWorkingStatus,
    getSessionWorkingStatus,
    getActiveSessionId,
    setActiveSessionId,
    getMessageIds,
    getGeneratingMessagesCache,
    getCurrentThreadMessages,

    // ============================================================================
    // Export (from useSessionExport)
    // ============================================================================
    isExporting: exportComposable.isExporting,
    exportError: exportComposable.exportError,
    exportSession: exportComposable.exportSession,
    exportAsMarkdown: exportComposable.exportAsMarkdown,
    exportAsHtml: exportComposable.exportAsHtml,
    exportAsTxt: exportComposable.exportAsTxt,
    downloadExport: exportComposable.downloadExport,
    exportAndDownload: exportComposable.exportAndDownload,

    // ============================================================================
    // Utility
    // ============================================================================
    showProviderSelector
  }
}

export type UseAgenticSessionStoreReturn = ReturnType<typeof useAgenticSessionStore>
