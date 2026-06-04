<template>
  <div
    ref="rowRef"
    class="message-list-row"
    :data-message-id="item.id"
    :data-message-role="item.role"
  >
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
      :show-trace="showTrace"
      :is-capturing-image="isCapturing"
      :is-read-only="isReadOnly"
      @retry="onRetry"
      @delete="onDelete"
      @fork="onFork"
      @continue="onContinue"
      @trace="onTrace"
      @copy-image="onCopyImage"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import MessageItemAssistant from '@/components/message/MessageItemAssistant.vue'
import MessageItemUser from '@/components/message/MessageItemUser.vue'
import {
  type DisplayAssistantMessage,
  isCompactionMessageItem,
  type DisplayUserMessage,
  type MessageListItem
} from './messageListItems'

const props = withDefaults(
  defineProps<{
    item: MessageListItem
    isGenerating?: boolean
    showTrace?: boolean
    isCapturing?: boolean
    isReadOnly?: boolean
  }>(),
  {
    isGenerating: false,
    showTrace: false,
    isCapturing: false,
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
  copyImage: [
    messageId: string,
    parentId: string | undefined,
    fromTop: boolean,
    modelInfo: { model_name: string; model_provider: string }
  ]
  measure: [payload: { messageId: string; height: number }]
}>()

const { t } = useI18n()
const rowRef = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let intersectionObserver: IntersectionObserver | null = null
let measureFrame: number | null = null
let lastMeasuredHeight = 0
// Rows use `content-visibility: auto`, so an off-screen row reports the
// `contain-intrinsic-size` placeholder (~300px) instead of its real height.
// Gate measurement on the row having actually entered (or neared) the viewport
// so we never commit a placeholder height that would skew jump/anchor restore.
let hasBeenVisible = typeof IntersectionObserver === 'undefined'

const emitMeasuredHeight = () => {
  if (!hasBeenVisible) return
  if (measureFrame !== null) return

  measureFrame = window.requestAnimationFrame(() => {
    measureFrame = null
    const messageId = props.item?.id
    if (!messageId) return
    const height = rowRef.value?.offsetHeight ?? 0
    if (height <= 0 || Math.abs(height - lastMeasuredHeight) < 1) return
    lastMeasuredHeight = height
    emit('measure', { messageId, height })
  })
}

onMounted(() => {
  if (!rowRef.value) return

  if (typeof IntersectionObserver !== 'undefined') {
    // `rootMargin` lets near-viewport rows measure slightly early for smoother
    // anchor restoration, while still excluding far-off-screen placeholder rows.
    intersectionObserver = new IntersectionObserver(
      (intersectionEntries) => {
        if (!intersectionEntries.some((entry) => entry.isIntersecting)) return
        hasBeenVisible = true
        emitMeasuredHeight()
        // Visibility only needs to be detected once; the ResizeObserver tracks
        // every subsequent height change.
        intersectionObserver?.disconnect()
        intersectionObserver = null
      },
      { rootMargin: '200px 0px' }
    )
    intersectionObserver.observe(rowRef.value)
  } else {
    emitMeasuredHeight()
  }

  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(emitMeasuredHeight)
  resizeObserver.observe(rowRef.value)
})

watch(
  () => props.item?.id,
  () => {
    lastMeasuredHeight = 0
    emitMeasuredHeight()
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  intersectionObserver?.disconnect()
  intersectionObserver = null
  if (measureFrame !== null) {
    window.cancelAnimationFrame(measureFrame)
    measureFrame = null
  }
})

const getCompactionCopy = (status?: 'compacting' | 'compacted'): string =>
  status === 'compacting' ? t('chat.compaction.compacting') : t('chat.compaction.compacted')

const onRetry = (messageId: string) => emit('retry', messageId)
const onDelete = (messageId: string) => emit('delete', messageId)
const onFork = (messageId: string) => emit('fork', messageId)
const onContinue = (conversationId: string, messageId: string) =>
  emit('continue', conversationId, messageId)
const onTrace = (messageId: string) => emit('trace', messageId)
const onEditSave = (payload: { messageId: string; text: string }) => emit('editSave', payload)
const onCopyImage = (
  messageId: string,
  parentId: string | undefined,
  fromTop: boolean,
  modelInfo: { model_name: string; model_provider: string }
) => emit('copyImage', messageId, parentId, fromTop, modelInfo)
</script>

<style scoped>
.message-list-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 300px;
}

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
