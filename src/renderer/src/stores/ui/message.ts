import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose, getCurrentScope, isRef, toRef, type Ref } from 'vue'
import { createSessionClient } from '../../../api/SessionClient'
import type {
  DisplayAssistantMessageBlock,
  DisplayUserMessageContent
} from '@/components/chat/messageListItems'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile,
  MessagePageCursor,
  MessageMetadata,
  SessionWithState
} from '@shared/types/agent-interface'
import { useStreamStateStore } from './stream'
import { bindMessageStoreIpc } from './messageIpc'

const EPHEMERAL_STREAM_MESSAGE_PREFIXES = ['__rate_limit__:']

function toStoreStateRef<T extends object, K extends keyof T>(store: T, key: K): Ref<any> {
  const value = store[key]
  return isRef(value) ? value : toRef(store, key)
}

type ParsedMessageCacheEntry = {
  updatedAt: number
  content: string
  metadata: string
  assistantBlocks?: DisplayAssistantMessageBlock[]
  userContent?: DisplayUserMessageContent
  parsedMetadata?: MessageMetadata
}

// --- Store ---

export const useMessageStore = defineStore('message', () => {
  const sessionClient = createSessionClient()
  const streamStateStore = useStreamStateStore()
  const isStreaming = toStoreStateRef(streamStateStore, 'isStreaming')
  const streamingBlocks = toStoreStateRef(streamStateStore, 'streamingBlocks')
  const currentStreamMessageId = toStoreStateRef(streamStateStore, 'currentStreamMessageId')
  const streamRevision = toStoreStateRef(streamStateStore, 'streamRevision')

  // --- State ---
  const messageIds = ref<string[]>([])
  const messageCache = ref<Map<string, ChatMessageRecord>>(new Map())
  const lastPersistedRevision = ref(0)
  const currentSessionId = ref<string | null>(null)
  const nextCursor = ref<MessagePageCursor | null>(null)
  const hasMoreHistory = ref(false)
  const isLoadingHistory = ref(false)
  const parsedMessageCache = new Map<string, ParsedMessageCacheEntry>()
  const hydratingStreamMessageIds = new Set<string>()
  let latestLoadRequestId = 0
  let latestHistoryRequestId = 0

  // --- Getters ---
  const messages = computed(() => {
    return messageIds.value
      .map((id) => messageCache.value.get(id))
      .filter((m): m is ChatMessageRecord => m !== undefined)
  })

  // --- Actions ---

  function upsertMessageRecord(record: ChatMessageRecord): void {
    messageCache.value.set(record.id, record)
    if (!messageIds.value.includes(record.id)) {
      messageIds.value.push(record.id)
      messageIds.value.sort((a, b) => {
        const aSeq = messageCache.value.get(a)?.orderSeq ?? Number.MAX_SAFE_INTEGER
        const bSeq = messageCache.value.get(b)?.orderSeq ?? Number.MAX_SAFE_INTEGER
        return aSeq - bSeq
      })
    }
  }

  function getParsedEntry(record: ChatMessageRecord) {
    const cached = parsedMessageCache.get(record.id)
    if (cached) {
      if (cached.content !== record.content) {
        cached.content = record.content
        delete cached.assistantBlocks
        delete cached.userContent
      }

      if (cached.metadata !== record.metadata) {
        cached.metadata = record.metadata
        delete cached.parsedMetadata
      }

      cached.updatedAt = record.updatedAt
      return cached
    }

    const nextEntry: ParsedMessageCacheEntry = {
      updatedAt: record.updatedAt,
      content: record.content,
      metadata: record.metadata
    }
    parsedMessageCache.set(record.id, nextEntry)
    return nextEntry
  }

  function getAssistantMessageBlocks(record: ChatMessageRecord): DisplayAssistantMessageBlock[] {
    const entry = getParsedEntry(record)
    if (entry.assistantBlocks) {
      return entry.assistantBlocks
    }

    try {
      const parsed = JSON.parse(record.content) as DisplayAssistantMessageBlock[]
      entry.assistantBlocks = Array.isArray(parsed) ? parsed : []
    } catch {
      entry.assistantBlocks = []
    }

    return entry.assistantBlocks
  }

  function getUserMessageContent(record: ChatMessageRecord): DisplayUserMessageContent {
    const entry = getParsedEntry(record)
    if (entry.userContent) {
      return entry.userContent
    }

    try {
      const parsed = JSON.parse(record.content) as DisplayUserMessageContent
      if (parsed && typeof parsed === 'object') {
        entry.userContent = {
          text: parsed.text ?? '',
          files: parsed.files ?? [],
          links: parsed.links ?? [],
          search: parsed.search ?? false,
          think: parsed.think ?? false,
          continue: parsed.continue,
          resources: parsed.resources,
          prompts: parsed.prompts,
          content: parsed.content
        }
        return entry.userContent
      }
    } catch {}

    entry.userContent = {
      text: '',
      files: [],
      links: [],
      search: false,
      think: false
    }
    return entry.userContent
  }

  function getMessageMetadata(record: ChatMessageRecord): MessageMetadata {
    const entry = getParsedEntry(record)
    if (entry.parsedMetadata) {
      return entry.parsedMetadata
    }

    try {
      const parsed = JSON.parse(record.metadata) as MessageMetadata
      entry.parsedMetadata = parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      entry.parsedMetadata = {}
    }

    return entry.parsedMetadata
  }

  function setCurrentSessionId(sessionId: string | null): void {
    currentSessionId.value = sessionId
  }

  function isCurrentLoadRequest(requestId: number, sessionId: string): boolean {
    return requestId === latestLoadRequestId && currentSessionId.value === sessionId
  }

  function isCurrentHistoryRequest(requestId: number, sessionId: string): boolean {
    return requestId === latestHistoryRequestId && currentSessionId.value === sessionId
  }

  async function restoreMessageWindow(
    sessionId: string,
    desiredCount: number,
    requestId: number
  ): Promise<Awaited<ReturnType<typeof sessionClient.restore>> | null> {
    const initialLimit = Math.min(Math.max(desiredCount, 100), 500)
    const restored = await sessionClient.restore(sessionId, initialLimit)
    if (!isCurrentLoadRequest(requestId, sessionId)) {
      return null
    }

    if (!restored.hasMore || !restored.nextCursor || restored.messages.length >= desiredCount) {
      return restored
    }

    const seenIds = new Set(restored.messages.map((message) => message.id))
    let messages = restored.messages
    let nextCursorValue: { orderSeq: number; id: string } | null = restored.nextCursor
    let hasMoreValue: boolean = restored.hasMore

    while (messages.length < desiredCount && hasMoreValue && nextCursorValue) {
      const page = await sessionClient.listMessagesPage(sessionId, {
        cursor: nextCursorValue,
        limit: Math.min(Math.max(desiredCount - messages.length, 1), 500)
      })
      if (!isCurrentLoadRequest(requestId, sessionId)) {
        return null
      }

      const uniqueMessages = page.messages.filter((message) => {
        if (seenIds.has(message.id)) {
          return false
        }
        seenIds.add(message.id)
        return true
      })

      if (uniqueMessages.length > 0) {
        messages = [...uniqueMessages, ...messages]
      }

      nextCursorValue = page.nextCursor
      hasMoreValue = page.hasMore

      if (page.messages.length === 0) {
        break
      }
    }

    return {
      session: restored.session,
      messages,
      nextCursor: nextCursorValue,
      hasMore: hasMoreValue
    }
  }

  async function loadMessages(sessionId: string): Promise<SessionWithState | null> {
    const desiredCount =
      currentSessionId.value === sessionId ? Math.max(messageIds.value.length, 100) : 100
    const requestId = ++latestLoadRequestId
    latestHistoryRequestId += 1
    setCurrentSessionId(sessionId)
    isLoadingHistory.value = false
    try {
      const restored = await restoreMessageWindow(sessionId, desiredCount, requestId)
      if (!restored) {
        return null
      }
      const result = restored.messages
      if (!isCurrentLoadRequest(requestId, sessionId)) {
        return null
      }

      const nextMessageCache = new Map<string, ChatMessageRecord>()
      const nextMessageIds: string[] = []
      for (const msg of result) {
        nextMessageCache.set(msg.id, msg)
        nextMessageIds.push(msg.id)
      }

      parsedMessageCache.clear()
      messageCache.value = nextMessageCache
      messageIds.value = nextMessageIds
      nextCursor.value = restored.nextCursor
      hasMoreHistory.value = restored.hasMore
      lastPersistedRevision.value += 1
      return restored.session
    } catch (e) {
      console.error('Failed to load messages:', e)
      return null
    }
  }

  async function loadOlderMessages(): Promise<number> {
    if (!currentSessionId.value || !hasMoreHistory.value || isLoadingHistory.value) {
      return 0
    }

    const sessionId = currentSessionId.value
    const requestId = ++latestHistoryRequestId
    isLoadingHistory.value = true
    try {
      const page = await sessionClient.listMessagesPage(sessionId, {
        cursor: nextCursor.value,
        limit: 100
      })
      if (!isCurrentHistoryRequest(requestId, sessionId)) {
        return 0
      }
      const incomingIds: string[] = []
      for (const msg of page.messages) {
        messageCache.value.set(msg.id, msg)
        incomingIds.push(msg.id)
      }

      if (incomingIds.length > 0) {
        const existingIds = new Set(messageIds.value)
        messageIds.value = [
          ...incomingIds.filter((id) => !existingIds.has(id)),
          ...messageIds.value
        ]
      }

      nextCursor.value = page.nextCursor
      hasMoreHistory.value = page.hasMore
      if (incomingIds.length > 0) {
        lastPersistedRevision.value += 1
      }
      return incomingIds.length
    } catch (error) {
      console.error('Failed to load older messages:', error)
      return 0
    } finally {
      if (isCurrentHistoryRequest(requestId, sessionId)) {
        isLoadingHistory.value = false
      }
    }
  }

  async function getMessage(id: string): Promise<ChatMessageRecord | null> {
    const cached = messageCache.value.get(id)
    if (cached) return cached

    return null
  }

  /**
   * Add an optimistic user message to the local store so it appears immediately
   * in the UI without waiting for a backend round-trip or stream completion.
   * The optimistic record is replaced with the real DB record when loadMessages
   * is called at stream end.
   */
  function addOptimisticUserMessage(
    sessionId: string,
    text: string,
    files: MessageFile[] = []
  ): void {
    const id = `__optimistic_user_${Date.now()}`
    const record: ChatMessageRecord = {
      id,
      sessionId,
      orderSeq: messageIds.value.length + 1,
      role: 'user',
      content: JSON.stringify({ text, files, links: [], search: false, think: false }),
      status: 'sent',
      isContextEdge: 0,
      metadata: '{}',
      traceCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    messageCache.value.set(id, record)
    messageIds.value.push(id)
  }

  function clear(): void {
    latestLoadRequestId += 1
    latestHistoryRequestId += 1
    setCurrentSessionId(null)
    messageIds.value = []
    messageCache.value.clear()
    nextCursor.value = null
    hasMoreHistory.value = false
    isLoadingHistory.value = false
    parsedMessageCache.clear()
    clearStreamingState()
    hydratingStreamMessageIds.clear()
  }

  function clearStreamingState(): void {
    streamStateStore.clearStreamingState()
  }

  function isEphemeralStreamMessageId(messageId: string): boolean {
    return EPHEMERAL_STREAM_MESSAGE_PREFIXES.some((prefix) => messageId.startsWith(prefix))
  }

  function applyStreamingBlocksToMessage(
    messageId: string,
    conversationId: string,
    blocks: AssistantMessageBlock[]
  ): void {
    const serializedBlocks = JSON.stringify(blocks)
    const existing = messageCache.value.get(messageId)
    if (existing) {
      if (existing.sessionId !== conversationId) return
      if (existing.content === serializedBlocks && existing.status === 'pending') {
        return
      }
      upsertMessageRecord({
        ...existing,
        content: serializedBlocks,
        status: 'pending',
        updatedAt: Date.now()
      })
      return
    }

    if (hydratingStreamMessageIds.has(messageId)) return
    hydratingStreamMessageIds.add(messageId)
    upsertMessageRecord({
      id: messageId,
      sessionId: conversationId,
      orderSeq: messageIds.value.length + 1,
      role: 'assistant',
      content: serializedBlocks,
      status: 'pending',
      isContextEdge: 0,
      metadata: '{}',
      traceCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    hydratingStreamMessageIds.delete(messageId)
  }

  const cleanupIpcBindings = bindMessageStoreIpc({
    getActiveSessionId: () => currentSessionId.value,
    setStreamingState: ({ sessionId, messageId, blocks }) => {
      streamStateStore.setStream(sessionId, blocks, messageId)
    },
    clearStreamingState,
    loadMessages,
    applyStreamingBlocksToMessage,
    isEphemeralStreamMessageId
  })
  registerStoreCleanup(cleanupIpcBindings)

  return {
    messageIds,
    messageCache,
    isStreaming,
    streamingBlocks,
    currentStreamMessageId,
    streamRevision,
    lastPersistedRevision,
    nextCursor,
    hasMoreHistory,
    isLoadingHistory,
    messages,
    getAssistantMessageBlocks,
    getUserMessageContent,
    getMessageMetadata,
    setCurrentSessionId,
    loadMessages,
    loadOlderMessages,
    getMessage,
    addOptimisticUserMessage,
    clearStreamingState,
    clear
  }
})
const registerStoreCleanup = (cleanup: () => void) => {
  if (getCurrentScope()) {
    onScopeDispose(cleanup)
  }
}
