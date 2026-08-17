<template>
  <div data-testid="chat-message-list" class="chat-message-list w-full min-w-0">
    <div class="mx-auto w-full max-w-5xl px-6 py-6">
      <div data-message-window-origin aria-hidden="true" class="h-0 w-full" />
      <div
        v-if="beforeSpacerHeight > 0"
        aria-hidden="true"
        :style="{ height: `${beforeSpacerHeight}px` }"
      />
      <MessageListRow
        v-for="item in allRenderedMessages"
        :key="item.renderKey ?? item.id"
        :item="item"
        :is-generating="isGenerating"
        :is-streaming-message="item.id === streamingMessageId"
        :show-trace="traceMessageIdSet.has(item.id)"
        :is-capturing="isCapturingValue"
        :is-read-only="isReadOnly"
        :allow-guard-stop-continue="item.id === latestAssistantMessageId"
        :disable-markdown-virtualization="shouldDisableMarkdownVirtualization"
        :class="{ 'message-row-entrance': shouldAnimateEntrance(item) }"
        :data-entrance-feedback="shouldAnimateEntrance(item) || undefined"
        @animationend="onEntranceAnimationEnd(item, $event)"
        @retry="onRetry"
        @delete="onDelete"
        @fork="onFork"
        @continue="onContinue"
        @trace="onTrace"
        @tape-inspector="onTapeInspector"
        @edit-save="onEditSave"
        @copy-image="handleCopyImage"
        @measure="onMeasure"
      />
      <div
        v-if="afterSpacerHeight > 0"
        aria-hidden="true"
        :style="{ height: `${afterSpacerHeight}px` }"
      />

      <div v-if="ephemeralRateLimitBlock" data-rate-limit-indicator="true" class="pl-11 pr-11 pt-1">
        <MessageBlockAction
          :message-id="ephemeralRateLimitMessageId || '__rate_limit__'"
          :conversation-id="conversationId"
          :block="ephemeralRateLimitBlock"
          :is-read-only="isReadOnly"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, unref, watch } from 'vue'
import MessageBlockAction from '@/components/message/MessageBlockAction.vue'
import { useMessageCapture } from '@/composables/message/useMessageCapture'
import {
  type DisplayAssistantMessageBlock,
  type DisplayMessage,
  type MessageListItem
} from '@/features/chat-page/model/displayMessage'
import MessageListRow from './MessageListRow.vue'

const props = withDefaults(
  defineProps<{
    messages: MessageListItem[]
    conversationId?: string
    ephemeralRateLimitBlock?: DisplayAssistantMessageBlock | null
    ephemeralRateLimitMessageId?: string | null
    isGenerating?: boolean
    streamingMessageId?: string | null
    traceMessageIds?: string[]
    isReadOnly?: boolean
    resolveCaptureParentId?: (messageId: string, parentId?: string) => string | undefined
    beforeSpacerHeight?: number
    afterSpacerHeight?: number
    disableMarkdownVirtualization?: boolean
    latestAssistantMessageId?: string | null
  }>(),
  {
    conversationId: '',
    ephemeralRateLimitBlock: null,
    ephemeralRateLimitMessageId: null,
    isGenerating: false,
    streamingMessageId: null,
    traceMessageIds: () => [],
    isReadOnly: false,
    beforeSpacerHeight: 0,
    afterSpacerHeight: 0,
    disableMarkdownVirtualization: false,
    latestAssistantMessageId: null
  }
)

const emit = defineEmits<{
  retry: [messageId: string]
  delete: [messageId: string]
  fork: [messageId: string]
  continue: [conversationId: string, messageId: string]
  trace: [messageId: string]
  tapeInspector: [messageId: string]
  editSave: [payload: { messageId: string; text: string }]
  measure: [payload: { messageId: string; height: number }]
}>()

const traceMessageIdSet = computed(() => new Set(props.traceMessageIds))
const { isCapturing, captureMessage } = useMessageCapture()
const isCapturingValue = computed(() => Boolean(unref(isCapturing)))
const shouldDisableMarkdownVirtualization = computed(
  () => props.disableMarkdownVirtualization || isCapturingValue.value
)
const allRenderedMessages = computed(() => props.messages)
const latestAssistantMessageId = computed(() => props.latestAssistantMessageId ?? null)
const seenMessageIds = new Set<string>()
const animatingMessageIds = ref(new Set<string>())

const resetEntranceTracking = (messages: MessageListItem[]) => {
  seenMessageIds.clear()
  animatingMessageIds.value.clear()
  for (const message of messages) {
    seenMessageIds.add(message.id)
  }
}

onMounted(() => resetEntranceTracking(props.messages))

watch(
  () => props.conversationId,
  () => resetEntranceTracking(props.messages)
)

watch(
  () => props.messages,
  (messages, previousMessages) => {
    if (!previousMessages) return

    const isAppend =
      messages.length >= previousMessages.length &&
      previousMessages.every((message, index) => messages[index]?.id === message.id)
    if (!isAppend) {
      resetEntranceTracking(messages)
      return
    }

    for (const message of messages.slice(previousMessages.length)) {
      if (seenMessageIds.has(message.id)) continue

      seenMessageIds.add(message.id)
      if (message.role === 'user' && message.id !== props.streamingMessageId) {
        animatingMessageIds.value.add(message.id)
      }
    }
  }
)

const shouldAnimateEntrance = (item: MessageListItem) => animatingMessageIds.value.has(item.id)

const onEntranceAnimationEnd = (item: MessageListItem, event: AnimationEvent) => {
  if (event.target === event.currentTarget) {
    animatingMessageIds.value.delete(item.id)
  }
}

const onRetry = (messageId: string) => emit('retry', messageId)
const onDelete = (messageId: string) => emit('delete', messageId)
const onFork = (messageId: string) => emit('fork', messageId)
const onContinue = (conversationId: string, messageId: string) =>
  emit('continue', conversationId, messageId)
const onTrace = (messageId: string) => emit('trace', messageId)
const onTapeInspector = (messageId: string) => emit('tapeInspector', messageId)
const onEditSave = (payload: { messageId: string; text: string }) => emit('editSave', payload)
const onMeasure = (payload: { messageId: string; height: number }) => emit('measure', payload)

const resolveVisibleCaptureParentId = (
  messageId: string,
  parentId?: string
): string | undefined => {
  if (parentId) {
    const parentMessage = props.messages.find((msg) => msg.id === parentId)
    if (parentMessage?.role === 'user') return parentId
  }
  const messageIndex = props.messages.findIndex((msg) => msg.id === messageId)
  if (messageIndex <= 0) return undefined
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const candidate = props.messages[index] as DisplayMessage
    if (candidate.role === 'user') return candidate.id
  }
  return undefined
}

const handleCopyImage = async (
  messageId: string,
  parentId: string | undefined,
  fromTop: boolean,
  modelInfo: { model_name: string; model_provider: string }
) => {
  const resolvedParentId = props.resolveCaptureParentId
    ? props.resolveCaptureParentId(messageId, parentId)
    : resolveVisibleCaptureParentId(messageId, parentId)
  await captureMessage({ messageId, parentId: resolvedParentId, fromTop, modelInfo })
}
</script>

<style scoped>
.message-row-entrance {
  animation: message-row-in 140ms var(--dc-ease-out-soft);
}

@keyframes message-row-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .message-row-entrance {
    animation: none;
  }
}
</style>
