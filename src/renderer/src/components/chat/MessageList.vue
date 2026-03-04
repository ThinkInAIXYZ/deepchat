<template>
  <div class="message-list-container">
    <div class="max-w-3xl mx-auto px-4 py-6 space-y-1">
      <template v-for="msg in messages" :key="msg.id">
        <MessageItemUser
          v-if="msg.role === 'user'"
          :message="msg as UserMessage"
          :use-legacy-actions="false"
          @retry="onRetry"
          @delete="onDelete"
          @edit-save="onEditSave"
        />
        <MessageItemAssistant
          v-else-if="msg.role === 'assistant'"
          :message="msg as AssistantMessage"
          :use-legacy-actions="false"
          :is-in-generating-thread="isGenerating"
          :show-trace="traceMessageIdSet.has(msg.id)"
          :is-capturing-image="isCapturing"
          @retry="onRetry"
          @delete="onDelete"
          @fork="onFork"
          @trace="onTrace"
          @copy-image="handleCopyImage"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Message, UserMessage, AssistantMessage } from '@shared/chat'
import MessageItemAssistant from '@/components/message/MessageItemAssistant.vue'
import MessageItemUser from '@/components/message/MessageItemUser.vue'
import { useMessageCapture } from '@/composables/message/useMessageCapture'

const props = withDefaults(
  defineProps<{
    messages: Message[]
    isGenerating?: boolean
    traceMessageIds?: string[]
  }>(),
  {
    isGenerating: false,
    traceMessageIds: () => []
  }
)

const emit = defineEmits<{
  retry: [messageId: string]
  delete: [messageId: string]
  fork: [messageId: string]
  trace: [messageId: string]
  editSave: [payload: { messageId: string; text: string }]
}>()

const traceMessageIdSet = computed(() => new Set(props.traceMessageIds))
const { isCapturing, captureMessage } = useMessageCapture()

const onRetry = (messageId: string) => {
  emit('retry', messageId)
}

const onDelete = (messageId: string) => {
  emit('delete', messageId)
}

const onFork = (messageId: string) => {
  emit('fork', messageId)
}

const onTrace = (messageId: string) => {
  emit('trace', messageId)
}

const onEditSave = (payload: { messageId: string; text: string }) => {
  emit('editSave', payload)
}

const handleCopyImage = async (
  messageId: string,
  parentId: string | undefined,
  fromTop: boolean,
  modelInfo: { model_name: string; model_provider: string }
) => {
  await captureMessage({
    messageId,
    parentId,
    fromTop,
    modelInfo
  })
}
</script>
