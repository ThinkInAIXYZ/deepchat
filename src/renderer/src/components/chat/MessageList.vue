<template>
  <div data-testid="chat-message-list" class="chat-message-list w-full min-w-0">
    <div class="mx-auto w-full max-w-5xl space-y-1 px-6 py-6">
      <MessageListRow
        v-for="item in allRenderedMessages"
        :key="item.id"
        :item="item"
        :is-generating="isGenerating"
        :show-trace="traceMessageIdSet.has(item.id)"
        :is-capturing="isCapturing"
        :is-read-only="isReadOnly"
        @retry="onRetry"
        @delete="onDelete"
        @fork="onFork"
        @continue="onContinue"
        @trace="onTrace"
        @edit-save="onEditSave"
        @copy-image="handleCopyImage"
        @measure="onMeasure"
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
import { computed } from 'vue'
import MessageBlockAction from '@/components/message/MessageBlockAction.vue'
import { useMessageCapture } from '@/composables/message/useMessageCapture'
import {
  type DisplayAssistantMessageBlock,
  type DisplayMessage,
  type MessageListItem
} from './messageListItems'
import MessageListRow from './MessageListRow.vue'

const props = withDefaults(
  defineProps<{
    messages: MessageListItem[]
    conversationId?: string
    ephemeralRateLimitBlock?: DisplayAssistantMessageBlock | null
    ephemeralRateLimitMessageId?: string | null
    isGenerating?: boolean
    traceMessageIds?: string[]
    isReadOnly?: boolean
  }>(),
  {
    conversationId: '',
    ephemeralRateLimitBlock: null,
    ephemeralRateLimitMessageId: null,
    isGenerating: false,
    traceMessageIds: () => [],
    isReadOnly: false
  }
)

const emit = defineEmits<{
  retry: [messageId: string]
  delete: [messageId: string]
  fork: [messageId: string]
  continue: [conversationId: string, messageId: string]
  trace: [messageId: string]
  editSave: [payload: { messageId: string; text: string }]
  measure: [payload: { messageId: string; height: number }]
}>()

const traceMessageIdSet = computed(() => new Set(props.traceMessageIds))
const allRenderedMessages = computed(() => props.messages)
const displayMessages = computed(() => allRenderedMessages.value)
const { isCapturing, captureMessage } = useMessageCapture()

const onRetry = (messageId: string) => emit('retry', messageId)
const onDelete = (messageId: string) => emit('delete', messageId)
const onFork = (messageId: string) => emit('fork', messageId)
const onContinue = (conversationId: string, messageId: string) =>
  emit('continue', conversationId, messageId)
const onTrace = (messageId: string) => emit('trace', messageId)
const onEditSave = (payload: { messageId: string; text: string }) => emit('editSave', payload)
const onMeasure = (payload: { messageId: string; height: number }) => emit('measure', payload)

const resolveCaptureParentId = (messageId: string, parentId?: string): string | undefined => {
  const messageItems = displayMessages.value
  if (parentId) {
    const parentMessage = messageItems.find((msg) => msg.id === parentId)
    if (parentMessage?.role === 'user') return parentId
  }
  const messageIndex = messageItems.findIndex((msg) => msg.id === messageId)
  if (messageIndex <= 0) return undefined
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const candidate = messageItems[index] as DisplayMessage
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
  const resolvedParentId = resolveCaptureParentId(messageId, parentId)
  await captureMessage({ messageId, parentId: resolvedParentId, fromTop, modelInfo })
}
</script>
