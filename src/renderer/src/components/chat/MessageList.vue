<template>
  <div class="chat-message-list w-full min-w-0">
    <div class="mx-auto w-full max-w-5xl space-y-1 px-6 py-6">
      <template v-for="item in messages" :key="item.id">
        <div
          v-if="isCompactionMessageItem(item)"
          data-compaction-indicator="true"
          :data-compaction-status="item.compactionStatus ?? 'compacted'"
          class="compaction-divider"
        >
          <div class="compaction-divider__line" />
          <span
            class="compaction-divider__label"
            :class="{
              'compaction-divider__label--compacting': item.compactionStatus === 'compacting'
            }"
          >
            {{ getCompactionCopy(item.compactionStatus) }}
          </span>
          <div class="compaction-divider__line" />
        </div>
        <MessageItemUser
          v-else-if="item.role === 'user'"
          :message="item as DisplayUserMessage"
          :is-read-only="isReadOnly"
          @retry="onRetry"
          @delete="onDelete"
          @edit-save="onEditSave"
        />
        <MessageItemAssistant
          v-else-if="item.role === 'assistant'"
          :message="item as DisplayAssistantMessage"
          :use-legacy-actions="false"
          :is-in-generating-thread="isGenerating"
          :show-trace="traceMessageIdSet.has(item.id)"
          :is-capturing-image="isCapturing"
          :is-read-only="isReadOnly"
          @retry="onRetry"
          @delete="onDelete"
          @fork="onFork"
          @continue="onContinue"
          @trace="onTrace"
          @copy-image="handleCopyImage"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MessageItemAssistant from '@/components/message/MessageItemAssistant.vue'
import MessageItemUser from '@/components/message/MessageItemUser.vue'
import { useMessageCapture } from '@/composables/message/useMessageCapture'
import {
  type DisplayAssistantMessage,
  isCompactionMessageItem,
  type DisplayUserMessage,
  type DisplayMessage,
  type MessageListItem
} from './messageListItems'

const props = withDefaults(
  defineProps<{
    messages: MessageListItem[]
    isGenerating?: boolean
    traceMessageIds?: string[]
    isReadOnly?: boolean
  }>(),
  {
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
}>()

const { t } = useI18n()
const traceMessageIdSet = computed(() => new Set(props.traceMessageIds))
const displayMessages = computed(() =>
  props.messages.filter((item) => !isCompactionMessageItem(item))
)
const { isCapturing, captureMessage } = useMessageCapture()

const getCompactionCopy = (status?: 'compacting' | 'compacted'): string =>
  status === 'compacting' ? t('chat.compaction.compacting') : t('chat.compaction.compacted')

const onRetry = (messageId: string) => {
  emit('retry', messageId)
}

const onDelete = (messageId: string) => {
  emit('delete', messageId)
}

const onFork = (messageId: string) => {
  emit('fork', messageId)
}

const onContinue = (conversationId: string, messageId: string) => {
  emit('continue', conversationId, messageId)
}

const onTrace = (messageId: string) => {
  emit('trace', messageId)
}

const onEditSave = (payload: { messageId: string; text: string }) => {
  emit('editSave', payload)
}

const resolveCaptureParentId = (messageId: string, parentId?: string): string | undefined => {
  const messageItems = displayMessages.value
  if (parentId) {
    const parentMessage = messageItems.find((msg) => msg.id === parentId)
    if (parentMessage?.role === 'user') {
      return parentId
    }
  }
  const messageIndex = messageItems.findIndex((msg) => msg.id === messageId)
  if (messageIndex <= 0) return undefined

  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const candidate = messageItems[index] as DisplayMessage
    if (candidate.role === 'user') {
      return candidate.id
    }
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
  await captureMessage({
    messageId,
    parentId: resolvedParentId,
    fromTop,
    modelInfo
  })
}
</script>

<style scoped>
.compaction-divider {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem 0;
  user-select: none;
}

.compaction-divider__line {
  height: 1px;
  flex: 1 1 2.5rem;
  min-width: 2.5rem;
  background-color: rgb(120 120 120 / 0.32);
}

.compaction-divider__label {
  flex: none;
  color: hsl(var(--muted-foreground) / 0.78);
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.compaction-divider__label--compacting {
  color: hsl(var(--foreground) / 0.92);
  animation: compaction-breathe 2s ease-in-out infinite;
}

@keyframes compaction-breathe {
  0%,
  100% {
    color: hsl(var(--muted-foreground) / 0.74);
    opacity: 0.82;
    text-shadow: none;
  }

  50% {
    color: hsl(var(--foreground) / 0.94);
    opacity: 1;
    text-shadow: 0 0 10px hsl(var(--foreground) / 0.16);
  }
}

@media (prefers-reduced-motion: reduce) {
  .compaction-divider__label--compacting {
    animation: none;
    color: hsl(var(--muted-foreground) / 0.78);
    opacity: 1;
    text-shadow: none;
  }
}
</style>
