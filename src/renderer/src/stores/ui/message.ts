import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose, getCurrentScope } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile
} from '@shared/types/agent-interface'
import { useSessionStore } from './session'
import { useStreamStateStore } from './stream'
import { bindMessageStoreIpc } from './messageIpc'

const EPHEMERAL_STREAM_MESSAGE_PREFIXES = ['__rate_limit__:']

// --- Store ---

export const useMessageStore = defineStore('message', () => {
  const newAgentPresenter = usePresenter('newAgentPresenter')
  const streamStateStore = useStreamStateStore()

  // --- State ---
  const messageIds = ref<string[]>([])
  const messageCache = ref<Map<string, ChatMessageRecord>>(new Map())
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

  async function loadMessages(sessionId: string): Promise<void> {
    const requestId = ++latestLoadRequestId
    try {
      const result = await newAgentPresenter.getMessages(sessionId)
      if (requestId !== latestLoadRequestId) {
        return
      }

      messageCache.value.clear()
      messageIds.value = []
      for (const msg of result) {
        messageCache.value.set(msg.id, msg)
        messageIds.value.push(msg.id)
      }
    } catch (e) {
      console.error('Failed to load messages:', e)
    }
  }

  async function getMessage(id: string): Promise<ChatMessageRecord | null> {
    const cached = messageCache.value.get(id)
    if (cached) return cached

    try {
      const msg = await newAgentPresenter.getMessage(id)
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

    void newAgentPresenter
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
    messages,
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
