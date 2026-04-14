import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose, getCurrentScope } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type {
  DisplayAssistantMessageBlock,
  DisplayUserMessageContent
} from '@/components/chat/messageListItems'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile,
  MessageMetadata
} from '@shared/types/agent-interface'
import { useSessionStore } from './session'
import { useStreamStateStore } from './stream'
import { bindMessageStoreIpc } from './messageIpc'

const EPHEMERAL_STREAM_MESSAGE_PREFIXES = ['__rate_limit__:']

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
  const agentSessionPresenter = usePresenter('agentSessionPresenter')
  const streamStateStore = useStreamStateStore()

  // --- State ---
  const messageIds = ref<string[]>([])
  const messageCache = ref<Map<string, ChatMessageRecord>>(new Map())
  const lastPersistedRevision = ref(0)
  const parsedMessageCache = new Map<string, ParsedMessageCacheEntry>()
  const hydratingStreamMessageIds = new Set<string>()
  let latestLoadRequestId = 0

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

  async function loadMessages(sessionId: string): Promise<void> {
    const requestId = ++latestLoadRequestId
    try {
      const result = await agentSessionPresenter.getMessages(sessionId)
      if (requestId !== latestLoadRequestId) {
        return
      }

      messageCache.value.clear()
      parsedMessageCache.clear()
      messageIds.value = []
      for (const msg of result) {
        messageCache.value.set(msg.id, msg)
        messageIds.value.push(msg.id)
      }
      lastPersistedRevision.value += 1
    } catch (e) {
      console.error('Failed to load messages:', e)
    }
  }

  async function getMessage(id: string): Promise<ChatMessageRecord | null> {
    const cached = messageCache.value.get(id)
    if (cached) return cached

    try {
      const msg = await agentSessionPresenter.getMessage(id)
      if (msg) {
        messageCache.value.set(msg.id, msg)
      }
      return msg
    } catch (e) {
      console.error('Failed to get message:', e)
      return null
    }
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
    messageIds.value = []
    messageCache.value.clear()
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

    void agentSessionPresenter
      .getMessage(messageId)
      .then((fetched) => {
        if (!fetched || fetched.sessionId !== conversationId) return
        upsertMessageRecord({
          ...fetched,
          content: serializedBlocks,
          status: 'pending',
          updatedAt: Date.now()
        })
      })
      .catch((error) => {
        console.error('Failed to hydrate streaming assistant message:', error)
      })
      .finally(() => {
        hydratingStreamMessageIds.delete(messageId)
      })
  }

  const cleanupIpcBindings = bindMessageStoreIpc({
    getActiveSessionId: () => useSessionStore().activeSessionId,
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
    isStreaming: streamStateStore.isStreaming,
    streamingBlocks: streamStateStore.streamingBlocks,
    currentStreamMessageId: streamStateStore.currentStreamMessageId,
    streamRevision: streamStateStore.streamRevision,
    lastPersistedRevision,
    messages,
    getAssistantMessageBlocks,
    getUserMessageContent,
    getMessageMetadata,
    loadMessages,
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
