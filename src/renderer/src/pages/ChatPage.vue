<template>
  <TooltipProvider :delay-duration="200">
    <div
      ref="scrollContainer"
      data-testid="chat-page"
      :data-generating="String(isGenerating)"
      class="message-list-container h-full w-full min-w-0 overflow-y-auto"
      @scroll="onScroll"
    >
      <ChatTopBar
        class="chat-capture-hide"
        :session-id="props.sessionId"
        :title="sessionTitle"
        :project="sessionProject"
        :is-read-only="isReadOnlySession"
      />
      <div v-if="isChatSearchOpen" class="pointer-events-none sticky top-14 z-20 px-6">
        <div class="mx-auto flex w-full max-w-5xl justify-end">
          <ChatSearchBar
            ref="chatSearchBarRef"
            v-model="chatSearchQuery"
            class="pointer-events-auto"
            :active-match="activeChatSearchIndex"
            :total-matches="chatSearchMatches.length"
            @previous="goToPreviousChatSearchMatch"
            @next="goToNextChatSearchMatch"
            @close="closeChatSearch"
          />
        </div>
      </div>
      <div ref="messageSearchRoot" class="min-h-[calc(100%-242px)]" :style="messageSearchRootStyle">
        <div
          v-if="messageStore.isLoadingHistory"
          class="pointer-events-none px-6 py-2 text-center text-xs text-muted-foreground"
        >
          {{ t('common.loading') }}
        </div>
        <MessageList
          :messages="displayMessages"
          :conversation-id="props.sessionId"
          :ephemeral-rate-limit-block="ephemeralRateLimitBlock"
          :ephemeral-rate-limit-message-id="ephemeralRateLimitMessageId"
          :is-generating="isGenerating"
          :trace-message-ids="traceMessageIds"
          :is-read-only="isReadOnlySession"
          @retry="onMessageRetry"
          @delete="onMessageDelete"
          @fork="onMessageFork"
          @continue="onMessageContinue"
          @trace="onMessageTrace"
          @edit-save="onMessageEditSave"
        />
      </div>
      <TraceDialog :message-id="traceMessageId" @close="traceMessageId = null" />

      <!-- Input area (sticky bottom, messages scroll under) -->
      <div
        v-if="!isReadOnlySession"
        class="chat-capture-hide sticky bottom-0 z-10 w-full px-6 pb-3 pt-3"
      >
        <div class="mx-auto flex w-full max-w-5xl min-w-0 flex-col items-center">
          <ChatToolInteractionOverlay
            v-if="activePendingInteraction"
            :interaction="activePendingInteraction"
            :processing="isHandlingInteraction"
            @respond="onToolInteractionRespond"
          />
          <div class="w-full">
            <PendingInputLane
              :steer-items="pendingInputStore.steerItems"
              :queue-items="pendingInputStore.queueItems"
              :disable-steer-action="pendingInputStore.isAtCapacity"
              :show-resume-queue="showResumePendingQueue"
              class="mx-auto mb-1.5 max-w-4xl"
              @update-queue="onPendingInputUpdate"
              @move-queue="onPendingInputMove"
              @delete-queue="onPendingInputDelete"
              @resume-queue="onResumePendingQueue"
            />
            <div class="relative">
              <div
                v-if="latestPlanSnapshot"
                ref="planFloatLayer"
                class="pointer-events-none absolute inset-x-0 bottom-[calc(100%+0.75rem)] z-20 flex w-full justify-end"
                data-testid="agent-progress-float-layer"
              >
                <AgentProgressFloat
                  :snapshot="latestPlanSnapshot"
                  :collapsed="isPlanFloatCollapsed"
                  @dismiss="onDismissPlanFloat"
                  @toggle-collapse="agentPlanStore.toggleCollapsed(props.sessionId)"
                />
              </div>
              <template v-if="!activePendingInteraction">
                <div class="mx-auto flex w-full max-w-4xl flex-col">
                  <ChatInputBox
                    ref="chatInputRef"
                    v-model="message"
                    max-width-class="max-w-4xl"
                    :files="attachedFiles"
                    :session-id="props.sessionId"
                    :workspace-path="sessionStore.activeSession?.projectDir ?? null"
                    :is-acp-session="sessionStore.activeSession?.providerId === 'acp'"
                    :is-generating="isGenerating"
                    :submit-disabled="isInputSubmitDisabled"
                    :queue-submit-enabled="isGenerating && hasDraftInput"
                    :queue-submit-disabled="isQueueSubmitDisabled"
                    @update:files="onFilesChange"
                    @command-submit="onCommandSubmit"
                    @queue-submit="onQueueSubmit"
                    @submit="onSubmit"
                    @toggle-voice-input="onToggleVoiceInput"
                  >
                    <template #toolbar>
                      <ChatInputToolbar
                        :is-generating="isGenerating"
                        :has-input="hasDraftInput"
                        :send-disabled="isInputSubmitDisabled"
                        :queue-disabled="isQueueSubmitDisabled"
                        :show-voice-input="isVoiceInputEnabled"
                        :is-voice-input-listening="isVoiceInputListening"
                        :is-voice-input-transcribing="isVoiceInputTranscribing"
                        @attach="onAttach"
                        @voice-input="onToggleVoiceInput"
                        @queue="onQueueSubmit"
                        @steer="onSteer"
                        @send="onSubmit"
                        @stop="onStop"
                      />
                    </template>
                  </ChatInputBox>
                  <ChatStatusBar max-width-class="max-w-4xl" />
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import ChatTopBar from '@/components/chat/ChatTopBar.vue'
import ChatSearchBar from '@/components/chat/ChatSearchBar.vue'
import MessageList from '@/components/chat/MessageList.vue'
import type {
  DisplayAssistantMessageBlock,
  DisplayMessage,
  DisplayMessageUsage
} from '@/components/chat/messageListItems'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import ChatInputToolbar from '@/components/chat/ChatInputToolbar.vue'
import AgentProgressFloat from '@/components/chat/AgentProgressFloat.vue'
import PendingInputLane from '@/components/chat/PendingInputLane.vue'
import ChatStatusBar from '@/components/chat/ChatStatusBar.vue'
import ChatToolInteractionOverlay from '@/components/chat/ChatToolInteractionOverlay.vue'
import TraceDialog from '@/components/trace/TraceDialog.vue'
import { useToast } from '@/components/use-toast'
import { createChatClient } from '../../api/ChatClient'
import { createModelClient } from '@api/ModelClient'
import { useSessionStore } from '@/stores/ui/session'
import { useMessageStore } from '@/stores/ui/message'
import { usePendingInputStore } from '@/stores/ui/pendingInput'
import { useAgentPlanStore } from '@/stores/ui/agentPlan'
import { useSpotlightStore } from '@/stores/ui/spotlight'
import { useModelStore } from '@/stores/modelStore'
import { createSessionClient } from '@api/SessionClient'
import { isManualCompactionCommand } from '@/components/chat/mentions/utils'
import {
  applyChatSearchHighlights,
  clearChatSearchHighlights,
  setActiveChatSearchMatch,
  type ChatSearchMatch
} from '@/lib/chatSearch'
import { scheduleStartupDeferredTask } from '@/lib/startupDeferred'
import { filterUnsupportedAudioAttachments } from '@/lib/audioInputSupport'
import { useSpeechRecognition } from '@/components/chat/composables/useSpeechRecognition'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile,
  MessageMetadata,
  ToolInteractionResponse
} from '@shared/types/agent-interface'

const props = defineProps<{
  sessionId: string
}>()

const sessionStore = useSessionStore()
const messageStore = useMessageStore()
const pendingInputStore = usePendingInputStore()
const agentPlanStore = useAgentPlanStore()
const spotlightStore = useSpotlightStore()
const modelStore = useModelStore()
const chatClient = createChatClient()
const modelClient = createModelClient()
const sessionClient = createSessionClient()
const { t } = useI18n()
const { toast } = useToast()

const sessionTitle = computed(() => sessionStore.activeSession?.title ?? t('common.newChat'))
const sessionProject = computed(() => sessionStore.activeSession?.projectDir ?? '')
const isReadOnlySession = computed(() => sessionStore.activeSession?.sessionKind === 'subagent')
const isGenerating = computed(
  () => sessionStore.activeSession?.status === 'working' || messageStore.isStreaming
)
const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'
const isAcpWorkdirMissing = computed(() => {
  const activeSession = sessionStore.activeSession
  if (!activeSession || activeSession.providerId !== 'acp') {
    return false
  }
  return !activeSession.projectDir?.trim()
})

const applyRestoredSessionSummary = (session: unknown) => {
  const applyRestoredSession = (
    sessionStore as typeof sessionStore & {
      applyRestoredSession?: (session: unknown) => void
    }
  ).applyRestoredSession

  if (typeof applyRestoredSession === 'function') {
    applyRestoredSession(session)
  }
}

// --- Auto-scroll ---
const scrollContainer = ref<HTMLDivElement>()
const messageSearchRoot = ref<HTMLDivElement>()
const planFloatLayer = ref<HTMLDivElement | null>(null)
// Track whether user is near the bottom; if they scroll up, stop auto-following
const isNearBottom = ref(true)
const NEAR_BOTTOM_THRESHOLD = 80 // px
const TOP_HISTORY_THRESHOLD = 80
const MESSAGE_JUMP_RETRY_INTERVAL = 80
const MESSAGE_HIGHLIGHT_DURATION = 2000
const MAX_MESSAGE_JUMP_RETRIES = 8
const PLAN_FLOAT_SAFE_GAP = 16
const planFloatReservedHeight = ref(0)
const displayMessageCache = new Map<
  string,
  {
    updatedAt: number
    content: ChatMessageRecord['content']
    metadata: ChatMessageRecord['metadata']
    modelId: string
    providerId: string
    status: DisplayMessage['status']
    message: DisplayMessage
  }
>()
const traceMessageId = ref<string | null>(null)
const isChatSearchOpen = ref(false)
const chatSearchQuery = ref('')
const chatSearchMatches = ref<ChatSearchMatch[]>([])
const activeChatSearchIndex = ref(0)
const chatSearchBarRef = ref<{
  focusInput: () => void
  selectInput: () => void
} | null>(null)
let spotlightJumpTimer: number | null = null
let scrollReadFrame: number | null = null
let scrollWriteFrame: number | null = null
let chatSearchRefreshFrame: number | null = null
let pendingForcedScroll = false
let lastObservedScrollHeight = 0
let cancelSessionRestoreTask: (() => void) | null = null
let cancelPlanUpdatedListener: (() => void) | null = null
let sessionRestoreRequestId = 0
let planFloatResizeObserver: ResizeObserver | null = null

function disconnectPlanFloatResizeObserver() {
  planFloatResizeObserver?.disconnect()
  planFloatResizeObserver = null
}

function syncPlanFloatReservedHeight() {
  const layer = planFloatLayer.value
  if (!latestPlanSnapshot.value || !layer) {
    planFloatReservedHeight.value = 0
    return
  }

  const trigger = layer.querySelector<HTMLElement>('[data-testid="agent-progress-float-trigger"]')
  const triggerHeight = trigger?.offsetHeight ?? layer.offsetHeight

  planFloatReservedHeight.value = triggerHeight + PLAN_FLOAT_SAFE_GAP
}

function observePlanFloatLayer() {
  disconnectPlanFloatResizeObserver()

  const layer = planFloatLayer.value
  if (!latestPlanSnapshot.value || !layer) {
    planFloatReservedHeight.value = 0
    return
  }

  if (typeof ResizeObserver === 'undefined') {
    syncPlanFloatReservedHeight()
    return
  }

  planFloatResizeObserver = new ResizeObserver(() => {
    syncPlanFloatReservedHeight()
  })
  planFloatResizeObserver.observe(layer)
}

function syncScrollPosition() {
  const el = scrollContainer.value
  if (!el) return
  lastObservedScrollHeight = el.scrollHeight
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isNearBottom.value = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD
}

function scheduleScrollMetricsRead() {
  if (scrollReadFrame !== null) {
    return
  }

  scrollReadFrame = window.requestAnimationFrame(() => {
    scrollReadFrame = null
    syncScrollPosition()
  })
}

function scrollToBottom(force = false) {
  pendingForcedScroll = pendingForcedScroll || force
  if (scrollWriteFrame !== null) {
    return
  }

  scrollWriteFrame = window.requestAnimationFrame(() => {
    scrollWriteFrame = null

    const el = scrollContainer.value
    if (!el) {
      pendingForcedScroll = false
      return
    }

    const shouldForce = pendingForcedScroll
    pendingForcedScroll = false
    const nextScrollHeight = el.scrollHeight

    if (shouldForce || nextScrollHeight > lastObservedScrollHeight) {
      el.scrollTop = nextScrollHeight
    }

    syncScrollPosition()
  })
}

function onScroll() {
  scheduleScrollMetricsRead()
  const el = scrollContainer.value
  if (!el || el.scrollTop > TOP_HISTORY_THRESHOLD) {
    return
  }

  void loadOlderMessagesAtTop()
}

async function loadOlderMessagesAtTop(): Promise<void> {
  if (messageStore.isLoadingHistory || !messageStore.hasMoreHistory) {
    return
  }

  const el = scrollContainer.value
  if (!el) {
    return
  }

  const previousScrollHeight = el.scrollHeight
  const previousScrollTop = el.scrollTop
  const loadedCount = await messageStore.loadOlderMessages()
  if (loadedCount === 0) {
    return
  }

  await nextTick()
  const nextScrollHeight = el.scrollHeight
  el.scrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight)
  syncScrollPosition()
}

async function focusPendingSpotlightMessageJump(attempt = 0): Promise<void> {
  const pendingJump = spotlightStore.pendingMessageJump
  if (!pendingJump || pendingJump.sessionId !== props.sessionId) {
    return
  }

  await nextTick()

  const target = messageSearchRoot.value?.querySelector<HTMLElement>(
    `[data-message-id="${pendingJump.messageId}"]`
  )

  if (!target) {
    // Retry briefly while virtualized / async-rendered message content settles after session switch.
    if (attempt >= MAX_MESSAGE_JUMP_RETRIES) {
      return
    }

    if (spotlightJumpTimer) {
      window.clearTimeout(spotlightJumpTimer)
    }

    spotlightJumpTimer = window.setTimeout(() => {
      void focusPendingSpotlightMessageJump(attempt + 1)
    }, MESSAGE_JUMP_RETRY_INTERVAL)
    return
  }

  target.scrollIntoView({
    block: 'center',
    inline: 'nearest',
    behavior: 'auto'
  })
  target.classList.add('message-highlight')

  window.setTimeout(() => {
    target.classList.remove('message-highlight')
  }, MESSAGE_HIGHLIGHT_DURATION)

  spotlightStore.clearPendingMessageJump()
}

// Load messages when sessionId changes, then scroll to bottom
watch(
  () => props.sessionId,
  async (id) => {
    clearChatSearchState()
    displayMessageCache.clear()
    sessionRestoreRequestId += 1
    cancelSessionRestoreTask?.()
    cancelSessionRestoreTask = null
    messageStore.clear()
    pendingInputStore.clear()
    if (id) {
      const requestId = sessionRestoreRequestId
      cancelSessionRestoreTask = scheduleStartupDeferredTask(async () => {
        if (requestId !== sessionRestoreRequestId) {
          return
        }

        console.info(`[Startup][Renderer] ChatPage restoring session ${id}`)
        const [restoredSession] = await Promise.all([
          messageStore.loadMessages(id),
          pendingInputStore.loadPendingInputs(id)
        ])

        if (requestId !== sessionRestoreRequestId) {
          return
        }

        applyRestoredSessionSummary(restoredSession)

        await nextTick()
        syncScrollPosition()
        if (spotlightStore.pendingMessageJump?.sessionId === id) {
          void focusPendingSpotlightMessageJump()
          return
        }
        scrollToBottom(true)
      })
      return
    }
  },
  { immediate: true }
)

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
    cached.status === record.status
  ) {
    return cached.message
  }

  const modelName = record.role === 'assistant' ? resolveAssistantModelName(modelId) : ''
  const baseMessage = {
    id: record.id,
    timestamp: record.createdAt,
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

  const nextMessage =
    record.role === 'assistant'
      ? ({
          ...baseMessage,
          role: 'assistant',
          content: messageStore.getAssistantMessageBlocks(record)
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
    message: nextMessage
  })

  return nextMessage
}

// Build a streaming assistant message from live blocks
function toStreamingMessage(
  blocks: AssistantMessageBlock[],
  messageId?: string | null
): DisplayMessage {
  const modelId = sessionStore.activeSession?.modelId ?? ''
  return {
    id: messageId ? `__streaming__:${messageId}` : '__streaming__',
    content: blocks as DisplayAssistantMessageBlock[],
    role: 'assistant',
    timestamp: Date.now(),
    avatar: '',
    name: 'Assistant',
    model_name: resolveAssistantModelName(modelId),
    model_id: modelId,
    model_provider: sessionStore.activeSession?.providerId ?? '',
    status: 'pending',
    error: '',
    usage: buildUsage({}),
    conversationId: props.sessionId,
    is_variant: 0,
    orderSeq: Number.MAX_SAFE_INTEGER
  }
}

const hasInlineStreamingTarget = computed(() => {
  const messageId = messageStore.currentStreamMessageId
  if (!messageId) return false
  return messageStore.messageCache.has(messageId)
})

const ephemeralRateLimitMessageId = computed(() => {
  const messageId = messageStore.currentStreamMessageId
  if (
    !messageStore.isStreaming ||
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

const latestPlanSnapshot = computed(() => {
  const snapshot = agentPlanStore.snapshots[props.sessionId]
  if (!snapshot || snapshot.plan.length === 0) {
    return null
  }
  return snapshot
})

const isPlanFloatCollapsed = computed(() => agentPlanStore.isCollapsed(props.sessionId))

const messageSearchRootStyle = computed(() => {
  if (planFloatReservedHeight.value <= 0) {
    return undefined
  }

  return {
    paddingBottom: `${planFloatReservedHeight.value}px`
  }
})

function onDismissPlanFloat() {
  agentPlanStore.setCollapsed(props.sessionId, true)
  agentPlanStore.clear(props.sessionId)
  planFloatReservedHeight.value = 0
}

const displayMessages = computed(() => {
  const msgs: DisplayMessage[] = []
  const activeMessageIds = new Set<string>()

  for (const message of messageStore.messages) {
    activeMessageIds.add(message.id)
    msgs.push(toDisplayMessage(message))
  }

  for (const cachedId of displayMessageCache.keys()) {
    if (!activeMessageIds.has(cachedId)) {
      displayMessageCache.delete(cachedId)
    }
  }

  // Fallback to a virtual streaming message only when target assistant message
  // is not yet available in messageStore.
  if (
    messageStore.isStreaming &&
    messageStore.streamingBlocks.length > 0 &&
    !hasInlineStreamingTarget.value &&
    !ephemeralRateLimitBlock.value
  ) {
    msgs.push(toStreamingMessage(messageStore.streamingBlocks, messageStore.currentStreamMessageId))
  }

  return msgs
})

const traceMessageIds = computed(() =>
  messageStore.messages
    .filter((msg) => msg.role === 'assistant' && (msg.traceCount ?? 0) > 0)
    .map((msg) => msg.id)
)

// Auto-scroll when displayMessages changes (new message added, streaming updates)
watch(
  [latestPlanSnapshot, isPlanFloatCollapsed],
  async ([snapshot]) => {
    if (!snapshot) {
      disconnectPlanFloatResizeObserver()
      planFloatReservedHeight.value = 0
      return
    }

    await nextTick()
    observePlanFloatLayer()
    syncPlanFloatReservedHeight()
  },
  { flush: 'post', immediate: true }
)

watch(
  [
    () => messageStore.messageIds.length,
    () => messageStore.currentStreamMessageId,
    () => messageStore.streamRevision,
    () => messageStore.lastPersistedRevision,
    () => ephemeralRateLimitMessageId.value
  ],
  () => {
    if (spotlightStore.pendingMessageJump?.sessionId === props.sessionId) {
      void focusPendingSpotlightMessageJump()
      return
    }

    if (isNearBottom.value) {
      scrollToBottom()
    }
  },
  { flush: 'post' }
)

async function refreshChatSearchHighlights() {
  if (!isChatSearchOpen.value) {
    return
  }

  await nextTick()
  if (!isChatSearchOpen.value) {
    return
  }

  const root = messageSearchRoot.value
  chatSearchMatches.value = applyChatSearchHighlights(root, chatSearchQuery.value)

  if (chatSearchMatches.value.length === 0) {
    activeChatSearchIndex.value = 0
    return
  }

  const nextIndex = Math.min(activeChatSearchIndex.value, chatSearchMatches.value.length - 1)
  activeChatSearchIndex.value = nextIndex
  setActiveChatSearchMatch(chatSearchMatches.value, nextIndex, { behavior: 'auto' })
}

function cancelScheduledChatSearchRefresh() {
  if (chatSearchRefreshFrame === null) {
    return
  }

  window.cancelAnimationFrame(chatSearchRefreshFrame)
  chatSearchRefreshFrame = null
}

function scheduleChatSearchHighlights() {
  if (!isChatSearchOpen.value || chatSearchRefreshFrame !== null) {
    return
  }

  chatSearchRefreshFrame = window.requestAnimationFrame(() => {
    chatSearchRefreshFrame = null
    void refreshChatSearchHighlights()
  })
}

function focusChatSearchInput() {
  nextTick(() => {
    chatSearchBarRef.value?.selectInput()
  })
}

function clearChatSearchState() {
  cancelScheduledChatSearchRefresh()
  clearChatSearchHighlights(messageSearchRoot.value)
  chatSearchMatches.value = []
  chatSearchQuery.value = ''
  activeChatSearchIndex.value = 0
  isChatSearchOpen.value = false
}

function openChatSearch() {
  isChatSearchOpen.value = true
  focusChatSearchInput()
  void refreshChatSearchHighlights()
}

function closeChatSearch() {
  clearChatSearchState()
}

function activateChatSearchMatch(index: number, behavior: ScrollBehavior = 'smooth') {
  if (chatSearchMatches.value.length === 0) {
    activeChatSearchIndex.value = 0
    return
  }

  const normalizedIndex =
    ((index % chatSearchMatches.value.length) + chatSearchMatches.value.length) %
    chatSearchMatches.value.length

  activeChatSearchIndex.value = normalizedIndex
  setActiveChatSearchMatch(chatSearchMatches.value, normalizedIndex, { behavior })
}

function goToNextChatSearchMatch() {
  activateChatSearchMatch(activeChatSearchIndex.value + 1)
}

function goToPreviousChatSearchMatch() {
  activateChatSearchMatch(activeChatSearchIndex.value - 1)
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  if (!element) {
    return false
  }

  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}

function handleWindowKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    openChatSearch()
    return
  }

  if (!isChatSearchOpen.value) {
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closeChatSearch()
    return
  }

  if (event.key === 'Enter' && !isEditableTarget(event.target)) {
    event.preventDefault()
    if (event.shiftKey) {
      goToPreviousChatSearchMatch()
      return
    }

    goToNextChatSearchMatch()
  }
}

watch(chatSearchQuery, () => {
  activeChatSearchIndex.value = 0
  scheduleChatSearchHighlights()
})

watch(
  displayMessages,
  () => {
    if (!isChatSearchOpen.value) {
      return
    }

    scheduleChatSearchHighlights()
  },
  { flush: 'post' }
)

const message = ref('')
const attachedFiles = ref<MessageFile[]>([])
const chatInputRef = ref<{
  triggerAttach: () => void
  insertRecognizedText?: (text: string) => void
} | null>(null)
const isVoiceInputEnabled = ref(false)
const isHandlingInteraction = ref(false)

const handleVoiceInputError = (code: string) => {
  if (code === 'aborted') {
    return
  }

  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
    toast({
      title: t('chat.input.voiceRecognitionPermissionDeniedTitle'),
      description: t('chat.input.voiceRecognitionPermissionDeniedDescription'),
      variant: 'destructive'
    })
    return
  }

  toast({
    title: t('chat.input.voiceRecognitionErrorTitle'),
    description: t('chat.input.voiceRecognitionErrorDescription'),
    variant: 'destructive'
  })
}

const voiceInput = useSpeechRecognition({
  onTranscript: (text) => {
    chatInputRef.value?.insertRecognizedText?.(text)
  },
  transcribe: async ({ audioBase64, mimeType, filename }) => {
    const selection = getActiveModelSelection()
    if (!selection) {
      throw new Error('transcription-target-unavailable')
    }

    return await modelClient.transcribeAudio(
      selection.providerId,
      selection.modelId,
      audioBase64,
      mimeType,
      filename
    )
  },
  onUnsupported: () => {
    toast({
      title: t('chat.input.voiceRecognitionUnsupportedTitle'),
      description: t('chat.input.voiceRecognitionUnsupportedDescription'),
      variant: 'destructive'
    })
  },
  onError: handleVoiceInputError
})
const isVoiceInputListening = computed(() => voiceInput.isListening.value)
const isVoiceInputTranscribing = computed(() => voiceInput.isTranscribing.value)
let voiceInputConfigToken = 0
let attachmentFilterToken = 0

async function refreshVoiceInputAvailability() {
  const selection = getActiveModelSelection()
  const token = ++voiceInputConfigToken

  if (!selection) {
    isVoiceInputEnabled.value = false
    voiceInput.stop()
    return
  }

  try {
    const modelConfig = await modelClient.getModelConfig(selection.modelId, selection.providerId)
    if (token !== voiceInputConfigToken) {
      return
    }

    isVoiceInputEnabled.value = modelConfig.speechRecognition === true
    if (!isVoiceInputEnabled.value) {
      voiceInput.stop()
    }
  } catch (error) {
    if (token !== voiceInputConfigToken) {
      return
    }

    console.warn('[ChatPage] Failed to resolve voice input setting:', error)
    isVoiceInputEnabled.value = false
    voiceInput.stop()
  }
}

watch(
  () => [sessionStore.activeSession?.providerId, sessionStore.activeSession?.modelId],
  () => {
    void refreshVoiceInputAvailability()
  },
  { immediate: true }
)

const removeModelConfigChangedListener = modelClient.onModelConfigChanged((payload) => {
  const selection = getActiveModelSelection()
  if (!selection) {
    return
  }

  if (payload.providerId !== selection.providerId || payload.modelId !== selection.modelId) {
    return
  }

  void refreshVoiceInputAvailability()
})

const handleContextMenuAskAI = (event: Event) => {
  if (isReadOnlySession.value) {
    return
  }

  const detail = (event as CustomEvent<string>).detail
  const text = typeof detail === 'string' ? detail.trim() : ''
  if (!text) {
    return
  }
  message.value = text
}

type PendingInteractionView = {
  sessionId: string
  messageId: string
  toolCallId: string
  actionType: 'question_request' | 'tool_call_permission'
  toolName: string
  toolArgs: string
  block: AssistantMessageBlock
}

type SubagentProgressPayload = {
  tasks?: Array<{
    sessionId?: string | null
    waitingInteraction?: {
      type: 'permission' | 'question'
      messageId: string
      toolCallId: string
      actionBlock: AssistantMessageBlock
    } | null
  }>
}

function parseSubagentProgress(value: unknown): SubagentProgressPayload | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as SubagentProgressPayload
    return Array.isArray(parsed?.tasks) ? parsed : null
  } catch {
    return null
  }
}

const pendingInteractions = computed<PendingInteractionView[]>(() => {
  const list: PendingInteractionView[] = []

  for (const message of messageStore.messages) {
    if (message.role !== 'assistant') continue
    const blocks = messageStore.getAssistantMessageBlocks(message)

    for (const block of blocks) {
      if (
        block.type !== 'action' ||
        (block.action_type !== 'question_request' &&
          block.action_type !== 'tool_call_permission') ||
        block.status !== 'pending' ||
        block.extra?.needsUserAction === false
      ) {
        continue
      }

      const toolCallId = block.tool_call?.id
      if (!toolCallId) {
        continue
      }

      list.push({
        sessionId: props.sessionId,
        messageId: message.id,
        toolCallId,
        actionType: block.action_type,
        toolName: block.tool_call?.name || '',
        toolArgs: block.tool_call?.params || '',
        block
      })
    }

    for (const block of blocks) {
      if (block.type !== 'tool_call' || block.tool_call?.name !== 'subagent_orchestrator') {
        continue
      }

      const progress = parseSubagentProgress(block.extra?.subagentProgress)
      if (!progress?.tasks?.length) {
        continue
      }

      for (const task of progress.tasks) {
        const waiting = task.waitingInteraction
        if (!waiting?.actionBlock || !task.sessionId) {
          continue
        }

        list.push({
          sessionId: task.sessionId,
          messageId: waiting.messageId,
          toolCallId: waiting.toolCallId,
          actionType: waiting.type === 'question' ? 'question_request' : 'tool_call_permission',
          toolName: waiting.actionBlock.tool_call?.name || block.tool_call?.name || '',
          toolArgs: waiting.actionBlock.tool_call?.params || '',
          block: waiting.actionBlock
        })
      }
    }
  }

  return list
})

const activePendingInteraction = computed(() => pendingInteractions.value[0] ?? null)
const isAwaitingToolQuestionFollowUp = computed(() => {
  let latestUserOrderSeq = 0

  for (const message of messageStore.messages) {
    if (message.role === 'user') {
      latestUserOrderSeq = Math.max(latestUserOrderSeq, message.orderSeq)
    }
  }

  return messageStore.messages.some((message) => {
    if (message.role !== 'assistant' || message.orderSeq <= latestUserOrderSeq) {
      return false
    }

    return messageStore
      .getAssistantMessageBlocks(message)
      .some(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'question_request' &&
          block.status === 'success' &&
          block.extra?.needsUserAction === false &&
          block.extra?.questionResolution === 'replied' &&
          typeof block.extra?.answerText !== 'string'
      )
  })
})
const hasInputText = computed(() => Boolean(message.value.trim()))
const hasAttachments = computed(() => attachedFiles.value.length > 0)
const hasDraftInput = computed(() => hasInputText.value || hasAttachments.value)
const isQueueSubmitDisabled = computed(
  () =>
    isAcpWorkdirMissing.value ||
    !hasDraftInput.value ||
    Boolean(activePendingInteraction.value) ||
    isHandlingInteraction.value ||
    pendingInputStore.isAtCapacity
)
const isInputSubmitDisabled = computed(
  () =>
    isAcpWorkdirMissing.value ||
    Boolean(activePendingInteraction.value) ||
    isHandlingInteraction.value ||
    (isGenerating.value && pendingInputStore.isAtCapacity) ||
    !hasDraftInput.value
)
const showResumePendingQueue = computed(
  () =>
    !isGenerating.value &&
    !activePendingInteraction.value &&
    !isAwaitingToolQuestionFollowUp.value &&
    pendingInputStore.queueItems.length > 0
)

function getActiveModelSelection(): { providerId: string; modelId: string } | null {
  const activeSession = sessionStore.activeSession
  if (!activeSession?.providerId || !activeSession?.modelId) {
    return null
  }

  return {
    providerId: activeSession.providerId,
    modelId: activeSession.modelId
  }
}

function notifyUnsupportedAudioAttachments(
  selection: { providerId: string; modelId: string },
  rejectedAudioFiles: MessageFile[]
) {
  if (rejectedAudioFiles.length === 0) {
    return
  }

  const modelLabel =
    modelStore.findChatSelectableModel(selection.providerId, selection.modelId)?.model.name ??
    selection.modelId

  toast({
    title: t('chat.input.audioInputUnsupportedTitle'),
    description: t('chat.input.audioInputUnsupportedDescription', {
      count: rejectedAudioFiles.length,
      model: modelLabel
    })
  })
}

async function prepareFilesForCurrentModel(files: MessageFile[]): Promise<MessageFile[]> {
  const selection = getActiveModelSelection()
  if (!selection || files.length === 0) {
    return files
  }

  try {
    const capabilities = await modelClient.getCapabilities(selection.providerId, selection.modelId)
    if (capabilities.supportsAudioInput !== false) {
      return files
    }

    const { acceptedFiles, rejectedAudioFiles } = filterUnsupportedAudioAttachments(files, false)
    notifyUnsupportedAudioAttachments(selection, rejectedAudioFiles)
    return acceptedFiles
  } catch (error) {
    console.warn('[ChatPage] Failed to resolve audio input capability:', error)
    return files
  }
}

async function onSubmit() {
  if (isReadOnlySession.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const text = message.value.trim()
  const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
  if (!text && files.length === 0) return
  if (await handleManualCompactionCommand(text)) {
    if (!isGenerating.value) {
      message.value = ''
    }
    return
  }
  if (isGenerating.value) {
    await pendingInputStore.queueInput(props.sessionId, { text, files })
  } else {
    agentPlanStore.clear(props.sessionId)
    await chatClient.sendMessage(props.sessionId, { text, files })
  }
  message.value = ''
  attachedFiles.value = []
}

async function onCommandSubmit(command: string) {
  if (isReadOnlySession.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const text = command.trim()
  if (!text) return

  if (await handleManualCompactionCommand(text)) {
    return
  }

  const files = await prepareFilesForCurrentModel([...attachedFiles.value])
  if (isGenerating.value) {
    await pendingInputStore.queueInput(props.sessionId, { text, files })
  } else {
    agentPlanStore.clear(props.sessionId)
    await chatClient.sendMessage(props.sessionId, { text, files })
  }
  attachedFiles.value = []
}

async function handleManualCompactionCommand(text: string): Promise<boolean> {
  if (!isManualCompactionCommand(text)) {
    return false
  }
  if (sessionStore.activeSession?.providerId === 'acp') {
    return false
  }
  if (isGenerating.value) {
    return true
  }

  try {
    const result = await sessionClient.compactSession(props.sessionId)
    applyRestoredSessionSummary(await messageStore.loadMessages(props.sessionId))
    if (!result.compacted) {
      toast({
        title: t('chat.compaction.noopTitle'),
        description: t('chat.compaction.noopDescription')
      })
    }
  } catch (error) {
    console.error('[ChatPage] manual compaction failed:', error)
    toast({
      title: t('chat.compaction.failedTitle'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
  return true
}

async function onQueueSubmit() {
  if (isReadOnlySession.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const text = message.value.trim()
  const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
  if (!text && files.length === 0) return
  if (await handleManualCompactionCommand(text)) {
    return
  }
  await pendingInputStore.queueInput(props.sessionId, { text, files })
  message.value = ''
  attachedFiles.value = []
}

async function onSteer() {
  if (isReadOnlySession.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const text = message.value.trim()
  const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
  if (!text && files.length === 0) return
  if (await handleManualCompactionCommand(text)) {
    return
  }
  agentPlanStore.clear(props.sessionId)
  await chatClient.steerActiveTurn(props.sessionId, { text, files })
  message.value = ''
  attachedFiles.value = []
}

function onAttach() {
  chatInputRef.value?.triggerAttach()
}

function onToggleVoiceInput() {
  if (!isVoiceInputEnabled.value) {
    return
  }

  void voiceInput.toggle()
}

async function onFilesChange(files: MessageFile[]) {
  const token = ++attachmentFilterToken
  const filteredFiles = await prepareFilesForCurrentModel(files)
  if (token !== attachmentFilterToken) {
    return
  }

  attachedFiles.value = filteredFiles
}

async function onToolInteractionRespond(response: ToolInteractionResponse) {
  if (isReadOnlySession.value) {
    return
  }

  const interaction = activePendingInteraction.value
  if (!interaction || isHandlingInteraction.value) {
    return
  }

  isHandlingInteraction.value = true
  try {
    await chatClient.respondToolInteraction({
      sessionId: interaction.sessionId,
      messageId: interaction.messageId,
      toolCallId: interaction.toolCallId,
      response
    })
    applyRestoredSessionSummary(await messageStore.loadMessages(props.sessionId))
  } catch (error) {
    console.error('[ChatPage] respond tool interaction failed:', error)
  } finally {
    isHandlingInteraction.value = false
  }
}

async function onStop() {
  if (isReadOnlySession.value) return
  if (!isGenerating.value) return
  try {
    await chatClient.stopStream({ sessionId: props.sessionId })
  } catch (error) {
    console.error('[ChatPage] cancel generation failed:', error)
  }
}

async function onMessageRetry(messageId: string) {
  if (isReadOnlySession.value) return
  if (!messageId) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  try {
    messageStore.clearStreamingState()
    await sessionClient.retryMessage(props.sessionId, messageId)
  } catch (error) {
    console.error('[ChatPage] retry message failed:', error)
    applyRestoredSessionSummary(await messageStore.loadMessages(props.sessionId))
  }
}

async function onMessageDelete(messageId: string) {
  if (isReadOnlySession.value) return
  if (!messageId) return
  try {
    messageStore.clearStreamingState()
    await sessionClient.deleteMessage(props.sessionId, messageId)
    applyRestoredSessionSummary(await messageStore.loadMessages(props.sessionId))
  } catch (error) {
    console.error('[ChatPage] delete message failed:', error)
  }
}

async function onMessageEditSave(payload: { messageId: string; text: string }) {
  if (isReadOnlySession.value) return
  const messageId = payload?.messageId
  const text = payload?.text?.trim()
  if (!messageId || !text) return

  try {
    await sessionClient.editUserMessage(props.sessionId, messageId, text)
    await onMessageRetry(messageId)
  } catch (error) {
    console.error('[ChatPage] edit message failed:', error)
  }
}

async function onMessageFork(messageId: string) {
  if (isReadOnlySession.value) return
  if (!messageId) return
  try {
    const forked = await sessionClient.forkSession(props.sessionId, messageId)
    await sessionStore.fetchSessions()
    await sessionStore.selectSession(forked.id)
  } catch (error) {
    console.error('[ChatPage] fork session failed:', error)
  }
}

async function onMessageContinue(_conversationId: string, messageId: string) {
  if (isReadOnlySession.value) return
  if (!messageId) return
  try {
    messageStore.clearStreamingState()
    await sessionClient.retryMessage(props.sessionId, messageId)
  } catch (error) {
    console.error('[ChatPage] continue message failed:', error)
    applyRestoredSessionSummary(await messageStore.loadMessages(props.sessionId))
  }
}

function onMessageTrace(messageId: string) {
  traceMessageId.value = messageId
}

async function onPendingInputUpdate(payload: { itemId: string; text: string }) {
  if (isReadOnlySession.value) return
  const target = pendingInputStore.queueItems.find((item) => item.id === payload.itemId)
  if (!target) {
    return
  }

  await pendingInputStore.updateQueueInput(props.sessionId, payload.itemId, {
    text: payload.text,
    files: target.payload.files ?? []
  })
}

async function onPendingInputMove(payload: { itemId: string; toIndex: number }) {
  if (isReadOnlySession.value) return
  await pendingInputStore.moveQueueInput(props.sessionId, payload.itemId, payload.toIndex)
}

async function onPendingInputDelete(itemId: string) {
  if (isReadOnlySession.value) return
  await pendingInputStore.deleteInput(props.sessionId, itemId)
}

async function onResumePendingQueue() {
  if (isReadOnlySession.value) return
  await pendingInputStore.resumeQueue(props.sessionId)
}

onMounted(() => {
  window.addEventListener('context-menu-ask-ai', handleContextMenuAskAI)
  window.addEventListener('keydown', handleWindowKeydown)
  cancelPlanUpdatedListener = chatClient.onPlanUpdated((payload) => {
    if (payload.sessionId === props.sessionId) {
      agentPlanStore.applySnapshot(payload)
    }
  })
  syncScrollPosition()
  observePlanFloatLayer()
  syncPlanFloatReservedHeight()
})

onUnmounted(() => {
  removeModelConfigChangedListener()
  disconnectPlanFloatResizeObserver()
  cancelPlanUpdatedListener?.()
  cancelPlanUpdatedListener = null
  voiceInput.cleanup()
  cancelSessionRestoreTask?.()
  cancelSessionRestoreTask = null
  window.removeEventListener('context-menu-ask-ai', handleContextMenuAskAI)
  window.removeEventListener('keydown', handleWindowKeydown)
  clearChatSearchHighlights(messageSearchRoot.value)
  if (spotlightJumpTimer) {
    window.clearTimeout(spotlightJumpTimer)
    spotlightJumpTimer = null
  }
  if (scrollReadFrame !== null) {
    window.cancelAnimationFrame(scrollReadFrame)
    scrollReadFrame = null
  }
  if (scrollWriteFrame !== null) {
    window.cancelAnimationFrame(scrollWriteFrame)
    scrollWriteFrame = null
  }
  cancelScheduledChatSearchRefresh()
  pendingInputStore.clear()
})
</script>

<style>
.message-list-container {
  scrollbar-gutter: stable both-edges;
}

.message-highlight {
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 20%, transparent);
  transition:
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.chat-search-highlight {
  border-radius: 0.32rem;
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: inherit;
  padding: 0 0.08rem;
}

.chat-search-highlight--active {
  background: color-mix(in srgb, var(--primary) 22%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 18%, transparent);
}
</style>
