<template>
  <TooltipProvider :delay-duration="200">
    <div
      ref="scrollContainer"
      class="h-full overflow-y-auto message-list-container"
      @scroll="onScroll"
    >
      <ChatTopBar class="chat-capture-hide" :title="sessionTitle" :project="sessionProject" />
      <MessageList
        :messages="displayMessages"
        :is-generating="isGenerating"
        :trace-message-ids="traceMessageIds"
        @retry="onMessageRetry"
        @delete="onMessageDelete"
        @fork="onMessageFork"
        @trace="onMessageTrace"
        @edit-save="onMessageEditSave"
      />

      <!-- Input area (sticky bottom, messages scroll under) -->
      <div class="sticky bottom-0 z-10 px-6 pt-3 pb-3 chat-capture-hide">
        <div class="flex flex-col items-center w-full">
          <ChatToolInteractionOverlay
            v-if="activePendingInteraction"
            :interaction="activePendingInteraction"
            :processing="isHandlingInteraction"
            @respond="onToolInteractionRespond"
          />
          <template v-else>
            <ChatInputBox
              v-model="message"
              :session-id="props.sessionId"
              :workspace-path="sessionStore.activeSession?.projectDir ?? null"
              :is-acp-session="sessionStore.activeSession?.providerId === 'acp'"
              :submit-disabled="isInputSubmitDisabled"
              @command-submit="onCommandSubmit"
              @submit="onSubmit"
            >
              <template #toolbar>
                <ChatInputToolbar
                  :is-generating="isGenerating"
                  :send-disabled="isAcpWorkdirMissing"
                  @send="onSubmit"
                  @stop="onStop"
                />
              </template>
            </ChatInputBox>
            <ChatStatusBar />
          </template>
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import ChatTopBar from '@/components/chat/ChatTopBar.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import ChatInputToolbar from '@/components/chat/ChatInputToolbar.vue'
import ChatStatusBar from '@/components/chat/ChatStatusBar.vue'
import ChatToolInteractionOverlay from '@/components/chat/ChatToolInteractionOverlay.vue'
import { useSessionStore } from '@/stores/ui/session'
import { useMessageStore } from '@/stores/ui/message'
import { useModelStore } from '@/stores/modelStore'
import { usePresenter } from '@/composables/usePresenter'
import type { Message } from '@shared/chat'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageMetadata,
  ToolInteractionResponse
} from '@shared/types/agent-interface'

const props = defineProps<{
  sessionId: string
}>()

const sessionStore = useSessionStore()
const messageStore = useMessageStore()
const modelStore = useModelStore()
const newAgentPresenter = usePresenter('newAgentPresenter')

const sessionTitle = computed(() => sessionStore.activeSession?.title ?? 'New Chat')
const sessionProject = computed(() => sessionStore.activeSession?.projectDir ?? '')
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
const isInputSubmitDisabled = computed(() => isAcpWorkdirMissing.value || isGenerating.value)

// --- Auto-scroll ---
const scrollContainer = ref<HTMLDivElement>()
// Track whether user is near the bottom; if they scroll up, stop auto-following
const isNearBottom = ref(true)
const NEAR_BOTTOM_THRESHOLD = 80 // px

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
    if (id) {
      await messageStore.loadMessages(id)
      await nextTick()
      scrollToBottom()
    }
  },
  { immediate: true }
)

// Map ChatMessageRecord → old Message format for MessageList
function parseMessageContent(record: ChatMessageRecord): Message['content'] {
  try {
    return JSON.parse(record.content) as Message['content']
  } catch {
    if (record.role === 'assistant') {
      return []
    }
    return {
      text: '',
      files: [],
      links: [],
      search: false,
      think: false
    }
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

function buildUsage(metadata: MessageMetadata): Message['usage'] {
  return {
    context_usage: 0,
    tokens_per_second: metadata.tokensPerSecond ?? 0,
    total_tokens: metadata.totalTokens ?? 0,
    generation_time: metadata.generationTime ?? 0,
    first_token_time: metadata.firstTokenTime ?? 0,
    reasoning_start_time: 0,
    reasoning_end_time: 0,
    input_tokens: metadata.inputTokens ?? 0,
    output_tokens: metadata.outputTokens ?? 0
  }
}

function toDisplayMessage(record: ChatMessageRecord): Message {
  const metadata = parseMessageMetadata(record)
  const modelId = metadata.model || sessionStore.activeSession?.modelId || ''
  const providerId = metadata.provider || sessionStore.activeSession?.providerId || ''
  const modelName = record.role === 'assistant' ? resolveAssistantModelName(modelId) : ''

  return {
    id: record.id,
    content: parseMessageContent(record),
    role: record.role,
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
    is_variant: 0
  }
}

// Build a streaming assistant message from live blocks
function toStreamingMessage(blocks: AssistantMessageBlock[], messageId?: string | null): Message {
  const modelId = sessionStore.activeSession?.modelId ?? ''
  return {
    id: messageId ? `__streaming__:${messageId}` : '__streaming__',
    content: blocks,
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
    is_variant: 0
  }
}

const hasInlineStreamingTarget = computed(() => {
  const messageId = messageStore.currentStreamMessageId
  if (!messageId) return false
  return messageStore.messages.some((msg) => msg.id === messageId)
})

const displayMessages = computed(() => {
  const msgs = messageStore.messages.map(toDisplayMessage)

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

const traceMessageIds = computed(() => [] as string[])

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

const message = ref('')
const isHandlingInteraction = ref(false)

type PendingInteractionView = {
  messageId: string
  toolCallId: string
  actionType: 'question_request' | 'tool_call_permission'
  toolName: string
  toolArgs: string
  block: AssistantMessageBlock
}

function parseAssistantBlocks(content: string): AssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(content) as AssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
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
        messageId: message.id,
        toolCallId,
        actionType: block.action_type,
        toolName: block.tool_call?.name || '',
        toolArgs: block.tool_call?.params || '',
        block
      })
    }
  }

  return list
})

const activePendingInteraction = computed(() => pendingInteractions.value[0] ?? null)

async function onSubmit() {
  if (isGenerating.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const text = message.value.trim()
  if (!text) return
  message.value = ''
  messageStore.addOptimisticUserMessage(props.sessionId, text)
  await sessionStore.sendMessage(props.sessionId, text)
}

async function onCommandSubmit(command: string) {
  if (isGenerating.value) return
  if (isAcpWorkdirMissing.value) return
  if (activePendingInteraction.value || isHandlingInteraction.value) return
  const text = command.trim()
  if (!text) return

  messageStore.addOptimisticUserMessage(props.sessionId, text)
  await sessionStore.sendMessage(props.sessionId, text)
}

async function onToolInteractionRespond(response: ToolInteractionResponse) {
  const interaction = activePendingInteraction.value
  if (!interaction || isHandlingInteraction.value) {
    return
  }

  isHandlingInteraction.value = true
  try {
    await newAgentPresenter.respondToolInteraction(
      props.sessionId,
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
  if (!isGenerating.value) return
  try {
    await newAgentPresenter.cancelGeneration(props.sessionId)
  } catch (error) {
    console.error('[ChatPage] cancel generation failed:', error)
  }
}

async function onMessageRetry(messageId: string) {
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
  if (!messageId) return
  try {
    const forked = await newAgentPresenter.forkSession(props.sessionId, messageId)
    await sessionStore.fetchSessions()
    await sessionStore.selectSession(forked.id)
  } catch (error) {
    console.error('[ChatPage] fork session failed:', error)
  }
}

function onMessageTrace(messageId: string) {
  console.warn('[ChatPage] trace not implemented yet for new flow:', messageId)
}
</script>
