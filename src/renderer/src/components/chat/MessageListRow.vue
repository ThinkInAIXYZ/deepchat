<template>
  <div
    ref="rowRef"
    class="message-list-row pb-1"
    :data-message-id="item.id"
    :data-message-role="item.role"
  >
    <div
      v-if="isCompactionMessageItem(item)"
      data-compaction-indicator="true"
      :data-compaction-status="
        isCompactionFailed ? 'failed' : (item.compactionStatus ?? 'compacted')
      "
      :data-compaction-boundary-reason="item.compactionBoundaryReason ?? undefined"
      class="flex min-w-0 flex-col gap-1.5 pl-11 pr-11 pt-4"
    >
      <button
        type="button"
        data-testid="compaction-trigger"
        class="inline-flex w-fit max-w-full min-w-0 min-h-7 items-center gap-2 rounded-sm py-1 text-left text-sm leading-5 text-foreground/60 select-none transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
        :disabled="isCompacting"
        :aria-expanded="isCompacting ? undefined : isCompactionExpanded"
        :aria-controls="isCompactionExpanded ? compactionDetailsId : undefined"
        @click="isCompactionExpanded = !isCompactionExpanded"
      >
        <Icon
          :icon="
            isCompactionFailed
              ? 'lucide:circle-alert'
              : isCompacting
                ? 'lucide:loader-circle'
                : 'lucide:fold-vertical'
          "
          class="h-4 w-4 shrink-0"
          :class="{
            'text-destructive': isCompactionFailed,
            'animate-spin motion-reduce:animate-none': isCompacting
          }"
          aria-hidden="true"
        />
        <span class="min-w-0 truncate" :title="compactionLabel">{{ compactionLabel }}</span>
        <Icon
          v-if="!isCompacting"
          icon="lucide:chevron-right"
          class="h-3.5 w-3.5 shrink-0 transition-transform duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] motion-reduce:transition-none"
          :class="isCompactionExpanded ? 'rotate-90' : 'rotate-0'"
          aria-hidden="true"
        />
      </button>
      <div
        v-if="isCompactionExpanded"
        :id="compactionDetailsId"
        data-testid="compaction-details"
        class="min-w-0 pl-6 pb-2"
      >
        <div
          v-if="isCompactionFailed"
          class="whitespace-pre-wrap break-words text-xs text-destructive dark:text-red-400"
        >
          {{ compactionDetails }}
        </div>
        <MarkdownRenderer
          v-else
          :content="compactionDetails"
          :message-id="item.id"
          :thread-id="item.conversationId"
          mode="minimal"
          :final="true"
          :smooth-streaming="false"
          :virtualize-nodes="!disableMarkdownVirtualization"
        />
      </div>
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
      :is-streaming-message="isStreamingMessage"
      :show-trace="showTrace"
      :is-capturing-image="isCapturing"
      :is-read-only="isReadOnly"
      :allow-guard-stop-continue="allowGuardStopContinue"
      :disable-markdown-virtualization="disableMarkdownVirtualization"
      @retry="onRetry"
      @delete="onDelete"
      @fork="onFork"
      @continue="onContinue"
      @trace="onTrace"
      @tape-inspector="onTapeInspector"
      @copy-image="onCopyImage"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch, onMounted, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import MessageItemAssistant from '@/components/message/MessageItemAssistant.vue'
import MessageItemUser from '@/components/message/MessageItemUser.vue'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import {
  type DisplayAssistantMessage,
  isCompactionMessageItem,
  type DisplayUserMessage,
  type MessageListItem
} from '@/features/chat-page/model/displayMessage'

const props = withDefaults(
  defineProps<{
    item: MessageListItem
    isGenerating?: boolean
    isStreamingMessage?: boolean
    showTrace?: boolean
    isCapturing?: boolean
    isReadOnly?: boolean
    disableMarkdownVirtualization?: boolean
    allowGuardStopContinue?: boolean
  }>(),
  {
    isGenerating: false,
    isStreamingMessage: false,
    showTrace: false,
    isCapturing: false,
    isReadOnly: false,
    disableMarkdownVirtualization: false,
    allowGuardStopContinue: true
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
  copyImage: [
    messageId: string,
    parentId: string | undefined,
    fromTop: boolean,
    modelInfo: { model_name: string; model_provider: string }
  ]
  measure: [payload: { messageId: string; height: number }]
}>()

const { t, te } = useI18n()
const rowRef = ref<HTMLElement | null>(null)
const isCompactionExpanded = ref(false)
const compactionDetailsId = `compaction-details-${useId()}`
const isCompactionFailed = computed(
  () => props.item.compactionStatus === 'failed' || props.item.status === 'error'
)
const isCompacting = computed(
  () => !isCompactionFailed.value && props.item.compactionStatus === 'compacting'
)
const compactionLabel = computed(() => {
  if (isCompactionFailed.value) return t('chat.compaction.failedTitle')
  if (isCompacting.value) return t('chat.compaction.compacting')
  if (props.item.compactionBoundaryReason === 'summary_unavailable') {
    return t('chat.compaction.compactedWithoutSummary')
  }
  if (props.item.compactionBoundaryReason === 'summary_rejected_larger') {
    return t('chat.compaction.compactedWithoutLargerSummary')
  }
  return t('chat.compaction.compacted')
})
const compactionDetails = computed(() => {
  if (isCompactionFailed.value) {
    const detail = props.item.compactionError
    const error =
      (typeof detail === 'string' ? detail : '') || props.item.error || 'common.unknownError'
    return te(error) ? t(error) : error
  }
  const summary = props.item.compactionSummary
  if (typeof summary === 'string' && summary.trim()) return summary
  return props.item.compactionBoundaryReason ? compactionLabel.value : t('common.noContent')
})
let resizeObserver: ResizeObserver | null = null
let measureFrame: number | null = null
let measureRetryTimer: number | null = null
let lastMeasuredHeight = 0

const isParentListScrolling = () => Boolean(rowRef.value?.closest('.dc-list-scrolling'))

const scheduleMeasureRetry = () => {
  if (measureRetryTimer !== null) return
  measureRetryTimer = window.setTimeout(() => {
    measureRetryTimer = null
    emitMeasuredHeight()
  }, 160)
}

const emitMeasuredHeight = () => {
  if (measureFrame !== null) return

  measureFrame = window.requestAnimationFrame(() => {
    measureFrame = null
    if (isParentListScrolling()) {
      scheduleMeasureRetry()
      return
    }
    const messageId = props.item?.renderKey ?? props.item?.id
    if (!messageId) return
    const height = rowRef.value?.offsetHeight ?? 0
    // Match useMessageWindow MEASURE_DELTA_EPSILON_PX: skip sub-threshold noise.
    if (height <= 0 || Math.abs(height - lastMeasuredHeight) < 4) return
    lastMeasuredHeight = height
    emit('measure', { messageId, height })
  })
}

onMounted(() => {
  if (!rowRef.value) return

  emitMeasuredHeight()

  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(emitMeasuredHeight)
  resizeObserver.observe(rowRef.value)
})

watch(
  () => props.item?.renderKey ?? props.item?.id,
  () => {
    isCompactionExpanded.value = false
    lastMeasuredHeight = 0
    emitMeasuredHeight()
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (measureFrame !== null) {
    window.cancelAnimationFrame(measureFrame)
    measureFrame = null
  }
  if (measureRetryTimer !== null) {
    window.clearTimeout(measureRetryTimer)
    measureRetryTimer = null
  }
})

const onRetry = (messageId: string) => emit('retry', messageId)
const onDelete = (messageId: string) => emit('delete', messageId)
const onFork = (messageId: string) => emit('fork', messageId)
const onContinue = (conversationId: string, messageId: string) =>
  emit('continue', conversationId, messageId)
const onTrace = (messageId: string) => emit('trace', messageId)
const onTapeInspector = (messageId: string) => emit('tapeInspector', messageId)
const onEditSave = (payload: { messageId: string; text: string }) => emit('editSave', payload)
const onCopyImage = (
  messageId: string,
  parentId: string | undefined,
  fromTop: boolean,
  modelInfo: { model_name: string; model_provider: string }
) => emit('copyImage', messageId, parentId, fromTop, modelInfo)
</script>
