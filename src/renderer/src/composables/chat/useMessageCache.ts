import { type Ref } from 'vue'
import type { AssistantMessage, UserMessage, Message } from '@shared/chat'
import { usePresenter } from '@/composables/usePresenter'
import {
  cacheMessage,
  cacheMessages,
  getCachedMessage,
  hasCachedMessage,
  setMessageDomInfo,
  getMessageDomInfo
} from '@/lib/messageRuntimeCache'

/**
 * Message cache composable
 * Handles unified message caching, prefetching, and DOM tracking
 */
export function useMessageCache(
  messageIds: Ref<string[]>,
  messageCacheVersion: Ref<number>,
  setMessageIds: (ids: string[]) => void,
  enrichMessageWithExtra: (message: Message) => Promise<Message>
) {
  const threadP = usePresenter('sessionPresenter')

  const PREFETCH_BUFFER = 24
  const PREFETCH_BATCH_SIZE = 80

  /**
   * Bump the message cache version to trigger reactivity
   */
  const bumpMessageCacheVersion = () => {
    messageCacheVersion.value += 1
  }

  /**
   * Ensure a message ID is in the message IDs list
   * @param messageId Message ID to ensure
   */
  const ensureMessageId = (messageId: string) => {
    if (!messageId) return
    const ids = messageIds.value
    if (ids.includes(messageId)) return
    setMessageIds([...ids, messageId])
  }

  /**
   * Get all loaded messages from cache
   * @returns Array of loaded messages
   */
  const getLoadedMessages = () => {
    const ids = messageIds.value
    const messages: Message[] = []
    for (const messageId of ids) {
      const message = getCachedMessage(messageId)
      if (message) {
        messages.push(message)
      }
    }
    return messages
  }

  /**
   * Cache a single message and bump version
   * @param message Message to cache
   */
  const cacheMessageForView = (message: Message) => {
    cacheMessage(message)
    bumpMessageCacheVersion()
  }

  /**
   * Cache multiple messages and bump version
   * @param messages Messages to cache
   */
  const cacheMessagesForView = (messages: Message[]) => {
    if (messages.length === 0) return
    cacheMessages(messages)
    bumpMessageCacheVersion()
  }

  /**
   * Find main assistant message by parent ID
   * @param parentId Parent message ID
   * @returns Assistant message or null
   */
  const findMainAssistantMessageByParentId = (parentId: string) => {
    if (!parentId) return null
    const ids = messageIds.value
    for (const messageId of ids) {
      const message = getCachedMessage(messageId)
      if (
        message &&
        message.role === 'assistant' &&
        !message.is_variant &&
        message.parentId === parentId
      ) {
        return message as AssistantMessage
      }
    }
    return null
  }

  /**
   * Fetch messages by IDs in batches
   * @param messageIds Array of message IDs to fetch
   */
  const fetchMessagesByIds = async (messageIds: string[]) => {
    if (!messageIds.length) return
    for (let i = 0; i < messageIds.length; i += PREFETCH_BATCH_SIZE) {
      const chunk = messageIds.slice(i, i + PREFETCH_BATCH_SIZE)
      const messages = await threadP.getMessagesByIds(chunk)
      const enriched = (await Promise.all(messages.map((msg) => enrichMessageWithExtra(msg)))) as
        | AssistantMessage[]
        | UserMessage[]
      cacheMessagesForView(enriched as Message[])
    }
  }

  /**
   * Ensure messages are loaded by IDs
   * @param messageIds Array of message IDs to ensure are loaded
   */
  const ensureMessagesLoadedByIds = async (messageIds: string[]) => {
    const missing = messageIds.filter((messageId) => !hasCachedMessage(messageId))
    if (!missing.length) return
    await fetchMessagesByIds(missing)
  }

  /**
   * Prefetch messages for a range with buffer
   * @param startIndex Start index
   * @param endIndex End index
   */
  const prefetchMessagesForRange = async (startIndex: number, endIndex: number) => {
    const ids = messageIds.value
    if (!ids.length) return
    const safeStart = Math.max(0, startIndex - PREFETCH_BUFFER)
    const safeEnd = Math.min(ids.length, endIndex + PREFETCH_BUFFER + 1)
    const targetIds = ids.slice(safeStart, safeEnd)
    await ensureMessagesLoadedByIds(targetIds)
  }

  /**
   * Prefetch all messages for the current thread
   */
  const prefetchAllMessages = async () => {
    const ids = messageIds.value
    if (!ids.length) return
    await ensureMessagesLoadedByIds(ids)
  }

  /**
   * Record message DOM information
   * @param entries Array of DOM info entries
   */
  const recordMessageDomInfo = (entries: Array<{ id: string; top: number; height: number }>) => {
    setMessageDomInfo(entries)
  }

  /**
   * Check if message has DOM info
   * @param messageId Message ID to check
   * @returns True if DOM info exists
   */
  const hasMessageDomInfo = (messageId: string) => {
    return Boolean(getMessageDomInfo(messageId))
  }

  return {
    // Cache management
    ensureMessageId,
    getLoadedMessages,
    cacheMessageForView,
    cacheMessagesForView,
    findMainAssistantMessageByParentId,

    // Prefetching
    fetchMessagesByIds,
    ensureMessagesLoadedByIds,
    prefetchMessagesForRange,
    prefetchAllMessages,

    // DOM tracking
    recordMessageDomInfo,
    hasMessageDomInfo
  }
}
