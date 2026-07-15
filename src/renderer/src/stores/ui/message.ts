import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose, getCurrentScope, isRef, toRef, type Ref } from 'vue'
import { createSessionClient } from '../../../api/SessionClient'
import type {
  DisplayAssistantMessageBlock,
  DisplayUserMessageContent
} from '@/components/chat/messageListItems'
import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  MessageFile,
  MessagePageCursor,
  MessageMetadata,
  SendMessageInput,
  SessionWithState
} from '@shared/types/agent-interface'
import { useStreamStateStore } from './stream'
import { bindMessageStoreIpc } from './messageIpc'
import { RecentMessageViewCache, type RecentMessageView } from './recentMessageViewCache'

const EPHEMERAL_STREAM_MESSAGE_PREFIXES = ['__rate_limit__:']
const PARSED_MESSAGE_CACHE_MAX_SIZE = 1024

function toStoreStateRef<T extends object, K extends keyof T>(store: T, key: K): Ref<any> {
  const value = store[key]
  return isRef(value) ? value : toRef(store, key)
}

type ParsedMessageCacheEntry = {
  updatedAt: number
  content: string
  metadata: string
  assistantBlocks?: DisplayAssistantMessageBlock[]
  prevAssistantBlocks?: DisplayAssistantMessageBlock[]
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
  // Active selection may change before its message view is prepared. Keep the
  // committed owner separate so old and target-session records never mix.
  const currentSessionId = ref<string | null>(null)
  const committedSessionId = ref<string | null>(null)
  const nextCursor = ref<MessagePageCursor | null>(null)
  const hasMoreHistory = ref(false)
  const isLoadingHistory = ref(false)
  const parsedMessageCache = new Map<string, ParsedMessageCacheEntry>()
  const recentSessionViews = new RecentMessageViewCache()
  // Stream message ids currently being hydrated into the cache as a placeholder
  // record (before the backend persists them). Prevents re-entrant duplicate inserts.
  const hydratingStreamMessageIds = new Set<string>()
  let latestLoadRequestId = 0
  let latestHistoryRequestId = 0
  let latestLoadSessionId: string | null = null
  let currentSessionSummary: SessionWithState | null = null

  // --- Getters ---
  const messages = computed(() => {
    return messageIds.value
      .map((id) => messageCache.value.get(id))
      .filter((m): m is ChatMessageRecord => m !== undefined)
  })

  // --- Actions ---

  function compareMessageIds(left: string, right: string): number {
    if (left === right) return 0
    return left < right ? -1 : 1
  }

  function sortMessageIdsByOrderSeq(): void {
    messageIds.value.sort((a, b) => {
      const aSeq = messageCache.value.get(a)?.orderSeq ?? Number.MAX_SAFE_INTEGER
      const bSeq = messageCache.value.get(b)?.orderSeq ?? Number.MAX_SAFE_INTEGER
      if (aSeq !== bSeq) {
        return aSeq - bSeq
      }
      return compareMessageIds(a, b)
    })
  }

  function isMessageIdsSortedByOrderSeq(): boolean {
    let previousSeq = Number.NEGATIVE_INFINITY
    let previousId = ''

    for (const id of messageIds.value) {
      const seq = messageCache.value.get(id)?.orderSeq
      if (!Number.isFinite(seq)) return false

      if (seq! < previousSeq) return false
      if (seq === previousSeq && compareMessageIds(previousId, id) > 0) return false

      previousSeq = seq!
      previousId = id
    }

    return true
  }

  function findInsertIndexByOrderSeq(orderSeq: number, id: string): number {
    let left = 0
    let right = messageIds.value.length

    while (left < right) {
      const mid = (left + right) >> 1
      const midId = messageIds.value[mid]
      const midSeq = messageCache.value.get(midId)?.orderSeq ?? Number.MAX_SAFE_INTEGER

      if (midSeq < orderSeq) {
        left = mid + 1
        continue
      }
      if (midSeq > orderSeq) {
        right = mid
        continue
      }

      if (compareMessageIds(midId, id) <= 0) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    return left
  }

  function upsertMessageRecord(record: ChatMessageRecord): void {
    const cachedRecord = messageCache.value.get(record.id)
    const hasMessageId = cachedRecord !== undefined

    messageCache.value.set(record.id, record)
    if (hasMessageId) {
      if (cachedRecord?.orderSeq !== record.orderSeq) {
        sortMessageIdsByOrderSeq()
      }
      return
    }

    if (Number.isFinite(record.orderSeq) && isMessageIdsSortedByOrderSeq()) {
      messageIds.value.splice(findInsertIndexByOrderSeq(record.orderSeq, record.id), 0, record.id)
      return
    }

    messageIds.value.push(record.id)
    sortMessageIdsByOrderSeq()
  }

  function setParsedEntry(recordId: string, entry: ParsedMessageCacheEntry): void {
    parsedMessageCache.set(recordId, entry)
    if (parsedMessageCache.size > PARSED_MESSAGE_CACHE_MAX_SIZE) {
      const oldestKey = parsedMessageCache.keys().next().value
      if (oldestKey) {
        parsedMessageCache.delete(oldestKey)
      }
    }
  }

  function getParsedEntry(record: ChatMessageRecord) {
    const cached = parsedMessageCache.get(record.id)
    if (cached) {
      parsedMessageCache.delete(record.id)
      setParsedEntry(record.id, cached)

      if (cached.content !== record.content) {
        cached.content = record.content
        cached.prevAssistantBlocks = cached.assistantBlocks
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
    setParsedEntry(record.id, nextEntry)
    return nextEntry
  }

  function structuralArrayEqual(previous: unknown[], next: unknown[]): boolean {
    if (previous.length !== next.length) return false
    return previous.every((previousValue, index) =>
      structuralPayloadValueEqual(previousValue, next[index])
    )
  }

  function structuralRecordEqual(
    previous: Record<string, unknown>,
    next: Record<string, unknown>
  ): boolean {
    const previousKeys = Object.keys(previous)
    const nextKeys = Object.keys(next)
    if (previousKeys.length !== nextKeys.length) return false

    return previousKeys.every(
      (key) => Object.hasOwn(next, key) && structuralPayloadValueEqual(previous[key], next[key])
    )
  }

  function structuralPayloadValueEqual(previous: unknown, next: unknown): boolean {
    if (Object.is(previous, next)) return true
    if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return false
    if (Array.isArray(previous) || Array.isArray(next)) {
      return Array.isArray(previous) && Array.isArray(next) && structuralArrayEqual(previous, next)
    }
    return structuralRecordEqual(
      previous as Record<string, unknown>,
      next as Record<string, unknown>
    )
  }

  function toolCallPayloadEqual(
    previous: DisplayAssistantMessageBlock['tool_call'],
    next: DisplayAssistantMessageBlock['tool_call']
  ): boolean {
    if (previous === next) return true
    if (!previous || !next) return false
    return (
      previous.id === next.id &&
      previous.name === next.name &&
      previous.params === next.params &&
      previous.response === next.response &&
      previous.rtkApplied === next.rtkApplied &&
      previous.rtkMode === next.rtkMode &&
      previous.rtkFallbackReason === next.rtkFallbackReason &&
      previous.server_name === next.server_name &&
      previous.server_icons === next.server_icons &&
      previous.server_description === next.server_description &&
      structuralPayloadValueEqual(previous.imagePreviews, next.imagePreviews)
    )
  }

  function artifactPayloadEqual(
    previous: DisplayAssistantMessageBlock['artifact'],
    next: DisplayAssistantMessageBlock['artifact']
  ): boolean {
    if (previous === next) return true
    if (!previous || !next) return false
    return (
      previous.identifier === next.identifier &&
      previous.title === next.title &&
      previous.type === next.type &&
      previous.language === next.language
    )
  }

  function imageDataPayloadEqual(
    previous: DisplayAssistantMessageBlock['image_data'],
    next: DisplayAssistantMessageBlock['image_data']
  ): boolean {
    if (previous === next) return true
    if (!previous || !next) return false
    return previous.data === next.data && previous.mimeType === next.mimeType
  }

  function reasoningTimePayloadEqual(
    previous: DisplayAssistantMessageBlock['reasoning_time'],
    next: DisplayAssistantMessageBlock['reasoning_time']
  ): boolean {
    if (previous === next) return true
    if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return false
    return previous.start === next.start && previous.end === next.end
  }

  // Mutable payload fields a stable-status block can still change between
  // re-parses (e.g. folded streaming updates to extra.subagentProgress or a
  // tool_call response). Identity alone is not enough to safely reuse the old
  // object; the payload must be unchanged too, otherwise the UI freezes.
  function assistantBlockPayloadEqual(
    previous: DisplayAssistantMessageBlock,
    next: DisplayAssistantMessageBlock
  ): boolean {
    return (
      previous.content === next.content &&
      previous.action_type === next.action_type &&
      structuralPayloadValueEqual(previous.extra, next.extra) &&
      toolCallPayloadEqual(previous.tool_call, next.tool_call) &&
      artifactPayloadEqual(previous.artifact, next.artifact) &&
      imageDataPayloadEqual(previous.image_data, next.image_data) &&
      reasoningTimePayloadEqual(previous.reasoning_time, next.reasoning_time)
    )
  }

  function isReusableStableAssistantBlock(
    previous: DisplayAssistantMessageBlock | undefined,
    next: DisplayAssistantMessageBlock,
    index: number,
    blocksLength: number
  ): previous is DisplayAssistantMessageBlock {
    if (!previous || index === blocksLength - 1) {
      return false
    }

    if (
      previous.status !== next.status ||
      previous.status === 'pending' ||
      previous.status === 'loading'
    ) {
      return false
    }

    if (previous.type !== next.type || previous.timestamp !== next.timestamp) {
      return false
    }

    if (previous.id || next.id) {
      if (previous.id !== next.id) return false
      return assistantBlockPayloadEqual(previous, next)
    }

    if (previous.tool_call?.id || next.tool_call?.id) {
      if (previous.tool_call?.id !== next.tool_call?.id) return false
      return assistantBlockPayloadEqual(previous, next)
    }

    return assistantBlockPayloadEqual(previous, next)
  }

  function reuseStableAssistantBlocks(
    blocks: DisplayAssistantMessageBlock[],
    previousBlocks?: DisplayAssistantMessageBlock[]
  ): DisplayAssistantMessageBlock[] {
    if (!previousBlocks?.length || blocks.length === 0) {
      return blocks
    }

    return blocks.map((block, index) =>
      isReusableStableAssistantBlock(previousBlocks[index], block, index, blocks.length)
        ? previousBlocks[index]
        : block
    )
  }

  function getAssistantMessageBlocks(record: ChatMessageRecord): DisplayAssistantMessageBlock[] {
    const entry = getParsedEntry(record)
    if (entry.assistantBlocks) {
      return entry.assistantBlocks
    }

    try {
      const parsed = JSON.parse(record.content) as DisplayAssistantMessageBlock[]
      const blocks = Array.isArray(parsed) ? parsed : []
      entry.assistantBlocks = reuseStableAssistantBlocks(blocks, entry.prevAssistantBlocks)
    } catch {
      entry.assistantBlocks = []
    }

    entry.prevAssistantBlocks = entry.assistantBlocks
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
          activeSkills: Array.isArray(parsed.activeSkills) ? parsed.activeSkills : [],
          inlineItems: Array.isArray(parsed.inlineItems) ? parsed.inlineItems : [],
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
      think: false,
      activeSkills: [],
      inlineItems: []
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
    if (sessionId && committedSessionId.value === null && messageIds.value.length === 0) {
      committedSessionId.value = sessionId
    }
  }

  function isCurrentLoadRequest(requestId: number, sessionId: string): boolean {
    return (
      requestId === latestLoadRequestId &&
      latestLoadSessionId === sessionId &&
      currentSessionId.value === sessionId
    )
  }

  function isCurrentHistoryRequest(requestId: number, sessionId: string): boolean {
    return (
      requestId === latestHistoryRequestId &&
      currentSessionId.value === sessionId &&
      committedSessionId.value === sessionId
    )
  }

  function cacheCurrentSessionView(): void {
    const sessionId = committedSessionId.value
    if (!sessionId) return
    recentSessionViews.set({
      sessionId,
      session: currentSessionSummary,
      messageIds: messageIds.value,
      messageCache: messageCache.value,
      nextCursor: nextCursor.value,
      hasMoreHistory: hasMoreHistory.value,
      revision: lastPersistedRevision.value
    })
  }

  function commitSessionView(view: RecentMessageView): void {
    if (committedSessionId.value && committedSessionId.value !== view.sessionId) {
      cacheCurrentSessionView()
    }

    recentSessionViews.delete(view.sessionId)
    currentSessionSummary = view.session
    setCurrentSessionId(view.sessionId)
    committedSessionId.value = view.sessionId
    hydratingStreamMessageIds.clear()
    messageCache.value = new Map(view.messageCache)
    messageIds.value = [...view.messageIds]
    nextCursor.value = view.nextCursor
    hasMoreHistory.value = view.hasMoreHistory
    isLoadingHistory.value = false
    lastPersistedRevision.value += 1
  }

  function activateRecentSessionView(sessionId: string): boolean {
    latestLoadRequestId += 1
    latestHistoryRequestId += 1
    latestLoadSessionId = null
    isLoadingHistory.value = false
    const cachedView = recentSessionViews.get(sessionId)
    if (!cachedView) return false
    commitSessionView(cachedView)
    return true
  }

  async function restoreMessageWindow(
    sessionId: string,
    desiredCount: number,
    requestId: number
  ): Promise<Awaited<ReturnType<typeof sessionClient.restore>> | null> {
    const initialLimit = Math.min(Math.max(desiredCount, 40), 500)
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

  async function loadMessages(
    sessionId: string,
    desiredCountOverride?: number
  ): Promise<SessionWithState | null> {
    const desiredCount =
      desiredCountOverride ??
      (committedSessionId.value === sessionId ? Math.max(messageIds.value.length, 100) : 100)
    const requestId = ++latestLoadRequestId
    latestHistoryRequestId += 1
    latestLoadSessionId = sessionId
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

      commitSessionView({
        sessionId,
        session: restored.session,
        messageIds: nextMessageIds,
        messageCache: nextMessageCache,
        nextCursor: restored.nextCursor,
        hasMoreHistory: restored.hasMore,
        revision: lastPersistedRevision.value + 1
      })
      if (isCurrentLoadRequest(requestId, sessionId)) {
        latestLoadSessionId = null
      }
      return restored.session
    } catch (e) {
      console.error('Failed to load messages:', e)
      return null
    }
  }

  async function loadOlderMessages(): Promise<number> {
    if (
      !committedSessionId.value ||
      currentSessionId.value !== committedSessionId.value ||
      !hasMoreHistory.value ||
      isLoadingHistory.value
    ) {
      return 0
    }

    const sessionId = committedSessionId.value
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
    input: string | SendMessageInput,
    files: MessageFile[] = []
  ): string {
    const normalizedInput = typeof input === 'string' ? { text: input, files } : input
    const id = `__optimistic_user_${Date.now()}_${messageIds.value.length + 1}`
    const record: ChatMessageRecord = {
      id,
      sessionId,
      orderSeq: messageIds.value.length + 1,
      role: 'user',
      content: JSON.stringify({
        text: normalizedInput.text,
        files: normalizedInput.files ?? [],
        links: [],
        search: false,
        think: false,
        activeSkills: normalizedInput.activeSkills ?? [],
        inlineItems: normalizedInput.inlineItems ?? []
      }),
      status: 'sent',
      isContextEdge: 0,
      metadata: '{}',
      traceCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    messageCache.value.set(id, record)
    messageIds.value.push(id)
    return id
  }

  function removeOptimisticMessage(id: string): void {
    if (!id.startsWith('__optimistic_')) return
    messageCache.value.delete(id)
    messageIds.value = messageIds.value.filter((messageId) => messageId !== id)
    parsedMessageCache.delete(id)
  }

  function clear(): void {
    latestLoadRequestId += 1
    latestHistoryRequestId += 1
    latestLoadSessionId = null
    setCurrentSessionId(null)
    committedSessionId.value = null
    currentSessionSummary = null
    messageIds.value = []
    messageCache.value.clear()
    nextCursor.value = null
    hasMoreHistory.value = false
    isLoadingHistory.value = false
    parsedMessageCache.clear()
    hydratingStreamMessageIds.clear()
    recentSessionViews.clear()
    clearStreamingState()
  }

  function clearStreamingState(): void {
    streamStateStore.clearStreamingState()
  }

  function isEphemeralStreamMessageId(messageId: string): boolean {
    return EPHEMERAL_STREAM_MESSAGE_PREFIXES.some((prefix) => messageId.startsWith(prefix))
  }

  /**
   * Fold live streaming blocks into the persisted message record in place, so the
   * generating message and the finished message are the SAME list item (same id,
   * same DOM node). This removes the "streaming row vs persisted row" duality:
   * stream-end just stops mutating the record, no node swap, no blank flash.
   */
  function applyStreamingBlocksToMessage(
    messageId: string,
    conversationId: string,
    blocks: AssistantMessageBlock[],
    metadata?: { providerId?: string; modelId?: string }
  ): void {
    if (committedSessionId.value !== conversationId) return
    const serializedBlocks = JSON.stringify(blocks)
    const serializedMetadata = JSON.stringify({
      ...(metadata?.providerId ? { provider: metadata.providerId } : {}),
      ...(metadata?.modelId ? { model: metadata.modelId } : {})
    })
    const existing = messageCache.value.get(messageId)
    if (existing) {
      if (existing.sessionId !== conversationId) return
      const nextMetadata = serializedMetadata === '{}' ? existing.metadata : serializedMetadata
      if (
        existing.content === serializedBlocks &&
        existing.status === 'pending' &&
        existing.metadata === nextMetadata
      ) {
        return
      }
      upsertMessageRecord({
        ...existing,
        content: serializedBlocks,
        metadata: nextMetadata,
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
      metadata: serializedMetadata,
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
    currentSessionId,
    committedSessionId,
    nextCursor,
    hasMoreHistory,
    isLoadingHistory,
    messages,
    getAssistantMessageBlocks,
    getUserMessageContent,
    getMessageMetadata,
    setCurrentSessionId,
    activateRecentSessionView,
    loadMessages,
    loadOlderMessages,
    getMessage,
    addOptimisticUserMessage,
    removeOptimisticMessage,
    clearStreamingState,
    clear
  }
})
const registerStoreCleanup = (cleanup: () => void) => {
  if (getCurrentScope()) {
    onScopeDispose(cleanup)
  }
}
