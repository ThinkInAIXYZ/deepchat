import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { useMessageStore } from '@/stores/ui/message'
import type { useSessionStore } from '@/stores/ui/session'
import type { useModelStore } from '@/stores/modelStore'
import type {
  DisplayAssistantMessageBlock,
  DisplayMessage,
  DisplayMessageUsage
} from '@/components/chat/messageListItems'
import {
  filterRenderableAssistantBlocks,
  hasRenderableAssistantBlocks
} from '@/components/chat/messageListItems'
import type { ChatMessageRecord, MessageMetadata } from '@shared/types/agent-interface'

type MessageStore = ReturnType<typeof useMessageStore>
type SessionStore = ReturnType<typeof useSessionStore>
type ModelStore = ReturnType<typeof useModelStore>

const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'

type UseDisplayMessagesOptions = {
  sessionId: () => string
  messageStore: MessageStore
  sessionStore: SessionStore
  modelStore: ModelStore
  isGenerating: Ref<boolean>
  isSessionViewCommitted: ComputedRef<boolean>
  isCurrentSessionStreaming: ComputedRef<boolean>
}

/**
 * Owns everything that turns persisted + streaming message state into the ordered
 * `DisplayMessage[]` the list renders:
 *
 * - `toDisplayMessage` conversion with an identity cache so token updates don't
 *   rebuild settled rows.
 * - Stable history list (reads only `lastPersistedRevision`) vs. the high-frequency
 *   streaming tail (reads `streamRevision`) — kept separate so long sessions don't
 *   rebuild every row on each token.
 * - The pending-assistant placeholder state machine and its renderKey handoff, which
 *   hands the placeholder's identity to the real streaming row so completion patches
 *   the same DOM node instead of unmount/remount.
 */
export function useDisplayMessages(options: UseDisplayMessagesOptions) {
  const { messageStore, sessionStore, modelStore, isGenerating } = options
  const { isSessionViewCommitted, isCurrentSessionStreaming } = options
  const currentSessionId = () => options.sessionId()

  const pendingAssistantPlaceholder = ref<{
    id: string
    sessionId: string
    baselineAssistantMessageIds: Set<string>
    baselineMessageOrderSeq: number
    baselineCreatedAt: number
  } | null>(null)
  const assistantRenderKeyByMessageId = ref<Record<string, string>>({})
  let pendingAssistantPlaceholderSeq = 0

  const displayMessageCache = new Map<
    string,
    {
      updatedAt: number
      content: ChatMessageRecord['content']
      metadata: ChatMessageRecord['metadata']
      modelId: string
      providerId: string
      status: DisplayMessage['status']
      renderKey?: string
      message: DisplayMessage
    }
  >()

  function resolveAssistantModelName(modelId: string): string {
    if (!modelId) {
      return 'Assistant'
    }
    const found = modelStore.findModelByIdOrName(modelId)
    return found?.model?.name || modelId
  }

  function buildUsage(metadata: MessageMetadata): DisplayMessageUsage {
    return {
      context_usage: 0,
      tokens_per_second: metadata.tokensPerSecond ?? 0,
      total_tokens: metadata.totalTokens ?? 0,
      generation_time: metadata.generationTime ?? 0,
      first_token_time: metadata.firstTokenTime ?? 0,
      reasoning_start_time: metadata.reasoningStartTime ?? 0,
      reasoning_end_time: metadata.reasoningEndTime ?? 0,
      input_tokens: metadata.inputTokens ?? 0,
      output_tokens: metadata.outputTokens ?? 0
    }
  }

  function toDisplayMessage(record: ChatMessageRecord): DisplayMessage {
    const metadata = messageStore.getMessageMetadata(record)
    const modelId = metadata.model || sessionStore.activeSession?.modelId || ''
    const providerId = metadata.provider || sessionStore.activeSession?.providerId || ''
    const cached = displayMessageCache.get(record.id)
    if (
      cached &&
      cached.updatedAt === record.updatedAt &&
      cached.content === record.content &&
      cached.metadata === record.metadata &&
      cached.modelId === modelId &&
      cached.providerId === providerId &&
      cached.status === record.status &&
      cached.renderKey === assistantRenderKeyByMessageId.value[record.id]
    ) {
      return cached.message
    }

    const modelName = record.role === 'assistant' ? resolveAssistantModelName(modelId) : ''
    const baseMessage = {
      id: record.id,
      timestamp: record.createdAt,
      updatedAt: record.updatedAt,
      avatar: '',
      name: record.role === 'user' ? 'You' : 'Assistant',
      model_name: modelName,
      model_id: modelId,
      model_provider: providerId,
      status: record.status,
      error: '',
      usage: buildUsage(metadata),
      conversationId: record.sessionId,
      is_variant: 0,
      orderSeq: record.orderSeq,
      messageType: metadata.messageType === 'compaction' ? 'compaction' : 'normal',
      compactionStatus: metadata.compactionStatus,
      summaryUpdatedAt: metadata.summaryUpdatedAt ?? null
    } as const

    const streamingRenderKey = assistantRenderKeyByMessageId.value[record.id]
    const nextMessage =
      record.role === 'assistant'
        ? ({
            ...baseMessage,
            ...(streamingRenderKey ? { renderKey: streamingRenderKey } : {}),
            role: 'assistant',
            content: filterRenderableAssistantBlocks(messageStore.getAssistantMessageBlocks(record))
          } as DisplayMessage)
        : ({
            ...baseMessage,
            role: 'user',
            content: messageStore.getUserMessageContent(record)
          } as DisplayMessage)

    displayMessageCache.set(record.id, {
      updatedAt: record.updatedAt,
      content: record.content,
      metadata: record.metadata,
      modelId,
      providerId,
      status: record.status,
      renderKey: streamingRenderKey,
      message: nextMessage
    })

    return nextMessage
  }

  // Build a streaming assistant message from live blocks
  function toStreamingMessage(
    blocks: DisplayAssistantMessageBlock[],
    messageId?: string | null
  ): DisplayMessage {
    const modelId = sessionStore.activeSession?.modelId ?? ''
    const now = Date.now()
    const renderableBlocks = filterRenderableAssistantBlocks(blocks)
    return {
      // Key the streaming row by the real message id when we have one, so that when
      // the persisted copy arrives at stream end Vue patches the SAME node in place
      // (markdown DOM reused) instead of unmount/remount — no completion flash.
      // Falls back to a synthetic id only when the backend hasn't assigned one yet.
      id: messageId ?? '__streaming__',
      content: renderableBlocks,
      role: 'assistant',
      timestamp: now,
      updatedAt: now,
      avatar: '',
      name: 'Assistant',
      model_name: resolveAssistantModelName(modelId),
      model_id: modelId,
      model_provider: sessionStore.activeSession?.providerId ?? '',
      status: 'pending',
      error: '',
      usage: buildUsage({}),
      conversationId: currentSessionId(),
      is_variant: 0,
      orderSeq: Number.MAX_SAFE_INTEGER
    }
  }

  function shouldRenderDisplayMessage(message: DisplayMessage): boolean {
    if (message.role !== 'assistant') {
      return true
    }

    if (message.messageType === 'compaction') {
      return true
    }

    if (message.status === 'pending') {
      return true
    }

    return hasRenderableAssistantBlocks(message.content)
  }

  const hasInlineStreamingTarget = computed(() => {
    if (!isCurrentSessionStreaming.value) return false
    const messageId = messageStore.currentStreamMessageId
    if (!messageId) return false
    return messageStore.messageCache.get(messageId)?.sessionId === currentSessionId()
  })
  const hasFirstStreamingContent = computed(
    () => messageStore.streamingBlocks.length > 0 && hasInlineStreamingTarget.value
  )

  const ephemeralRateLimitMessageId = computed(() => {
    const messageId = messageStore.currentStreamMessageId
    if (
      !isCurrentSessionStreaming.value ||
      !messageId ||
      !messageId.startsWith(RATE_LIMIT_STREAM_MESSAGE_PREFIX)
    ) {
      return null
    }

    return messageId
  })

  const ephemeralRateLimitBlock = computed<DisplayAssistantMessageBlock | null>(() => {
    if (!ephemeralRateLimitMessageId.value || messageStore.streamingBlocks.length === 0) {
      return null
    }

    const [firstBlock] = messageStore.streamingBlocks as DisplayAssistantMessageBlock[]
    if (
      messageStore.streamingBlocks.length !== 1 ||
      firstBlock?.type !== 'action' ||
      firstBlock.action_type !== 'rate_limit'
    ) {
      return null
    }

    return firstBlock
  })

  const hasNewAssistantMessageAfterPendingPlaceholder = computed(() => {
    const pending = pendingAssistantPlaceholder.value
    if (!pending || pending.sessionId !== currentSessionId()) return false

    return messageStore.messages.some(
      (message) =>
        message.role === 'assistant' &&
        !pending.baselineAssistantMessageIds.has(message.id) &&
        isMessageAfterPendingAssistantBaseline(message, pending)
    )
  })

  const shouldShowPendingAssistantPlaceholder = computed(() => {
    const pending = pendingAssistantPlaceholder.value
    return Boolean(
      pending &&
      pending.sessionId === currentSessionId() &&
      !hasFirstStreamingContent.value &&
      !hasNewAssistantMessageAfterPendingPlaceholder.value &&
      !ephemeralRateLimitBlock.value
    )
  })

  const hasPendingAssistantMessage = computed(() =>
    messageStore.messages.some(
      (message) => message.role === 'assistant' && message.status === 'pending'
    )
  )

  const shouldShowGeneratingAssistantPlaceholder = computed(
    () =>
      isGenerating.value &&
      !shouldShowPendingAssistantPlaceholder.value &&
      !hasFirstStreamingContent.value &&
      !hasPendingAssistantMessage.value &&
      !ephemeralRateLimitBlock.value
  )

  watch(
    () => hasFirstStreamingContent.value || hasNewAssistantMessageAfterPendingPlaceholder.value,
    (shouldClearPendingAssistant) => {
      if (shouldClearPendingAssistant) {
        bindPendingAssistantRenderKey()
        pendingAssistantPlaceholder.value = null
      }
    }
  )

  function createPendingAssistantPlaceholder(sessionId: string): string {
    const id = `__pending_assistant_${Date.now()}_${++pendingAssistantPlaceholderSeq}`
    const loadedMessages = messageStore.messages
    const baselineAssistantMessageIds = new Set(
      loadedMessages.filter((message) => message.role === 'assistant').map((message) => message.id)
    )
    const baselineMessageOrderSeq = Math.max(
      Number.NEGATIVE_INFINITY,
      ...loadedMessages.map((message) =>
        Number.isFinite(message.orderSeq) ? message.orderSeq : Number.NEGATIVE_INFINITY
      )
    )
    pendingAssistantPlaceholder.value = {
      id,
      sessionId,
      baselineAssistantMessageIds,
      baselineMessageOrderSeq,
      baselineCreatedAt: Date.now()
    }
    return id
  }

  function isMessageAfterPendingAssistantBaseline(
    message: ChatMessageRecord,
    pending: NonNullable<typeof pendingAssistantPlaceholder.value>
  ): boolean {
    if (Number.isFinite(pending.baselineMessageOrderSeq) && Number.isFinite(message.orderSeq)) {
      return message.orderSeq > pending.baselineMessageOrderSeq
    }

    return message.createdAt > pending.baselineCreatedAt
  }

  function clearPendingAssistantPlaceholder(id?: string): void {
    if (!id || pendingAssistantPlaceholder.value?.id === id) {
      pendingAssistantPlaceholder.value = null
    }
  }

  function bindPendingAssistantRenderKey(): void {
    const pending = pendingAssistantPlaceholder.value
    const streamMessageId = messageStore.currentStreamMessageId
    if (
      !pending ||
      pending.sessionId !== currentSessionId() ||
      !streamMessageId ||
      !hasInlineStreamingTarget.value ||
      assistantRenderKeyByMessageId.value[streamMessageId] === pending.id
    ) {
      return
    }
    assistantRenderKeyByMessageId.value = {
      ...assistantRenderKeyByMessageId.value,
      [streamMessageId]: pending.id
    }
  }

  watch(
    () => [messageStore.currentStreamMessageId, hasInlineStreamingTarget.value] as const,
    bindPendingAssistantRenderKey
  )

  /**
   * Stable history list: intentionally does NOT read streamRevision / streamingBlocks,
   * so token-level updates do not rebuild every display message in long sessions.
   * The in-flight assistant row is owned by streamingDisplayTail instead.
   */
  const stableDisplayMessages = computed(() => {
    void messageStore.lastPersistedRevision
    if (!isSessionViewCommitted.value) {
      return []
    }
    const streamId =
      isCurrentSessionStreaming.value && hasInlineStreamingTarget.value
        ? messageStore.currentStreamMessageId
        : null

    const msgs: DisplayMessage[] = []
    const activeMessageIds = new Set<string>()
    const cache = messageStore.messageCache

    for (const id of messageStore.messageIds) {
      if (streamId && id === streamId) {
        continue
      }
      const message = cache.get(id)
      if (!message || message.sessionId !== currentSessionId()) continue
      activeMessageIds.add(message.id)
      const displayMessage = toDisplayMessage(message)
      if (shouldRenderDisplayMessage(displayMessage)) {
        msgs.push(displayMessage)
      }
    }

    for (const cachedId of displayMessageCache.keys()) {
      if (!activeMessageIds.has(cachedId) && cachedId !== streamId) {
        displayMessageCache.delete(cachedId)
      }
    }

    return msgs
  })

  /** High-frequency streaming row + pending placeholder only. */
  const streamingDisplayTail = computed(() => {
    void messageStore.streamRevision
    if (!isSessionViewCommitted.value) {
      return []
    }
    const msgs: DisplayMessage[] = []

    // Single-track: stream blocks are folded into the message record in place, so the
    // generating message is the same id/node through completion (no flash).
    if (isCurrentSessionStreaming.value && hasInlineStreamingTarget.value) {
      const streamId = messageStore.currentStreamMessageId
      const record = streamId ? messageStore.messageCache.get(streamId) : undefined
      if (record) {
        const displayMessage = toDisplayMessage(record)
        if (shouldRenderDisplayMessage(displayMessage)) {
          msgs.push(displayMessage)
        }
      }
    } else if (
      isCurrentSessionStreaming.value &&
      messageStore.streamingBlocks.length > 0 &&
      !hasInlineStreamingTarget.value &&
      !ephemeralRateLimitBlock.value
    ) {
      msgs.push(
        toStreamingMessage(
          messageStore.streamingBlocks as DisplayAssistantMessageBlock[],
          messageStore.currentStreamMessageId
        )
      )
    }

    if (shouldShowPendingAssistantPlaceholder.value && pendingAssistantPlaceholder.value) {
      msgs.push(toStreamingMessage([], pendingAssistantPlaceholder.value.id))
    } else if (shouldShowGeneratingAssistantPlaceholder.value) {
      msgs.push(toStreamingMessage([], `__pending_assistant_generating_${currentSessionId()}`))
    }

    return msgs
  })

  const displayMessages = computed(() => {
    const stable = stableDisplayMessages.value
    const tail = streamingDisplayTail.value
    if (tail.length === 0) {
      return stable
    }

    const streamId = messageStore.currentStreamMessageId
    // Common path: virtual/fallback streaming rows and pending placeholders append at end.
    if (!(streamId && hasInlineStreamingTarget.value && tail[0]?.id === streamId)) {
      return stable.concat(tail)
    }

    // Re-insert the in-flight row at its messageIds order while reusing stable objects.
    const stableById = new Map(stable.map((message) => [message.id, message]))
    const ordered: DisplayMessage[] = []
    for (const id of messageStore.messageIds) {
      if (id === streamId) {
        ordered.push(tail[0])
        continue
      }
      const item = stableById.get(id)
      if (item) {
        ordered.push(item)
      }
    }
    for (let i = 1; i < tail.length; i += 1) {
      ordered.push(tail[i])
    }
    return ordered
  })

  function resetForSessionChange(): void {
    displayMessageCache.clear()
    assistantRenderKeyByMessageId.value = {}
    pendingAssistantPlaceholder.value = null
  }

  return {
    displayMessages,
    ephemeralRateLimitBlock,
    ephemeralRateLimitMessageId,
    hasFirstStreamingContent,
    hasInlineStreamingTarget,
    pendingAssistantPlaceholder,
    createPendingAssistantPlaceholder,
    clearPendingAssistantPlaceholder,
    resetForSessionChange
  }
}
