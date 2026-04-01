<template>
  <TooltipProvider :delay-duration="200">
    <div
      ref="scrollContainer"
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
      <MessageList
        :messages="displayMessages"
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
          <PendingInputLane
            :steer-items="pendingInputStore.steerItems"
            :queue-items="pendingInputStore.queueItems"
            :disable-steer-action="pendingInputStore.isAtCapacity"
            :show-resume-queue="showResumePendingQueue"
            class="mb-1.5"
            @update-queue="onPendingInputUpdate"
            @move-queue="onPendingInputMove"
            @convert-queue-to-steer="onPendingInputConvert"
            @delete-queue="onPendingInputDelete"
            @resume-queue="onResumePendingQueue"
          />
          <template v-if="!activePendingInteraction">
            <ChatInputBox
              ref="chatInputRef"
              v-model="message"
              max-width-class="max-w-4xl"
              :files="attachedFiles"
              :session-id="props.sessionId"
              :workspace-path="sessionStore.activeSession?.projectDir ?? null"
              :is-acp-session="sessionStore.activeSession?.providerId === 'acp'"
              :submit-disabled="isInputSubmitDisabled"
              @update:files="onFilesChange"
              @command-submit="onCommandSubmit"
              @submit="onSubmit"
            >
              <template #toolbar>
                <ChatInputToolbar
                  :is-generating="isGenerating"
                  :has-input="hasDraftInput"
                  :send-disabled="isQueueSubmitDisabled"
                  @attach="onAttach"
                  @send="onSubmit"
                  @stop="onStop"
                />
              </template>
            </ChatInputBox>
            <ChatStatusBar max-width-class="max-w-4xl" />
          </template>
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import ChatTopBar from '@/components/chat/ChatTopBar.vue'
import ChatSearchBar from '@/components/chat/ChatSearchBar.vue'
import MessageList from '@/components/chat/MessageList.vue'
import type {
  DisplayAssistantMessageBlock,
  DisplayMessage,
  DisplayMessageUsage,
  DisplayUserMessageContent
} from '@/components/chat/messageListItems'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import ChatInputToolbar from '@/components/chat/ChatInputToolbar.vue'
import PendingInputLane from '@/components/chat/PendingInputLane.vue'
import ChatStatusBar from '@/components/chat/ChatStatusBar.vue'
import ChatToolInteractionOverlay from '@/components/chat/ChatToolInteractionOverlay.vue'
import TraceDialog from '@/components/trace/TraceDialog.vue'
import { useSessionStore } from '@/stores/ui/session'
import { useMessageStore } from '@/stores/ui/message'
import { usePendingInputStore } from '@/stores/ui/pendingInput'
import { useModelStore } from '@/stores/modelStore'
import { usePresenter } from '@/composables/usePresenter'
import {
  applyChatSearchHighlights,
  clearChatSearchHighlights,
  setActiveChatSearchMatch,
  type ChatSearchMatch
} from '@/lib/chatSearch'
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
const modelStore = useModelStore()
const newAgentPresenter = usePresenter('newAgentPresenter')
const { t } = useI18n()

const sessionTitle = computed(() => sessionStore.activeSession?.title ?? t('common.newChat'))
const sessionProject = computed(() => sessionStore.activeSession?.projectDir ?? '')
const isReadOnlySession = computed(() => sessionStore.activeSession?.sessionKind === 'subagent')
const isGenerating = computed(
  () => sessionStore.activeSession?.status === 'working' || messageStore.isStreaming
)
const isAcpWorkdirMissing = computed(() => {
  const activeSession = sessionStore.activeSession
  if (!activeSession || activeSession.providerId !== 'acp') {
    return false
  }
  return !activeSession.projectDir?.trim()
})

// --- Auto-scroll ---
const scrollContainer = ref<HTMLDivElement>()
// Track whether user is near the bottom; if they scroll up, stop auto-following
const isNearBottom = ref(true)
const NEAR_BOTTOM_THRESHOLD = 80 // px
const traceMessageId = ref<string | null>(null)
const isChatSearchOpen = ref(false)
const chatSearchQuery = ref('')
const chatSearchMatches = ref<ChatSearchMatch[]>([])
const activeChatSearchIndex = ref(0)
const chatSearchBarRef = ref<{
  focusInput: () => void
  selectInput: () => void
} | null>(null)

function scrollToBottom() {
  const el = scrollContainer.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function onScroll() {
  const el = scrollContainer.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isNearBottom.value = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD
}

// Load messages when sessionId changes, then scroll to bottom
watch(
  () => props.sessionId,
  async (id) => {
    clearChatSearchState()
    if (id) {
      await Promise.all([messageStore.loadMessages(id), pendingInputStore.loadPendingInputs(id)])
      await nextTick()
      scrollToBottom()
      return
    }
    pendingInputStore.clear()
  },
  { immediate: true }
)

function parseUserMessageContent(record: ChatMessageRecord): DisplayUserMessageContent {
  try {
    const parsed = JSON.parse(record.content) as DisplayUserMessageContent
    if (parsed && typeof parsed === 'object') {
      return {
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
    }
  } catch {}

  return {
    text: '',
    files: [],
    links: [],
    search: false,
    think: false
  }
}

function parseAssistantMessageContent(record: ChatMessageRecord): DisplayAssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(record.content) as DisplayAssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseMessageMetadata(record: ChatMessageRecord): MessageMetadata {
  try {
    const parsed = JSON.parse(record.metadata) as MessageMetadata
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

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
  const metadata = parseMessageMetadata(record)
  const modelId = metadata.model || sessionStore.activeSession?.modelId || ''
  const providerId = metadata.provider || sessionStore.activeSession?.providerId || ''
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

  if (record.role === 'assistant') {
    return {
      ...baseMessage,
      role: 'assistant',
      content: parseAssistantMessageContent(record)
    }
  }

  return {
    ...baseMessage,
    role: 'user',
    content: parseUserMessageContent(record)
  }
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
  return messageStore.messages.some((msg) => msg.id === messageId)
})

const displayMessages = computed(() => {
  const msgs: DisplayMessage[] = messageStore.messages.map(toDisplayMessage)

  // Fallback to a virtual streaming message only when target assistant message
  // is not yet available in messageStore.
  if (
    messageStore.isStreaming &&
    messageStore.streamingBlocks.length > 0 &&
    !hasInlineStreamingTarget.value
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
  displayMessages,
  () => {
    if (isNearBottom.value) {
      nextTick(scrollToBottom)
    }
  },
  { deep: true }
)

async function refreshChatSearchHighlights() {
  if (!isChatSearchOpen.value) {
    return
  }

  await nextTick()

  const root = scrollContainer.value
  chatSearchMatches.value = applyChatSearchHighlights(root, chatSearchQuery.value)

  if (chatSearchMatches.value.length === 0) {
    activeChatSearchIndex.value = 0
    return
  }

  const nextIndex = Math.min(activeChatSearchIndex.value, chatSearchMatches.value.length - 1)
  activeChatSearchIndex.value = nextIndex
  setActiveChatSearchMatch(chatSearchMatches.value, nextIndex, { behavior: 'auto' })
}

function focusChatSearchInput() {
  nextTick(() => {
    chatSearchBarRef.value?.selectInput()
  })
}

function clearChatSearchState() {
  clearChatSearchHighlights(scrollContainer.value)
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
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
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
  void refreshChatSearchHighlights()
})

watch(
  displayMessages,
  () => {
    if (!isChatSearchOpen.value) {
      return
    }

    void refreshChatSearchHighlights()
  },
  { deep: true }
)

const message = ref('')
const attachedFiles = ref<MessageFile[]>([])
const chatInputRef = ref<{ triggerAttach: () => void } | null>(null)
const isHandlingInteraction = ref(false)

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

function parseAssistantBlocks(content: string): AssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(content) as AssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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
    const blocks = parseAssistantBlocks(message.content)

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

    return parseAssistantBlocks(message.content).some(
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
    pendingInputStore.isAtCapacity ||
    !hasDraftInput.value
)
const showResumePendingQueue = computed(
  () =>
    !isGenerating.value &&
    !activePendingInteraction.value &&
    !isAwaitingToolQuestionFollowUp.value &&
    pendingInputStore.queueItems.length > 0
)

async function onSubmit() {
  if (isReadOnlySession.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const text = message.value.trim()
  const files = [...attachedFiles.value]
  if (!text && files.length === 0) return
  await pendingInputStore.queueInput(props.sessionId, { text, files })
  message.value = ''
  attachedFiles.value = []
}

async function onCommandSubmit(command: string) {
  if (isReadOnlySession.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const text = command.trim()
  if (!text) return

  const files = [...attachedFiles.value]
  await pendingInputStore.queueInput(props.sessionId, { text, files })
  attachedFiles.value = []
}

function onAttach() {
  chatInputRef.value?.triggerAttach()
}

function onFilesChange(files: MessageFile[]) {
  attachedFiles.value = files
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
    await newAgentPresenter.respondToolInteraction(
      interaction.sessionId,
      interaction.messageId,
      interaction.toolCallId,
      response
    )
    await messageStore.loadMessages(props.sessionId)
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
    await newAgentPresenter.cancelGeneration(props.sessionId)
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
    await newAgentPresenter.retryMessage(props.sessionId, messageId)
  } catch (error) {
    console.error('[ChatPage] retry message failed:', error)
    await messageStore.loadMessages(props.sessionId)
  }
}

async function onMessageDelete(messageId: string) {
  if (isReadOnlySession.value) return
  if (!messageId) return
  try {
    messageStore.clearStreamingState()
    await newAgentPresenter.deleteMessage(props.sessionId, messageId)
    await messageStore.loadMessages(props.sessionId)
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
    await newAgentPresenter.editUserMessage(props.sessionId, messageId, text)
    await onMessageRetry(messageId)
  } catch (error) {
    console.error('[ChatPage] edit message failed:', error)
  }
}

async function onMessageFork(messageId: string) {
  if (isReadOnlySession.value) return
  if (!messageId) return
  try {
    const forked = await newAgentPresenter.forkSession(props.sessionId, messageId)
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
    await newAgentPresenter.retryMessage(props.sessionId, messageId)
  } catch (error) {
    console.error('[ChatPage] continue message failed:', error)
    await messageStore.loadMessages(props.sessionId)
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

async function onPendingInputConvert(itemId: string) {
  if (isReadOnlySession.value) return
  await pendingInputStore.convertToSteer(props.sessionId, itemId)
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
})

onUnmounted(() => {
  window.removeEventListener('context-menu-ask-ai', handleContextMenuAskAI)
  window.removeEventListener('keydown', handleWindowKeydown)
  clearChatSearchHighlights(scrollContainer.value)
  pendingInputStore.clear()
})
</script>

<style>
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
