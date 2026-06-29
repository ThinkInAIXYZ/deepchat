<template>
  <TooltipProvider :delay-duration="200">
    <div
      ref="scrollContainer"
      data-testid="chat-page"
      :data-generating="String(isGenerating)"
      class="message-list-container h-full w-full min-w-0 overflow-y-auto"
      @scroll.passive="onScroll"
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
          ref="messageListRef"
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
          @measure="onMessageMeasure"
        />
        <div ref="bottomScrollAnchor" class="h-px w-full" aria-hidden="true" />
      </div>
      <TraceDialog :message-id="traceMessageId" @close="traceMessageId = null" />

      <!-- Input area (sticky bottom, messages scroll under) -->
      <div
        v-if="!isReadOnlySession"
        class="chat-capture-hide sticky bottom-0 z-10 w-full px-6 pb-3 pt-3"
      >
        <div class="mx-auto flex w-full max-w-5xl min-w-0 flex-col items-center">
          <div class="relative w-full">
            <PendingInputLane
              :steer-items="pendingInputStore.steerItems"
              :queue-items="pendingInputStore.queueItems"
              :disable-steer-action="pendingInputStore.isAtCapacity"
              :disable-queue-steer-action="disableQueueSteerAction"
              class="mx-auto mb-1.5 max-w-4xl"
              @update-queue="onPendingInputUpdate"
              @move-queue="onPendingInputMove"
              @steer-queue="onPendingInputSteer"
              @delete-queue="onPendingInputDelete"
            />
            <!-- Anchor the plan/question float to the outer .relative (which includes the queue lane)
                 so bottom:calc(100%+0.75rem) lifts it above PendingInputLane instead of covering it. -->
            <div>
              <div
                v-if="latestPlanSnapshot || activePendingInteraction"
                ref="planFloatLayer"
                class="pointer-events-none absolute inset-x-0 bottom-[calc(100%+0.75rem)] z-20 flex w-full flex-col items-end gap-2"
                data-testid="agent-progress-float-layer"
              >
                <!-- Both plan + question: unified glassmorphism panel -->
                <div
                  v-if="activePendingInteraction && latestPlanSnapshot"
                  class="agent-question-panel pointer-events-auto mx-auto w-full max-w-2xl overflow-hidden rounded-[20px] text-foreground backdrop-blur-[26px]"
                >
                  <div class="agent-question-panel__backdrop" aria-hidden="true" />
                  <AgentProgressFloat
                    :snapshot="latestPlanSnapshot"
                    :collapsed="isPlanFloatCollapsed"
                    :embedded="true"
                    @dismiss="onDismissPlanFloat"
                    @toggle-collapse="agentPlanStore.toggleCollapsed(props.sessionId)"
                  />
                  <div class="agent-question-divider" aria-hidden="true" />
                  <ChatToolInteractionOverlay
                    :embedded="true"
                    :interaction="activePendingInteraction"
                    :processing="isHandlingInteraction"
                    @respond="onToolInteractionRespond"
                  />
                </div>
                <!-- Only question, no plan: standalone centered with own glass -->
                <ChatToolInteractionOverlay
                  v-else-if="activePendingInteraction"
                  class="pointer-events-auto mx-auto"
                  :interaction="activePendingInteraction"
                  :processing="isHandlingInteraction"
                  @respond="onToolInteractionRespond"
                />
                <!-- Only plan: right-aligned, unchanged -->
                <AgentProgressFloat
                  v-else-if="latestPlanSnapshot"
                  :snapshot="latestPlanSnapshot"
                  :collapsed="isPlanFloatCollapsed"
                  @dismiss="onDismissPlanFloat"
                  @toggle-collapse="agentPlanStore.toggleCollapsed(props.sessionId)"
                />
              </div>
              <template v-if="!activePendingInteraction">
                <div ref="chatInputHeroHostRef" class="mx-auto flex w-full max-w-4xl flex-col">
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
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
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
import { WORKSPACE_EVENTS } from '@/events'
import { filterUnsupportedAudioAttachments } from '@/lib/audioInputSupport'
import { useSpeechRecognition } from '@/components/chat/composables/useSpeechRecognition'
import { useMessageWindow } from '@/composables/message/useMessageWindow'
import { playChatInputHeroFlight } from '@/lib/chatInputHero'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile,
  MessageMetadata,
  ToolInteractionResponse
} from '@shared/types/agent-interface'
import { snapshotFromAgentPlanBlock } from '@shared/types/agent-plan-block'

const props = defineProps<{
  sessionId: string
}>()

const uiSettingsStore = useUiSettingsStore()
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
const INITIAL_MESSAGE_RESTORE_COUNT = 40
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

function rehydrateAgentPlanFromMessages(sessionId: string): void {
  let latestSnapshot: ReturnType<typeof snapshotFromAgentPlanBlock> = null
  for (let messageIndex = messageStore.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messageStore.messages[messageIndex]
    if (message.role !== 'assistant') {
      continue
    }

    const blocks = messageStore.getAssistantMessageBlocks(message)
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex]
      const snapshot = snapshotFromAgentPlanBlock(sessionId, message.id, block)
      if (snapshot) {
        latestSnapshot = snapshot
        break
      }
    }

    if (latestSnapshot) {
      break
    }
  }

  agentPlanStore.clearSnapshot(sessionId)
  if (latestSnapshot) {
    agentPlanStore.applySnapshot(latestSnapshot)
  }
}

async function loadMessagesAndRehydrate(sessionId: string, count?: number) {
  const restoredSession = await messageStore.loadMessages(sessionId, count)
  rehydrateAgentPlanFromMessages(sessionId)
  return restoredSession
}

// --- Auto-scroll ---
const scrollContainer = ref<HTMLDivElement>()
const messageSearchRoot = ref<HTMLDivElement>()
const bottomScrollAnchor = ref<HTMLDivElement | null>(null)
const messageListRef = ref<{
  scrollToBottom?: () => void
  forceUpdate?: (clear?: boolean) => void
} | null>(null)
const planFloatLayer = ref<HTMLDivElement | null>(null)
const chatInputHeroHostRef = ref<HTMLDivElement | null>(null)
// Track whether user is near the bottom; if they scroll up, stop auto-following
const isNearBottom = ref(true)
const shouldAutoFollow = ref(true)
type ScrollMode = 'initial-bottom' | 'auto-follow' | 'anchored-reading' | 'manual-jump'
const scrollMode = ref<ScrollMode>('initial-bottom')
const NEAR_BOTTOM_THRESHOLD = 80 // px
const TOP_HISTORY_THRESHOLD = 80
const MESSAGE_JUMP_RETRY_INTERVAL = 80
const MESSAGE_HIGHLIGHT_DURATION = 2000
const MAX_MESSAGE_JUMP_RETRIES = 8
const SESSION_RESTORE_SCROLL_SETTLE_FRAMES = 8
const SESSION_RESTORE_SCROLL_SETTLE_TIMEOUT = 600
const SESSION_RESTORE_SCROLL_INTENT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
  'Spacebar'
])
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
let pendingUserScrollMetrics = false
let sessionRestoreScrollFrame: number | null = null
let sessionRestoreScrollTimer: number | null = null
let chatSearchRefreshFrame: number | null = null
let programmaticScrollUntil = 0
let cancelSessionRestoreTask: (() => void) | null = null
let cancelSessionRestoreScrollIntentListeners: (() => void) | null = null
let cancelPlanUpdatedListener: (() => void) | null = null
let sessionRestoreRequestId = 0
let planFloatResizeObserver: ResizeObserver | null = null
let sessionRestoreResizeObserver: ResizeObserver | null = null
type ViewportAnchor = {
  messageId: string
  viewportOffset: number
}
let pendingAnchorRestore: ViewportAnchor | null = null
let anchorRestoreFrame: number | null = null

const resolveChatInputBoxElement = () =>
  (chatInputHeroHostRef.value?.querySelector(
    '[data-testid="chat-input-box"]'
  ) as HTMLElement | null) ?? null

function disconnectPlanFloatResizeObserver() {
  planFloatResizeObserver?.disconnect()
  planFloatResizeObserver = null
}

function disconnectSessionRestoreResizeObserver() {
  sessionRestoreResizeObserver?.disconnect()
  sessionRestoreResizeObserver = null
}

function cancelSessionRestoreScrollSettle() {
  if (sessionRestoreScrollFrame !== null) {
    window.cancelAnimationFrame(sessionRestoreScrollFrame)
    sessionRestoreScrollFrame = null
  }
  if (sessionRestoreScrollTimer !== null) {
    window.clearTimeout(sessionRestoreScrollTimer)
    sessionRestoreScrollTimer = null
  }
  cancelSessionRestoreScrollIntentListeners?.()
  cancelSessionRestoreScrollIntentListeners = null
  disconnectSessionRestoreResizeObserver()
}

function isSessionRestoreScrollSettleActive(): boolean {
  return sessionRestoreScrollFrame !== null || sessionRestoreScrollTimer !== null
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  )
}

function isSessionRestoreKeyboardScrollIntent(event: KeyboardEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    SESSION_RESTORE_SCROLL_INTENT_KEYS.has(event.key) &&
    !isEditableKeyboardTarget(event.target)
  )
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

function captureViewportAnchor(): ViewportAnchor | null {
  const container = scrollContainer.value
  const root = messageSearchRoot.value
  if (!container || !root) return null

  const containerRect = container.getBoundingClientRect()
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]'))
  let fallback: ViewportAnchor | null = null

  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect()
    const viewportOffset = rect.top - containerRect.top
    if (!candidate.dataset.messageId) continue

    if (!fallback && rect.bottom >= containerRect.top) {
      fallback = {
        messageId: candidate.dataset.messageId,
        viewportOffset
      }
    }

    if (rect.top >= containerRect.top) {
      return {
        messageId: candidate.dataset.messageId,
        viewportOffset
      }
    }
  }

  return fallback
}

function scheduleViewportAnchorRestore(anchor: ViewportAnchor | null): void {
  if (!anchor || isProgrammaticScrollActive()) {
    return
  }

  pendingAnchorRestore = anchor
  if (anchorRestoreFrame !== null) {
    return
  }

  anchorRestoreFrame = window.requestAnimationFrame(() => {
    anchorRestoreFrame = null
    const currentAnchor = pendingAnchorRestore
    pendingAnchorRestore = null
    if (!currentAnchor) return

    const container = scrollContainer.value
    const root = messageSearchRoot.value
    if (!container || !root) return

    const target = root.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(currentAnchor.messageId)}"]`
    )
    if (!target) return

    const containerRect = container.getBoundingClientRect()
    const nextOffset = target.getBoundingClientRect().top - containerRect.top
    const delta = nextOffset - currentAnchor.viewportOffset
    if (Math.abs(delta) >= 1) {
      container.scrollTop += delta
    }
  })
}

function markProgrammaticScroll(durationMs = 300): void {
  programmaticScrollUntil = Math.max(programmaticScrollUntil, Date.now() + durationMs)
}

function isProgrammaticScrollActive(): boolean {
  return Date.now() < programmaticScrollUntil
}

function isAtBottom(): boolean {
  const el = scrollContainer.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD
}

function scrollDomToBottom(): void {
  const el = scrollContainer.value
  if (!el) return
  // Use the container's max scrollTop rather than `bottomScrollAnchor.scrollIntoView`:
  // the anchor sits before the sticky input area in flow, so scrollIntoView stops
  // short by the input's height and never reaches the true bottom during generation.
  el.scrollTop = Math.max(el.scrollHeight - el.clientHeight, 0)
}

function scrollToBottom(force = false) {
  if (force) {
    markProgrammaticScroll(500)
    scrollMode.value = 'initial-bottom'
    shouldAutoFollow.value = true
  } else if (!uiSettingsStore.autoScrollEnabled || !shouldAutoFollow.value) {
    return
  }

  void nextTick(() => {
    scrollDomToBottom()
    if (force) {
      scheduleScrollMetricsRead()
    }
  })
}

function schedulePostSubmitScrollToBottom() {
  void nextTick(() => {
    scrollToBottom(true)
  })
}

function canSettleSessionRestoreScroll(requestId: number, sessionId: string) {
  return (
    requestId === sessionRestoreRequestId &&
    props.sessionId === sessionId &&
    spotlightStore.pendingMessageJump?.sessionId !== sessionId
  )
}

function applySessionRestoreBottomScroll(requestId: number, sessionId: string): boolean {
  if (!canSettleSessionRestoreScroll(requestId, sessionId)) {
    return false
  }

  const el = scrollContainer.value
  if (!el) {
    return false
  }

  el.scrollTop = Math.max(el.scrollHeight - el.clientHeight, 0)
  return true
}

function settleSessionRestoreScrollToBottom(requestId: number, sessionId: string) {
  cancelSessionRestoreScrollSettle()

  if (!canSettleSessionRestoreScroll(requestId, sessionId)) {
    return
  }

  const el = scrollContainer.value
  let remainingFrames = SESSION_RESTORE_SCROLL_SETTLE_FRAMES

  if (el) {
    const cancelForUserScrollIntent = () => {
      cancelSessionRestoreScrollSettle()
    }
    const cancelForKeyboardScrollIntent = (event: KeyboardEvent) => {
      if (isSessionRestoreKeyboardScrollIntent(event)) {
        cancelSessionRestoreScrollSettle()
      }
    }

    el.addEventListener('wheel', cancelForUserScrollIntent, { passive: true })
    el.addEventListener('touchstart', cancelForUserScrollIntent, { passive: true })
    el.addEventListener('pointerdown', cancelForUserScrollIntent, { passive: true })
    el.addEventListener('mousedown', cancelForUserScrollIntent, { passive: true })
    window.addEventListener('keydown', cancelForKeyboardScrollIntent, { capture: true })
    cancelSessionRestoreScrollIntentListeners = () => {
      el.removeEventListener('wheel', cancelForUserScrollIntent)
      el.removeEventListener('touchstart', cancelForUserScrollIntent)
      el.removeEventListener('pointerdown', cancelForUserScrollIntent)
      el.removeEventListener('mousedown', cancelForUserScrollIntent)
      window.removeEventListener('keydown', cancelForKeyboardScrollIntent, true)
    }
  }

  const scheduleNextFrame = () => {
    if (remainingFrames <= 0 || sessionRestoreScrollFrame !== null) {
      return
    }

    sessionRestoreScrollFrame = window.requestAnimationFrame(() => {
      sessionRestoreScrollFrame = null

      if (!applySessionRestoreBottomScroll(requestId, sessionId)) {
        cancelSessionRestoreScrollSettle()
        return
      }

      remainingFrames -= 1
      scheduleNextFrame()
    })
  }

  if (typeof ResizeObserver !== 'undefined') {
    const observedTargets: Element[] = []
    if (messageSearchRoot.value) {
      observedTargets.push(messageSearchRoot.value)
    }
    if (chatInputHeroHostRef.value) {
      observedTargets.push(chatInputHeroHostRef.value)
    }

    if (observedTargets.length > 0) {
      sessionRestoreResizeObserver = new ResizeObserver(() => {
        if (!applySessionRestoreBottomScroll(requestId, sessionId)) {
          cancelSessionRestoreScrollSettle()
        }
      })

      observedTargets.forEach((target) => sessionRestoreResizeObserver?.observe(target))
    }
  }

  sessionRestoreScrollTimer = window.setTimeout(() => {
    cancelSessionRestoreScrollSettle()
  }, SESSION_RESTORE_SCROLL_SETTLE_TIMEOUT)

  scheduleNextFrame()
}

function scheduleScrollMetricsRead(fromUserScroll = false) {
  if (fromUserScroll) {
    pendingUserScrollMetrics = true
  }
  if (scrollReadFrame !== null) return
  scrollReadFrame = window.requestAnimationFrame(() => {
    scrollReadFrame = null
    const userInitiated = pendingUserScrollMetrics
    pendingUserScrollMetrics = false
    const el = scrollContainer.value
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottom.value = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD

    if (isProgrammaticScrollActive()) {
      // During a forced/programmatic scroll, only a genuine user gesture (wheel,
      // drag) may break auto-follow. Content growth pushing us off-bottom must not.
      if (userInitiated && !isNearBottom.value) {
        programmaticScrollUntil = 0
        scrollMode.value = 'anchored-reading'
        shouldAutoFollow.value = false
      }
      return
    }

    // Only a real user scroll may flip between auto-follow and anchored-reading.
    // Programmatic reads (streaming height growth, measure callbacks) keep the
    // current mode so generation stays pinned to the bottom.
    if (userInitiated && scrollMode.value !== 'manual-jump') {
      shouldAutoFollow.value = isNearBottom.value
      scrollMode.value =
        uiSettingsStore.autoScrollEnabled && shouldAutoFollow.value
          ? 'auto-follow'
          : 'anchored-reading'
    }
  })
}

function onScroll() {
  const el = scrollContainer.value
  if (!el) return

  scheduleScrollMetricsRead(true)

  if (el.scrollTop <= TOP_HISTORY_THRESHOLD) {
    void loadOlderMessagesAtTop()
  }
}

async function loadOlderMessagesAtTop(): Promise<void> {
  if (
    messageStore.isLoadingHistory ||
    !messageStore.hasMoreHistory ||
    isProgrammaticScrollActive()
  ) {
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
}

async function focusPendingSpotlightMessageJump(attempt = 0): Promise<void> {
  const pendingJump = spotlightStore.pendingMessageJump
  if (!pendingJump || pendingJump.sessionId !== props.sessionId) {
    return
  }

  await nextTick()

  const escapedMessageId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(pendingJump.messageId)
      : pendingJump.messageId.replace(/["\\]/g, '\\$&')
  let target = messageSearchRoot.value?.querySelector<HTMLElement>(
    `[data-message-id="${escapedMessageId}"]`
  )

  if (!target) {
    const entry = messageWindow.getEntry(pendingJump.messageId)
    const container = scrollContainer.value
    if (entry && container) {
      scrollMode.value = 'manual-jump'
      container.scrollTop = Math.max(entry.top - Math.round(container.clientHeight / 3), 0)
      await nextTick()
      target = messageSearchRoot.value?.querySelector<HTMLElement>(
        `[data-message-id="${escapedMessageId}"]`
      )
    }
  }

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
  scrollMode.value =
    uiSettingsStore.autoScrollEnabled && isNearBottom.value ? 'auto-follow' : 'anchored-reading'
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
    cancelSessionRestoreScrollSettle()
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
          loadMessagesAndRehydrate(id, INITIAL_MESSAGE_RESTORE_COUNT),
          pendingInputStore.loadPendingInputs(id)
        ])

        if (requestId !== sessionRestoreRequestId) {
          return
        }

        applyRestoredSessionSummary(restoredSession)

        await nextTick()
        if (spotlightStore.pendingMessageJump?.sessionId === id) {
          cancelSessionRestoreScrollSettle()
          void focusPendingSpotlightMessageJump()
          return
        }
        settleSessionRestoreScrollToBottom(requestId, id)
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
  const now = Date.now()
  return {
    // Key the streaming row by the real message id when we have one, so that when
    // the persisted copy arrives at stream end Vue patches the SAME node in place
    // (markdown DOM reused) instead of unmount/remount — no completion flash.
    // Falls back to a synthetic id only when the backend hasn't assigned one yet.
    id: messageId ?? '__streaming__',
    content: blocks as DisplayAssistantMessageBlock[],
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
  if (!agentPlanStore.isVisible(props.sessionId)) {
    return null
  }

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
  agentPlanStore.dismiss(props.sessionId)
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

  // Single-track rendering: streaming blocks are folded into their message record
  // in place (applyStreamingBlocksToMessage), so the generating message is already
  // in `msgs` above as a normal item. Only when that record isn't in the store yet
  // do we append a virtual streaming item as a fallback. Stream end then reuses the
  // same id/node — no separate trailing row, no completion flash.
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

const messageWindow = useMessageWindow({
  messages: displayMessages
})

function onMessageMeasure(payload: { messageId: string; height: number }) {
  // Snapshot the reading anchor from pre-change geometry: capturing after
  // setMeasuredHeight resizes the row would compare against post-layout DOM and
  // let anchored-reading/manual-jump drift when content above the viewport grows.
  const isBottomFollowing =
    scrollMode.value === 'initial-bottom' || scrollMode.value === 'auto-follow'
  const preChangeAnchor = isBottomFollowing ? null : captureViewportAnchor()

  const delta = messageWindow.setMeasuredHeight(payload.messageId, payload.height)
  if (delta === 0) return
  if (isBottomFollowing) {
    scrollToBottom(scrollMode.value === 'initial-bottom')
  } else {
    scheduleViewportAnchorRestore(preChangeAnchor)
  }
}

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

    if (scrollMode.value === 'initial-bottom') {
      scrollToBottom(true)
      scrollMode.value = 'auto-follow'
    } else if (scrollMode.value === 'auto-follow') {
      scrollToBottom(false)
    } else {
      scheduleScrollMetricsRead()
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
  insertWorkspaceReference?: (targetPath: string) => boolean
  getPendingSkillsSnapshot?: () => string[]
  consumePendingSkills?: () => string[]
  clearPendingSkills?: () => void
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

const handleWorkspaceInsertReferenceRequested = (event: Event) => {
  if (isReadOnlySession.value) {
    return
  }

  const detail = (event as CustomEvent<{ sessionId?: unknown; filePath?: unknown }>).detail
  const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : ''
  const filePath = typeof detail?.filePath === 'string' ? detail.filePath.trim() : ''
  if (sessionId !== props.sessionId || !filePath) {
    return
  }

  chatInputRef.value?.insertWorkspaceReference?.(filePath)
}

type PendingInteractionView = {
  sessionId: string
  messageId: string
  toolCallId: string
  actionType: 'question_request' | 'tool_call_permission'
  toolName: string
  toolArgs: string
  block: DisplayAssistantMessageBlock
}

type SubagentProgressPayload = {
  tasks?: Array<{
    sessionId?: string | null
    waitingInteraction?: {
      type: 'permission' | 'question'
      messageId: string
      toolCallId: string
      actionBlock: DisplayAssistantMessageBlock
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
const disableQueueSteerAction = computed(
  () =>
    !isGenerating.value ||
    isAcpWorkdirMissing.value ||
    Boolean(activePendingInteraction.value) ||
    isHandlingInteraction.value
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

const getComposerSkillsSnapshot = (): string[] => {
  return Array.from(new Set(chatInputRef.value?.getPendingSkillsSnapshot?.() ?? []))
}

const clearComposerSkills = () => {
  chatInputRef.value?.clearPendingSkills?.()
}

const withMessageSkills = (text: string, files: MessageFile[]) => {
  const activeSkills = getComposerSkillsSnapshot()
  return {
    text,
    files,
    ...(activeSkills.length > 0 ? { activeSkills } : {})
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
  const payload = withMessageSkills(text, files)
  if (isGenerating.value) {
    await pendingInputStore.queueInput(props.sessionId, payload)
  } else {
    agentPlanStore.beginTurn(props.sessionId)
    await chatClient.sendMessage(props.sessionId, payload)
  }
  message.value = ''
  attachedFiles.value = []
  clearComposerSkills()
  schedulePostSubmitScrollToBottom()
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
  const payload = withMessageSkills(text, files)
  if (isGenerating.value) {
    await pendingInputStore.queueInput(props.sessionId, payload)
  } else {
    agentPlanStore.beginTurn(props.sessionId)
    await chatClient.sendMessage(props.sessionId, payload)
  }
  attachedFiles.value = []
  clearComposerSkills()
  schedulePostSubmitScrollToBottom()
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
    applyRestoredSessionSummary(await loadMessagesAndRehydrate(props.sessionId))
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
  await pendingInputStore.queueInput(props.sessionId, withMessageSkills(text, files))
  message.value = ''
  attachedFiles.value = []
  clearComposerSkills()
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
  agentPlanStore.beginTurn(props.sessionId)
  await chatClient.steerActiveTurn(props.sessionId, withMessageSkills(text, files))
  message.value = ''
  attachedFiles.value = []
  clearComposerSkills()
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
    const result = await chatClient.respondToolInteraction({
      sessionId: interaction.sessionId,
      messageId: interaction.messageId,
      toolCallId: interaction.toolCallId,
      response
    })
    applyRestoredSessionSummary(await loadMessagesAndRehydrate(props.sessionId))
    if (result.handledInline) {
      return
    }
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
    agentPlanStore.freezeActive(props.sessionId)
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
    agentPlanStore.beginTurn(props.sessionId)
    messageStore.clearStreamingState()
    await sessionClient.retryMessage(props.sessionId, messageId)
  } catch (error) {
    console.error('[ChatPage] retry message failed:', error)
    applyRestoredSessionSummary(await loadMessagesAndRehydrate(props.sessionId))
  }
}

async function onMessageDelete(messageId: string) {
  if (isReadOnlySession.value) return
  if (!messageId) return
  try {
    messageStore.clearStreamingState()
    await sessionClient.deleteMessage(props.sessionId, messageId)
    applyRestoredSessionSummary(await loadMessagesAndRehydrate(props.sessionId))
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
    agentPlanStore.beginTurn(props.sessionId)
    messageStore.clearStreamingState()
    await sessionClient.retryMessage(props.sessionId, messageId)
  } catch (error) {
    console.error('[ChatPage] continue message failed:', error)
    applyRestoredSessionSummary(await loadMessagesAndRehydrate(props.sessionId))
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

async function onPendingInputSteer(itemId: string) {
  if (isReadOnlySession.value) return
  if (!isGenerating.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  try {
    await pendingInputStore.steerPendingInput(props.sessionId, itemId)
    agentPlanStore.beginTurn(props.sessionId)
  } catch (error) {
    console.error('[ChatPage] steer queued input failed:', error)
    toast({
      title: t('chat.pendingInput.steerFailed'),
      variant: 'destructive'
    })
  }
}

onMounted(() => {
  window.addEventListener('context-menu-ask-ai', handleContextMenuAskAI)
  window.addEventListener(
    WORKSPACE_EVENTS.INSERT_REFERENCE_REQUESTED,
    handleWorkspaceInsertReferenceRequested
  )
  window.addEventListener('keydown', handleWindowKeydown)
  cancelPlanUpdatedListener = chatClient.onPlanUpdated((payload) => {
    if (payload.sessionId === props.sessionId) {
      agentPlanStore.applySnapshot(payload)
    }
  })
  // 初始化滚动状态
  const el = scrollContainer.value
  if (el) {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottom.value = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD
  }
  observePlanFloatLayer()
  syncPlanFloatReservedHeight()
  void nextTick(async () => {
    await playChatInputHeroFlight(resolveChatInputBoxElement())
  })
})

onUnmounted(() => {
  removeModelConfigChangedListener()
  disconnectPlanFloatResizeObserver()
  cancelSessionRestoreScrollSettle()
  cancelPlanUpdatedListener?.()
  cancelPlanUpdatedListener = null
  voiceInput.cleanup()
  cancelSessionRestoreTask?.()
  cancelSessionRestoreTask = null
  window.removeEventListener('context-menu-ask-ai', handleContextMenuAskAI)
  window.removeEventListener(
    WORKSPACE_EVENTS.INSERT_REFERENCE_REQUESTED,
    handleWorkspaceInsertReferenceRequested
  )
  window.removeEventListener('keydown', handleWindowKeydown)
  clearChatSearchHighlights(messageSearchRoot.value)
  if (spotlightJumpTimer) {
    window.clearTimeout(spotlightJumpTimer)
    spotlightJumpTimer = null
  }
  if (anchorRestoreFrame !== null) {
    window.cancelAnimationFrame(anchorRestoreFrame)
    anchorRestoreFrame = null
  }
  if (scrollReadFrame !== null) {
    window.cancelAnimationFrame(scrollReadFrame)
    scrollReadFrame = null
  }
  cancelScheduledChatSearchRefresh()
  pendingInputStore.clear()
})
</script>

<style>
.message-list-container {
  scrollbar-gutter: stable both-edges;
  will-change: scroll-position;
  overscroll-behavior: contain;
  scroll-behavior: auto;
}

/* 流式生成时，最后一行始终渲染以保证流式流畅 */
[data-generating='true'] .message-list-row:last-child {
  content-visibility: visible;
}

.agent-question-panel {
  isolation: isolate;
  border: 1px solid transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 78%, hsl(var(--background)) 22%) 0%,
    color-mix(in srgb, white 58%, hsl(var(--background)) 42%) 100%
  );
  box-shadow:
    0 20px 40px -30px rgb(15 23 42 / 0.2),
    0 8px 18px -18px rgb(15 23 42 / 0.08),
    inset 0 1px 0 rgb(255 255 255 / 0.42),
    inset 0 -10px 20px -18px rgb(148 163 184 / 0.18);
}

.agent-question-panel::before {
  content: '';
  position: absolute;
  inset: 1px;
  z-index: 0;
  border-radius: inherit;
  pointer-events: none;
  background:
    linear-gradient(
      160deg,
      rgb(255 255 255 / 0.58) 0%,
      transparent 36%,
      rgb(255 255 255 / 0.12) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, white 88%, hsl(var(--background)) 12%) 0%,
      color-mix(in srgb, white 64%, hsl(var(--muted)) 36%) 100%
    );
  opacity: 0.92;
}

.agent-question-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 22%, hsl(var(--border)) 78%),
    inset 0 1px 0 rgb(255 255 255 / 0.24);
  opacity: 0.82;
}

.agent-question-panel > :not(.agent-question-panel__backdrop) {
  position: relative;
  z-index: 3;
}

.agent-question-panel__backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(
      circle at 12% 14%,
      color-mix(in srgb, white 78%, hsl(var(--primary)) 22%) 0%,
      transparent 34%
    ),
    radial-gradient(circle at 88% 12%, rgb(255 255 255 / 0.62) 0%, transparent 26%),
    radial-gradient(
      circle at 72% 100%,
      color-mix(in srgb, white 44%, hsl(var(--muted)) 56%) 0%,
      transparent 42%
    );
  filter: saturate(1.06);
  opacity: 0.92;
  pointer-events: none;
}

.agent-question-divider {
  position: relative;
  z-index: 3;
  height: 1px;
  margin: 0 1rem;
  background: color-mix(in srgb, white 30%, hsl(var(--border)) 70%);
}

.dark .agent-question-panel {
  border-color: transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, hsl(var(--background)) 88%, rgb(51 65 85) 12%) 0%,
    color-mix(in srgb, hsl(var(--background)) 94%, rgb(15 23 42) 6%) 100%
  );
  box-shadow:
    0 24px 48px -34px rgb(0 0 0 / 0.48),
    0 12px 24px -22px rgb(0 0 0 / 0.26),
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    inset 0 -14px 24px -22px rgb(0 0 0 / 0.36);
}

.dark .agent-question-panel::before {
  background:
    linear-gradient(
      160deg,
      rgb(255 255 255 / 0.12) 0%,
      transparent 40%,
      rgb(255 255 255 / 0.03) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, hsl(var(--background)) 82%, rgb(30 41 59) 18%) 0%,
      color-mix(in srgb, hsl(var(--background)) 92%, rgb(2 6 23) 8%) 100%
    );
  opacity: 0.88;
}

.dark .agent-question-panel::after {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 8%, hsl(var(--border)) 92%),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
  opacity: 0.74;
}

.dark .agent-question-panel__backdrop {
  background:
    radial-gradient(
      circle at 14% 16%,
      color-mix(in srgb, hsl(var(--primary)) 30%, white 70%) 0%,
      transparent 34%
    ),
    radial-gradient(circle at 88% 14%, rgb(255 255 255 / 0.12) 0%, transparent 24%),
    radial-gradient(circle at 78% 100%, rgb(15 23 42 / 0.42) 0%, transparent 42%);
  filter: saturate(1.08);
  opacity: 0.84;
}

.dark .agent-question-divider {
  background: color-mix(in srgb, white 8%, hsl(var(--border)) 92%);
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
