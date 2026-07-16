<template>
  <TooltipProvider :delay-duration="200">
    <div
      data-testid="chat-page-shell"
      :data-generating="String(isGenerating)"
      class="chat-page-shell relative grid h-full min-h-0 w-full min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
    >
      <ChatTopBar
        class="chat-capture-hide"
        :session-id="props.sessionId"
        :title="sessionTitle"
        :project="sessionProject"
        :is-read-only="isReadOnlySession"
      />
      <div
        v-if="isChatSearchOpen"
        class="pointer-events-none absolute inset-x-0 top-3 px-6"
        style="z-index: var(--dc-z-float)"
      >
        <div class="mx-auto flex w-full max-w-5xl justify-end">
          <ChatSearchBar
            ref="chatSearchBarRef"
            v-model="chatSearchQuery"
            class="pointer-events-auto"
            :active-match="activeChatSearchIndex"
            :total-matches="chatSearchResults.length"
            @previous="goToPreviousChatSearchMatch"
            @next="goToNextChatSearchMatch"
            @close="closeChatSearch"
          />
        </div>
      </div>
      <div data-testid="chat-viewport-region" class="relative min-h-0 min-w-0">
        <div
          ref="scrollContainer"
          data-testid="chat-page"
          class="message-list-container relative h-full min-h-0 w-full min-w-0 overflow-y-auto"
          :class="{ 'dc-list-scrolling': isListScrolling }"
          @scroll.passive="onScroll"
          @scrollend.passive="listGestures.onListScrollEnd"
          @wheel.passive="onWheel"
          @touchstart.passive="listGestures.onListTouchStart"
          @touchmove.passive="listGestures.onListTouchMove"
          @touchend.passive="listGestures.onListTouchEnd"
          @touchcancel.passive="listGestures.onListTouchCancel"
          @pointerdown.passive="listGestures.onListPointerDown"
          @pointermove.passive="listGestures.onListPointerMove"
          @pointerup.passive="listGestures.onListPointerEnd"
          @pointercancel.passive="listGestures.onListPointerEnd"
        >
          <div ref="messageSearchRoot" class="min-h-full">
            <div
              v-if="messageStore.isLoadingHistory"
              data-testid="history-loading-indicator"
              class="pointer-events-none sticky top-14 z-10 h-0 overflow-visible px-6 text-center"
            >
              <span
                data-testid="history-loading-label"
                class="inline-flex rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm"
              >
                {{ t('common.loading') }}
              </span>
            </div>
            <MessageList
              ref="messageListRef"
              :messages="visibleDisplayMessages"
              :all-messages-for-capture="displayMessages"
              :before-spacer-height="messageWindowBeforeHeight"
              :after-spacer-height="messageWindowAfterHeight"
              :conversation-id="props.sessionId"
              :ephemeral-rate-limit-block="ephemeralRateLimitBlock"
              :ephemeral-rate-limit-message-id="ephemeralRateLimitMessageId"
              :is-generating="isGenerating"
              :trace-message-ids="traceMessageIds"
              :is-read-only="isReadOnlySession"
              :disable-markdown-virtualization="isChatSearchOpen"
              @retry="onMessageRetry"
              @delete="onMessageDelete"
              @fork="onMessageFork"
              @continue="onMessageContinue"
              @trace="onMessageTrace"
              @edit-save="onMessageEditSave"
              @measure="onMessageMeasure"
            />
            <div class="h-px w-full" aria-hidden="true" />
          </div>
        </div>
        <div
          v-if="isSessionViewPreparing"
          data-testid="chat-session-loading-overlay"
          class="pointer-events-none absolute inset-0 overflow-hidden bg-background"
          style="z-index: var(--dc-z-sticky)"
          role="status"
          aria-live="polite"
          aria-busy="true"
          :aria-label="t('common.loading')"
        >
          <ChatSessionSkeleton />
        </div>
      </div>
      <!-- Composer is outside message scroll geometry. -->
      <div
        v-if="!isReadOnlySession"
        data-testid="chat-composer-region"
        class="chat-capture-hide relative w-full px-6 pb-3 pt-3"
        style="z-index: var(--dc-z-sticky)"
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
                class="pointer-events-none absolute inset-x-0 bottom-[calc(100%+0.75rem)] flex w-full flex-col items-end gap-2"
                style="z-index: var(--dc-z-float)"
                data-testid="agent-progress-float-layer"
              >
                <!-- Both plan + question: unified glassmorphism panel -->
                <div
                  v-if="activePendingInteraction && latestPlanSnapshot"
                  class="agent-question-panel dc-overscroll-contain pointer-events-auto mx-auto max-h-[min(70vh,calc(100vh-12rem))] w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-[20px] text-foreground"
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
              <div
                ref="chatInputHeroHostRef"
                data-testid="chat-input-memory-host"
                class="mx-auto flex w-full max-w-4xl flex-col"
              >
                <!-- Keep input/status mounted during permission/question so TipTap draft, IME,
                     and StatusBar watchers are not torn down. Hide with v-show + inert. -->
                <div
                  v-show="!activePendingInteraction"
                  class="flex w-full flex-col"
                  :aria-hidden="activePendingInteraction ? 'true' : undefined"
                  :inert="activePendingInteraction ? true : undefined"
                >
                  <MemoryUpdateChip :visible="!activePendingInteraction" />
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <TraceDialog :message-id="traceMessageId" @close="traceMessageId = null" />
    <MemoryTurnDialog :read-only="isReadOnlySession" />
    <AlertDialog :open="showDeleteMessageDialog" @update:open="onDeleteMessageDialogOpenChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('dialog.deleteMessage.title') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('dialog.deleteMessage.description') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="cancelMessageDelete">
            {{ t('dialog.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction @click="confirmMessageDelete">
            {{ t('dialog.deleteMessage.confirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import ChatTopBar from '@/components/chat/ChatTopBar.vue'
import ChatSearchBar from '@/components/chat/ChatSearchBar.vue'
import ChatSessionSkeleton from '@/components/chat/ChatSessionSkeleton.vue'
import MessageList from '@/components/chat/MessageList.vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import ChatInputToolbar from '@/components/chat/ChatInputToolbar.vue'
import AgentProgressFloat from '@/components/chat/AgentProgressFloat.vue'
import PendingInputLane from '@/components/chat/PendingInputLane.vue'
import ChatStatusBar from '@/components/chat/ChatStatusBar.vue'
import ChatToolInteractionOverlay from '@/components/chat/ChatToolInteractionOverlay.vue'
import MemoryTurnDialog from '@/components/chat/MemoryTurnDialog.vue'
import MemoryUpdateChip from '@/components/chat/MemoryUpdateChip.vue'
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
import { clearChatSearchHighlights } from '@/lib/chatSearch'

import { WORKSPACE_EVENTS } from '@/events'
import { filterUnsupportedAudioAttachments } from '@/lib/audioInputSupport'
import { useSpeechRecognition } from '@/components/chat/composables/useSpeechRecognition'
import {
  useMessageWindow,
  type MessageMeasurementSnapshot
} from '@/composables/message/useMessageWindow'
import { recentMessageMeasurementCache } from '@/composables/message/recentMessageMeasurementCache'
import { useChatScrollController } from '@/composables/chat/useChatScrollController'
import { markChatSessionPerformance } from '@/composables/chat/chatSessionPerformance'
import { type ChatScrollReason, type ChatScrollTarget } from '@/composables/chat/chatScrollState'
import { playChatInputHeroFlight } from '@/lib/chatInputHero'
import { scheduleStartupDeferredTask } from '@/lib/startupDeferred'
import { usePlanFloatLifecycle } from './chat-page/usePlanFloatLifecycle'
import { useDisplayMessages } from './chat-page/useDisplayMessages'
import { useChatSearch } from './chat-page/useChatSearch'
import { useListGestures } from './chat-page/useListGestures'
import { useMessageVirtualization } from './chat-page/useMessageVirtualization'
import type {
  MessageFile,
  UserMessageInlineItem,
  SendMessageInput,
  ToolInteractionResponse
} from '@shared/types/agent-interface'

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
const isSessionViewCommitted = computed(
  () =>
    messageStore.currentSessionId === props.sessionId &&
    messageStore.committedSessionId === props.sessionId
)
const isSessionViewPreparing = computed(() =>
  Boolean(props.sessionId && !isSessionViewCommitted.value)
)
const isCurrentSessionStreaming = computed(
  () => messageStore.isStreaming && messageStore.currentStreamSessionId === props.sessionId
)

const sessionTitle = computed(() => sessionStore.activeSession?.title ?? t('common.newChat'))
const sessionProject = computed(() => sessionStore.activeSession?.projectDir ?? '')
const isReadOnlySession = computed(() => sessionStore.activeSession?.sessionKind === 'subagent')
const isGenerating = computed(
  () => sessionStore.activeSession?.status === 'working' || isCurrentSessionStreaming.value
)
const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'
const INITIAL_MESSAGE_RESTORE_COUNT = 100
const MESSAGE_WINDOWING_THRESHOLD = 160
const MESSAGE_INITIAL_WINDOW_COUNT = 90
const MESSAGE_WINDOW_OVERSCAN_PX = 2400
/** After the user stops scrolling, wait this long before resuming windowing/measure. */
const SCROLL_IDLE_MS = 140
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

async function loadMessagesForSession(sessionId: string, count?: number) {
  const restoredSession = await messageStore.loadMessages(sessionId, count)
  return restoredSession
}

async function restoreSessionMessages(id: string, requestId: number) {
  console.info(`[Startup][Renderer] ChatPage restoring session ${id}`)
  const pendingInputsPromise = pendingInputStore.loadPendingInputs(id)
  const restoredSession = await loadMessagesForSession(id, INITIAL_MESSAGE_RESTORE_COUNT)

  if (requestId !== sessionRestoreRequestId) {
    return
  }

  if (restoredSession !== null) {
    applyRestoredSessionSummary(restoredSession)
  }
  void pendingInputsPromise.then(() => {
    if (requestId === sessionRestoreRequestId) {
      markChatSessionPerformance('secondary-state-ready', id, chatScrollSessionEpoch)
    }
  })
}

// --- Auto-scroll ---
const scrollContainer = ref<HTMLDivElement | null>(null)
const messageSearchRoot = ref<HTMLDivElement | null>(null)
const chatInputHeroHostRef = ref<HTMLDivElement | null>(null)
let chatScrollSessionEpoch = 0

const chatScrollController = useChatScrollController({
  viewport: scrollContainer,
  canAutoFollow: () => uiSettingsStore.autoScrollEnabled,
  resolveMessageTop(messageId) {
    const container = scrollContainer.value
    const entry = messageWindow.getEntry(messageId)
    if (!container || !entry) return null
    const originTop = getMessageWindowOriginTop(container)
    return originTop === null ? null : originTop + entry.top
  },
  onCommitted() {
    const container = scrollContainer.value
    if (container) syncMessageViewportMetrics(container)
  }
})
const pendingDeleteMessageId = ref<string | null>(null)
const showDeleteMessageDialog = computed(() => Boolean(pendingDeleteMessageId.value))
const TOP_HISTORY_THRESHOLD = 80
const MESSAGE_JUMP_RETRY_INTERVAL = 80
const MESSAGE_HIGHLIGHT_DURATION = 2000
const MAX_MESSAGE_JUMP_RETRIES = 8
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
const traceMessageId = ref<string | null>(null)
let spotlightJumpTimer: number | null = null
let scrollReadFrame: number | null = null
let cancelSessionRestoreTask: (() => void) | null = null
let hasScheduledInitialSessionRestore = false
let cancelPlanUpdatedListener: (() => void) | null = null
// The immediate session watcher can call clearMessageWindowMeasurements before
// messageWindow exists; keep this no-op forward reference and rebind it to
// messageWindow.clearMeasurements after useMessageWindow is created below.
let clearMessageWindowMeasurements = () => {}
let captureMessageWindowMeasurements = (): MessageMeasurementSnapshot => ({})
let pendingMessageWindowMeasurements: MessageMeasurementSnapshot | null = null
let restoreMessageWindowMeasurements = (snapshot: MessageMeasurementSnapshot) => {
  pendingMessageWindowMeasurements = snapshot
}
// Rebound after useChatSearch is created below (it needs the message window, which
// is set up after the session-change watch that calls these on first run).
let clearChatSearchStateRef = () => {}
let cancelScheduledChatSearchRefreshRef = () => {}
let measurementSessionId = ''
let sessionRestoreRequestId = 0
let isChatPageActive = true
let handledCommittedSessionId: string | null = null
type HistoryLayoutAnchor = {
  messageId: string
  layoutTop: number
}
let viewportResizeObserver: ResizeObserver | null = null

const resolveChatInputBoxElement = () =>
  (chatInputHeroHostRef.value?.querySelector(
    '[data-testid="chat-input-box"]'
  ) as HTMLElement | null) ?? null

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

function messageIdSelector(messageId: string): string {
  const escapedMessageId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(messageId)
      : messageId.replace(/["\\]/g, '\\$&')
  return `[data-message-id="${escapedMessageId}"]`
}

function isBottomFollowingMode(): boolean {
  return (
    uiSettingsStore.autoScrollEnabled &&
    !chatScrollController.state.value.userOwned &&
    (chatScrollController.state.value.mode === 'restoring' ||
      chatScrollController.state.value.mode === 'following')
  )
}

function requestChatScroll(
  reason: ChatScrollReason,
  target: ChatScrollTarget,
  immediate = false
): number | null {
  const request = immediate ? chatScrollController.requestImmediate : chatScrollController.request
  return request({
    sessionEpoch: chatScrollSessionEpoch,
    reason,
    target
  })
}

function waitForNextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function getMessageWindowOriginTop(el: HTMLElement): number | null {
  const origin = messageSearchRoot.value?.querySelector<HTMLElement>('[data-message-window-origin]')
  if (!origin) return null

  const containerRect = el.getBoundingClientRect()
  const originRect = origin.getBoundingClientRect()
  return el.scrollTop + originRect.top - containerRect.top
}

function syncMessageViewportMetrics(el: HTMLElement | null | undefined = scrollContainer.value) {
  if (!el) {
    scrollViewportTop.value = 0
    scrollViewportHeight.value = 0
    messageWindowOriginTop.value = 0
    return
  }

  scrollViewportTop.value = el.scrollTop
  scrollViewportHeight.value = el.clientHeight
  const originTop = getMessageWindowOriginTop(el)
  if (originTop !== null) {
    messageWindowOriginTop.value = originTop
  }
}

function connectChatGeometryObserver(): void {
  viewportResizeObserver?.disconnect()
  viewportResizeObserver = null
  if (typeof ResizeObserver === 'undefined') return

  const viewport = scrollContainer.value
  const messageRoot = messageSearchRoot.value
  if (!viewport || !messageRoot) return

  viewportResizeObserver = new ResizeObserver(() => {
    const currentViewport = scrollContainer.value
    if (!currentViewport) return
    syncMessageViewportMetrics(currentViewport)
    chatScrollController.notifyViewportResize()
  })
  viewportResizeObserver.observe(viewport)
  viewportResizeObserver.observe(messageRoot)
}

function scrollDomToBottom(reason: ChatScrollReason): void {
  requestChatScroll(reason, { kind: 'bottom' })
}

function scrollToBottom(force = false, reason: ChatScrollReason = 'auto-follow') {
  if (!force && !isBottomFollowingMode()) {
    return
  }
  scrollDomToBottom(reason)
  if (force) scheduleScrollMetricsRead()
}

function schedulePostSubmitScrollToBottom() {
  void nextTick(() => {
    scrollToBottom(true, 'submit')
  })
}

function scheduleScrollMetricsRead() {
  if (scrollReadFrame !== null) return
  scrollReadFrame = window.requestAnimationFrame(() => {
    scrollReadFrame = null
    const el = scrollContainer.value
    if (!el) return

    syncMessageViewportMetrics(el)
  })
}

function onWheel(event: WheelEvent) {
  if (event.deltaY === 0) return
  chatScrollController.notifyUserGestureStart('wheel')
  listGestures.markWheelScrollIntent(event.deltaY < 0)
}

function onScroll() {
  const el = scrollContainer.value
  if (!el) return

  const source = chatScrollController.notifyViewportScroll()
  const userInitiatedScroll = source === 'user'
  const hadUpwardPaginationIntent =
    userInitiatedScroll && chatScrollController.state.value.userOwned

  scheduleScrollMetricsRead()
  if (userInitiatedScroll && chatScrollController.state.value.activeGesture) {
    listGestures.markListScrolling()
  }

  if (el.scrollTop <= TOP_HISTORY_THRESHOLD && hadUpwardPaginationIntent) {
    if (!listGestures.consumeUpwardPaginationIntent()) {
      return
    }
    if (chatScrollController.state.value.activeGesture || isListScrolling.value) {
      listGestures.armPendingHistoryLoadAtIdle()
    } else {
      void loadOlderMessagesAtTop()
    }
  }
}

async function loadOlderMessagesAtTop(): Promise<void> {
  if (chatScrollController.activeOperation.value?.reason === 'history-prepend') {
    return
  }
  if (
    messageStore.isLoadingHistory ||
    !messageStore.hasMoreHistory ||
    messageStore.messageIds.length < INITIAL_MESSAGE_RESTORE_COUNT
  ) {
    return
  }

  const el = scrollContainer.value
  if (!el) {
    return
  }
  if (el.scrollTop > TOP_HISTORY_THRESHOLD) {
    return
  }
  if (el.scrollHeight - el.clientHeight <= TOP_HISTORY_THRESHOLD) {
    return
  }

  const sessionId = props.sessionId
  const requestId = sessionRestoreRequestId
  const previousScrollHeight = el.scrollHeight
  const previousEntryCount = messageWindow.entries.value.length
  // Use a stable row in the virtual layout as the pagination anchor. DOM scrollHeight
  // is not stable here: prepending changes the virtual window before it changes the
  // viewport, so the old and new DOM can contain different rows with different
  // estimate errors.
  const firstExistingEntry = messageWindow.entries.value[0]
  const historyAnchor: HistoryLayoutAnchor | null = firstExistingEntry
    ? { messageId: firstExistingEntry.id, layoutTop: firstExistingEntry.top }
    : null
  const loadedCount = await messageStore.loadOlderMessages()
  if (loadedCount === 0 || props.sessionId !== sessionId || sessionRestoreRequestId !== requestId) {
    return
  }

  const container = scrollContainer.value
  if (!container) {
    return
  }
  const nextAnchorEntry = historyAnchor
    ? messageWindow.getEntry(historyAnchor.messageId)
    : undefined
  const usesWindowedMessages =
    previousEntryCount > MESSAGE_WINDOWING_THRESHOLD ||
    messageWindow.entries.value.length > MESSAGE_WINDOWING_THRESHOLD

  if (!usesWindowedMessages || !historyAnchor || !nextAnchorEntry) {
    await nextTick()
    if (props.sessionId !== sessionId || sessionRestoreRequestId !== requestId) {
      return
    }

    const updatedContainer = scrollContainer.value
    if (!updatedContainer) return

    // A short list renders every row, so its DOM height delta is exact and avoids
    // using estimated heights before media and rich content finish layout.
    requestChatScroll(
      'history-prepend',
      {
        kind: 'absolute',
        top: updatedContainer.scrollTop + (updatedContainer.scrollHeight - previousScrollHeight)
      },
      true
    )
    return
  }

  const layoutDelta = nextAnchorEntry.top - historyAnchor.layoutTop
  const targetScrollTop = container.scrollTop + layoutDelta

  // Point windowing at the post-prepend viewport before Vue commits the new DOM.
  // This avoids rendering the newly prepended top window for one frame and then
  // swapping back to the user's reading window after scroll compensation.
  scrollViewportTop.value = targetScrollTop
  scrollViewportHeight.value = container.clientHeight

  await nextTick()
  if (props.sessionId !== sessionId || sessionRestoreRequestId !== requestId) {
    return
  }

  const updatedContainer = scrollContainer.value
  if (!updatedContainer) return

  requestChatScroll('history-prepend', { kind: 'absolute', top: targetScrollTop }, true)
}

async function focusPendingSpotlightMessageJump(attempt = 0): Promise<void> {
  const pendingJump = spotlightStore.pendingMessageJump
  if (!pendingJump || pendingJump.sessionId !== props.sessionId) {
    return
  }

  await nextTick()

  const selector = messageIdSelector(pendingJump.messageId)
  const entry = messageWindow.getEntry(pendingJump.messageId)
  if (entry) {
    const requestId = requestChatScroll('spotlight-navigation', {
      kind: 'message',
      messageId: pendingJump.messageId,
      align: 'one-third'
    })
    if (requestId === null) return
    await waitForNextAnimationFrame()
    await nextTick()
  }

  const target = messageSearchRoot.value?.querySelector<HTMLElement>(selector)

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

  target.classList.add('message-highlight')

  window.setTimeout(() => {
    target.classList.remove('message-highlight')
  }, MESSAGE_HIGHLIGHT_DURATION)

  spotlightStore.clearPendingMessageJump()
}

function cacheCurrentMessageMeasurements(): void {
  if (!measurementSessionId) return
  recentMessageMeasurementCache.set(measurementSessionId, captureMessageWindowMeasurements())
}

// Load messages when sessionId changes, then scroll to bottom
watch(
  () => props.sessionId,
  async (id) => {
    handledCommittedSessionId = null
    if (measurementSessionId && measurementSessionId !== id) {
      cacheCurrentMessageMeasurements()
    }
    measurementSessionId = id
    listGestures.resetIntentForSessionChange()
    pendingDeleteMessageId.value = null
    clearChatSearchStateRef()
    resetDisplayMessagesForSessionChange()
    sessionRestoreRequestId += 1
    chatScrollSessionEpoch = chatScrollController.beginSession(id)
    markChatSessionPerformance('selected', id, chatScrollSessionEpoch)
    markChatSessionPerformance('preparation-started', id, chatScrollSessionEpoch)
    cancelSessionRestoreTask?.()
    cancelSessionRestoreTask = null
    clearMessageWindowMeasurements()
    const activatedFromCache = id ? (messageStore.activateRecentSessionView?.(id) ?? false) : false
    const cachedMeasurements = activatedFromCache ? recentMessageMeasurementCache.get(id) : null
    if (cachedMeasurements) {
      restoreMessageWindowMeasurements(cachedMeasurements)
    }
    messageStore.clearStreamingStateForOtherSession(id)
    if (activatedFromCache) {
      markChatSessionPerformance('cache-committed', id, chatScrollSessionEpoch)
    }
    pendingInputStore.clear()
    if (id) {
      const requestId = sessionRestoreRequestId
      const runRestore = () => restoreSessionMessages(id, requestId)
      if (!hasScheduledInitialSessionRestore) {
        hasScheduledInitialSessionRestore = true
        cancelSessionRestoreTask = scheduleStartupDeferredTask(runRestore)
      } else {
        void runRestore()
      }
      return
    }
  },
  { immediate: true }
)

watch(
  [() => props.sessionId, () => messageStore.committedSessionId],
  async ([id, committedSessionId]) => {
    if (!id || committedSessionId !== id || handledCommittedSessionId === id) {
      return
    }

    handledCommittedSessionId = id
    markChatSessionPerformance('messages-prepared', id, chatScrollSessionEpoch)
    markChatSessionPerformance('messages-committed', id, chatScrollSessionEpoch)
    if (messageStore.committedSession?.id === id) {
      applyRestoredSessionSummary(messageStore.committedSession)
    }

    await nextTick()
    if (
      props.sessionId !== id ||
      messageStore.currentSessionId !== id ||
      messageStore.committedSessionId !== id
    ) {
      return
    }

    window.requestAnimationFrame(() => {
      if (
        props.sessionId === id &&
        messageStore.currentSessionId === id &&
        messageStore.committedSessionId === id
      ) {
        markChatSessionPerformance('first-message-paint', id, chatScrollSessionEpoch)
      }
    })
    if (spotlightStore.pendingMessageJump?.sessionId === id) {
      void focusPendingSpotlightMessageJump()
      return
    }
    requestChatScroll('session-restore', { kind: 'bottom' })
  },
  { immediate: true, flush: 'post' }
)

const {
  displayMessages,
  ephemeralRateLimitBlock,
  ephemeralRateLimitMessageId,
  hasFirstStreamingContent,
  hasInlineStreamingTarget,
  pendingAssistantPlaceholder,
  createPendingAssistantPlaceholder,
  clearPendingAssistantPlaceholder,
  resetForSessionChange: resetDisplayMessagesForSessionChange
} = useDisplayMessages({
  sessionId: () => props.sessionId,
  messageStore,
  sessionStore,
  modelStore,
  isGenerating,
  isSessionViewCommitted,
  isCurrentSessionStreaming
})

const messageWindow = useMessageWindow({
  messages: displayMessages
})
clearMessageWindowMeasurements = messageWindow.clearMeasurements
captureMessageWindowMeasurements = messageWindow.captureMeasurements
restoreMessageWindowMeasurements = messageWindow.restoreMeasurements
if (pendingMessageWindowMeasurements) {
  restoreMessageWindowMeasurements(pendingMessageWindowMeasurements)
  pendingMessageWindowMeasurements = null
}

const listGestures = useListGestures({
  viewport: scrollContainer,
  scrollIdleMs: SCROLL_IDLE_MS,
  topHistoryThreshold: TOP_HISTORY_THRESHOLD,
  onGestureStart: (kind) => chatScrollController.notifyUserGestureStart(kind),
  onGestureEnd: () => chatScrollController.notifyUserGestureEnd(),
  onScrollingStart: () => virtualization.pinWindowToViewport(),
  onScrollingSettled: () => {
    const el = scrollContainer.value
    if (el) syncMessageViewportMetrics(el)
    virtualization.flushPendingMeasures()
  },
  onIdleHistoryLoad: () => {
    void loadOlderMessagesAtTop()
  }
})
const isListScrolling = listGestures.isListScrolling

const virtualization = useMessageVirtualization({
  viewport: scrollContainer,
  displayMessages,
  messageWindow,
  windowingThreshold: MESSAGE_WINDOWING_THRESHOLD,
  initialWindowCount: MESSAGE_INITIAL_WINDOW_COUNT,
  overscanPx: MESSAGE_WINDOW_OVERSCAN_PX,
  getWindowOriginTop: getMessageWindowOriginTop,
  isListScrolling,
  isBottomFollowingMode,
  scrollToBottom: (force) => scrollToBottom(Boolean(force)),
  requestAnchorScroll: (top) => {
    requestChatScroll('measurement-anchor', { kind: 'absolute', top }, true)
  },
  currentScrollMode: () => chatScrollController.state.value.mode
})
const {
  scrollViewportTop,
  scrollViewportHeight,
  messageWindowOriginTop,
  visibleDisplayMessages,
  messageWindowBeforeHeight,
  messageWindowAfterHeight,
  onMessageMeasure
} = virtualization

const {
  isChatSearchOpen,
  chatSearchQuery,
  activeChatSearchIndex,
  chatSearchBarRef,
  chatSearchResults,
  closeChatSearch,
  clearChatSearchState,
  goToNextChatSearchMatch,
  goToPreviousChatSearchMatch,
  handleSearchKeydown,
  cancelScheduledChatSearchRefresh
} = useChatSearch({
  messageSearchRoot,
  displayMessages,
  visibleDisplayMessages,
  hasWindowEntry: (messageId) => Boolean(messageWindow.getEntry(messageId)),
  requestChatScroll,
  waitForNextAnimationFrame
})
clearChatSearchStateRef = clearChatSearchState
cancelScheduledChatSearchRefreshRef = cancelScheduledChatSearchRefresh

const traceMessageIds = computed(() =>
  messageStore.messages
    .filter((msg) => msg.role === 'assistant' && (msg.traceCount ?? 0) > 0)
    .map((msg) => msg.id)
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

    if (chatScrollController.state.value.mode === 'restoring') {
      scrollToBottom(true)
    } else if (chatScrollController.state.value.mode === 'following') {
      scrollToBottom(false)
    } else {
      scheduleScrollMetricsRead()
    }
  },
  { flush: 'post' }
)

function handleWindowKeydown(event: KeyboardEvent) {
  if (isSessionRestoreKeyboardScrollIntent(event)) {
    listGestures.markKeyboardScrollIntent(
      event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home'
    )
  }

  handleSearchKeydown(event)
}

const message = ref('')
const attachedFiles = ref<MessageFile[]>([])
const chatInputRef = ref<{
  triggerAttach: () => void
  insertRecognizedText?: (text: string) => void
  insertWorkspaceReference?: (targetPath: string) => boolean
  getInlineItemsSnapshot?: () => UserMessageInlineItem[]
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

const {
  latestPlanSnapshot,
  isPlanFloatCollapsed,
  beginPlanTurn,
  clearPlanSnapshotForDeletedMessage,
  scheduleInactivePlanSnapshotClear,
  cancelAllPlanSnapshotClearTimers,
  onDismissPlanFloat
} = usePlanFloatLifecycle({
  sessionId: () => props.sessionId,
  agentPlanStore,
  sessionStore,
  isCurrentSessionStreaming,
  pendingInteractions
})

const hasInputText = computed(() => Boolean(message.value.trim()))
const hasAttachments = computed(() => attachedFiles.value.length > 0)
const hasDraftInput = computed(() => hasInputText.value || hasAttachments.value)
const isQueueSubmitDisabled = computed(
  () =>
    isSessionViewPreparing.value ||
    isAcpWorkdirMissing.value ||
    !hasDraftInput.value ||
    Boolean(activePendingInteraction.value) ||
    isHandlingInteraction.value ||
    pendingInputStore.isAtCapacity
)
const isInputSubmitDisabled = computed(
  () =>
    isSessionViewPreparing.value ||
    isAcpWorkdirMissing.value ||
    Boolean(activePendingInteraction.value) ||
    isHandlingInteraction.value ||
    (isGenerating.value && pendingInputStore.isAtCapacity) ||
    !hasDraftInput.value
)
const disableQueueSteerAction = computed(
  () =>
    isSessionViewPreparing.value ||
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

const getComposerInlineItemsSnapshot = (): UserMessageInlineItem[] => {
  return chatInputRef.value?.getInlineItemsSnapshot?.() ?? []
}

const withMessageSkills = (text: string, files: MessageFile[]) => {
  const activeSkills = getComposerSkillsSnapshot()
  const inlineItems = getComposerInlineItemsSnapshot()
  return {
    text,
    files,
    ...(activeSkills.length > 0 ? { activeSkills } : {}),
    ...(inlineItems.length > 0 ? { inlineItems } : {})
  }
}

function canWriteSessionView(sessionId: string, restoreRequestId: number): boolean {
  return (
    isChatPageActive &&
    sessionRestoreRequestId === restoreRequestId &&
    props.sessionId === sessionId &&
    messageStore.currentSessionId === sessionId &&
    messageStore.committedSessionId === sessionId
  )
}

function beginOutgoingTurnFeedback(sessionId: string, payload: SendMessageInput) {
  const optimisticUserMessageId = messageStore.addOptimisticUserMessage(sessionId, payload)
  if (!optimisticUserMessageId) return null

  const pendingAssistantPlaceholderId = createPendingAssistantPlaceholder(sessionId)
  beginPlanTurn(sessionId)
  return { optimisticUserMessageId, pendingAssistantPlaceholderId }
}

async function sendMessageWithOutgoingTurnFeedback(
  sessionId: string,
  payload: SendMessageInput,
  feedback: NonNullable<ReturnType<typeof beginOutgoingTurnFeedback>>
) {
  try {
    await chatClient.sendMessage(sessionId, payload)
  } catch (error) {
    clearPendingAssistantPlaceholder(feedback.pendingAssistantPlaceholderId)
    messageStore.removeOptimisticMessage(feedback.optimisticUserMessageId, sessionId)
    console.error('[ChatPage] send message failed:', error)
  }
}

async function onSubmit() {
  if (isReadOnlySession.value) return
  if (isSessionViewPreparing.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const sessionId = props.sessionId
  const restoreRequestId = sessionRestoreRequestId
  const text = message.value.trim()
  const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  if (!text && files.length === 0) return
  const handledCompaction = await handleManualCompactionCommand(text, sessionId, restoreRequestId)
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  if (handledCompaction) {
    if (!isGenerating.value) {
      message.value = ''
    }
    return
  }
  const payload = withMessageSkills(text, files)
  if (isGenerating.value) {
    await pendingInputStore.queueInput(sessionId, payload)
    if (!canWriteSessionView(sessionId, restoreRequestId)) return
    message.value = ''
    attachedFiles.value = []
    clearComposerSkills()
    schedulePostSubmitScrollToBottom()
  } else {
    const feedback = beginOutgoingTurnFeedback(sessionId, payload)
    if (!feedback) return
    message.value = ''
    attachedFiles.value = []
    clearComposerSkills()
    schedulePostSubmitScrollToBottom()
    await sendMessageWithOutgoingTurnFeedback(sessionId, payload, feedback)
  }
}

async function onCommandSubmit(command: string) {
  if (isReadOnlySession.value) return
  if (isSessionViewPreparing.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const sessionId = props.sessionId
  const restoreRequestId = sessionRestoreRequestId
  const text = command.trim()
  if (!text) return

  const handledCompaction = await handleManualCompactionCommand(text, sessionId, restoreRequestId)
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  if (handledCompaction) {
    return
  }

  const files = await prepareFilesForCurrentModel([...attachedFiles.value])
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  const payload = withMessageSkills(text, files)
  if (isGenerating.value) {
    await pendingInputStore.queueInput(sessionId, payload)
    if (!canWriteSessionView(sessionId, restoreRequestId)) return
    attachedFiles.value = []
    clearComposerSkills()
    schedulePostSubmitScrollToBottom()
    return
  }
  const feedback = beginOutgoingTurnFeedback(sessionId, payload)
  if (!feedback) return
  attachedFiles.value = []
  clearComposerSkills()
  schedulePostSubmitScrollToBottom()
  await sendMessageWithOutgoingTurnFeedback(sessionId, payload, feedback)
}

async function handleManualCompactionCommand(
  text: string,
  sessionId: string,
  restoreRequestId: number
): Promise<boolean> {
  if (!isManualCompactionCommand(text)) {
    return false
  }
  if (sessionStore.activeSession?.providerId === 'acp') {
    return false
  }
  if (isGenerating.value) {
    return true
  }
  if (!canWriteSessionView(sessionId, restoreRequestId)) {
    return true
  }

  try {
    const result = await sessionClient.compactSession(sessionId)
    if (!canWriteSessionView(sessionId, restoreRequestId)) return true
    const restoredSession = await loadMessagesForSession(sessionId)
    if (!canWriteSessionView(sessionId, restoreRequestId) || restoredSession === null) return true
    applyRestoredSessionSummary(restoredSession)
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
  if (isSessionViewPreparing.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const sessionId = props.sessionId
  const restoreRequestId = sessionRestoreRequestId
  const text = message.value.trim()
  const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  if (!text && files.length === 0) return
  const handledCompaction = await handleManualCompactionCommand(text, sessionId, restoreRequestId)
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  if (handledCompaction) {
    return
  }
  await pendingInputStore.queueInput(sessionId, withMessageSkills(text, files))
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  message.value = ''
  attachedFiles.value = []
  clearComposerSkills()
}

async function onSteer() {
  if (isReadOnlySession.value) return
  if (isSessionViewPreparing.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const sessionId = props.sessionId
  const restoreRequestId = sessionRestoreRequestId
  const text = message.value.trim()
  const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  if (!text && files.length === 0) return
  const handledCompaction = await handleManualCompactionCommand(text, sessionId, restoreRequestId)
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
  if (handledCompaction) {
    return
  }
  beginPlanTurn(sessionId)
  await chatClient.steerActiveTurn(sessionId, withMessageSkills(text, files))
  if (!canWriteSessionView(sessionId, restoreRequestId)) return
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
    applyRestoredSessionSummary(await loadMessagesForSession(props.sessionId))
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
    beginPlanTurn(props.sessionId)
    messageStore.clearStreamingState()
    await sessionClient.retryMessage(props.sessionId, messageId)
  } catch (error) {
    console.error('[ChatPage] retry message failed:', error)
    applyRestoredSessionSummary(await loadMessagesForSession(props.sessionId))
  }
}

async function onMessageDelete(messageId: string) {
  if (isReadOnlySession.value) return
  if (!messageId) return
  pendingDeleteMessageId.value = messageId
}

async function confirmMessageDelete() {
  const messageId = pendingDeleteMessageId.value
  if (!messageId) return
  if (isReadOnlySession.value) return
  const sessionId = props.sessionId
  pendingDeleteMessageId.value = null
  try {
    messageStore.clearStreamingState()
    await sessionClient.deleteMessage(sessionId, messageId)
    clearPlanSnapshotForDeletedMessage(sessionId, messageId)
    if (props.sessionId === sessionId) {
      applyRestoredSessionSummary(await loadMessagesForSession(sessionId))
    }
  } catch (error) {
    console.error('[ChatPage] delete message failed:', error)
  }
}

function cancelMessageDelete() {
  pendingDeleteMessageId.value = null
}

function onDeleteMessageDialogOpenChange(open: boolean) {
  if (!open) {
    cancelMessageDelete()
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
    beginPlanTurn(props.sessionId)
    messageStore.clearStreamingState()
    await sessionClient.retryMessage(props.sessionId, messageId)
  } catch (error) {
    console.error('[ChatPage] continue message failed:', error)
    applyRestoredSessionSummary(await loadMessagesForSession(props.sessionId))
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
    files: target.payload.files ?? [],
    activeSkills: target.payload.activeSkills ?? []
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
    beginPlanTurn(props.sessionId)
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
    agentPlanStore.applySnapshot(payload)
    scheduleInactivePlanSnapshotClear(payload.sessionId)
  })
  // 初始化滚动状态
  const el = scrollContainer.value
  if (el) {
    syncMessageViewportMetrics(el)
    chatScrollController.notifyViewportScroll()
  }
  connectChatGeometryObserver()
  void nextTick(async () => {
    markChatSessionPerformance('input-ready', props.sessionId, chatScrollSessionEpoch)
    await playChatInputHeroFlight(resolveChatInputBoxElement())
  })
})

onUnmounted(() => {
  isChatPageActive = false
  sessionRestoreRequestId += 1
  attachmentFilterToken += 1
  cacheCurrentMessageMeasurements()
  removeModelConfigChangedListener()
  cancelAllPlanSnapshotClearTimers()
  cancelPlanUpdatedListener?.()
  cancelPlanUpdatedListener = null
  cancelSessionRestoreTask?.()
  cancelSessionRestoreTask = null
  voiceInput.cleanup()
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
  chatScrollController.dispose()
  viewportResizeObserver?.disconnect()
  viewportResizeObserver = null
  if (scrollReadFrame !== null) {
    window.cancelAnimationFrame(scrollReadFrame)
    scrollReadFrame = null
  }
  listGestures.reset()
  virtualization.cancelPendingMeasureFlush()
  cancelScheduledChatSearchRefresh()
  pendingInputStore.clear()
})
</script>

<style>
.message-list-container {
  scrollbar-gutter: stable both-edges;
  /* Avoid will-change: scroll-position — it promotes a huge layer and hurts
     scroll performance with windowed message rows. */
  overscroll-behavior: contain;
  overflow-anchor: none;
  scroll-behavior: auto;
}

.agent-question-panel {
  isolation: isolate;
  border: 1px solid transparent;
  max-height: min(70vh, calc(100vh - 12rem));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  backdrop-filter: blur(var(--dc-blur-overlay));
  -webkit-backdrop-filter: blur(var(--dc-blur-overlay));
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
