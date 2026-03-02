import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { STREAM_EVENTS } from '@/events'
import type { ChatMessageRecord, AssistantMessageBlock } from '@shared/types/agent-interface'
import { useSessionStore } from './session'

// --- Store ---

export const useMessageStore = defineStore('message', () => {
  const newAgentPresenter = usePresenter('newAgentPresenter')

  // --- State ---
  const messageIds = ref<string[]>([])
  const messageCache = ref<Map<string, ChatMessageRecord>>(new Map())
  const isStreaming = ref(false)
  const streamingBlocks = ref<AssistantMessageBlock[]>([])
  const currentStreamSessionId = ref<string | null>(null)
  const currentStreamMessageId = ref<string | null>(null)
  const hydratingStreamMessageIds = new Set<string>()

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
    try {
      const result = await newAgentPresenter.getMessages(sessionId)
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
  function addOptimisticUserMessage(sessionId: string, text: string): void {
    const id = `__optimistic_user_${Date.now()}`
    const record: ChatMessageRecord = {
      id,
      sessionId,
      orderSeq: messageIds.value.length + 1,
      role: 'user',
      content: JSON.stringify({ text, files: [], links: [], search: false, think: false }),
      status: 'sent',
      isContextEdge: 0,
      metadata: '{}',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    messageCache.value.set(id, record)
    messageIds.value.push(id)
  }

  function clear(): void {
    messageIds.value = []
    messageCache.value.clear()
    isStreaming.value = false
    streamingBlocks.value = []
    currentStreamSessionId.value = null
    currentStreamMessageId.value = null
    hydratingStreamMessageIds.clear()
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

  // --- Event Listeners ---

  window.electron.ipcRenderer.on(
    STREAM_EVENTS.RESPONSE,
    (
      _: unknown,
      msg: {
        conversationId: string
        blocks: AssistantMessageBlock[]
        messageId?: string
        eventId?: string
      }
    ) => {
      const sessionStore = useSessionStore()
      if (msg.conversationId === sessionStore.activeSessionId) {
        const streamMessageId = msg.messageId ?? msg.eventId
        isStreaming.value = true
        currentStreamSessionId.value = msg.conversationId
        currentStreamMessageId.value = streamMessageId ?? null
        streamingBlocks.value = msg.blocks
        if (streamMessageId) {
          applyStreamingBlocksToMessage(streamMessageId, msg.conversationId, msg.blocks)
        }
      }
    }
  )

  window.electron.ipcRenderer.on(
    STREAM_EVENTS.END,
    (_: unknown, msg: { conversationId: string; messageId?: string; eventId?: string }) => {
      const sessionStore = useSessionStore()
      if (msg.conversationId === sessionStore.activeSessionId) {
        isStreaming.value = false
        streamingBlocks.value = []
        currentStreamSessionId.value = null
        currentStreamMessageId.value = null
        // Reload messages from DB to get finalized content
        void loadMessages(msg.conversationId)
      }
    }
  )

  window.electron.ipcRenderer.on(
    STREAM_EVENTS.ERROR,
    (
      _: unknown,
      msg: { conversationId: string; error: string; messageId?: string; eventId?: string }
    ) => {
      const sessionStore = useSessionStore()
      if (msg.conversationId === sessionStore.activeSessionId) {
        isStreaming.value = false
        streamingBlocks.value = []
        currentStreamSessionId.value = null
        currentStreamMessageId.value = null
        // Reload messages from DB to get error state
        void loadMessages(msg.conversationId)
      }
    }
  )

  return {
    messageIds,
    messageCache,
    isStreaming,
    streamingBlocks,
    currentStreamMessageId,
    messages,
    loadMessages,
    getMessage,
    addOptimisticUserMessage,
    clear
  }
})
