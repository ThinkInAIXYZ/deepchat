<template>
  <div v-if="showLane" class="w-full max-w-4xl" data-testid="pending-rail">
    <div
      class="rounded-xl border border-border/70 bg-card/55 px-2.5 py-2 shadow-sm"
      style="
        backdrop-filter: blur(var(--dc-blur-panel));
        -webkit-backdrop-filter: blur(var(--dc-blur-panel));
      "
    >
      <div class="mb-1.5 flex items-center justify-between gap-2" data-testid="pending-rail-header">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            v-if="queueItems.length > 0"
            class="inline-flex items-center rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {{ t('chat.pendingInput.queueCount', { count: queueItems.length, max: activeLimit }) }}
          </span>
          <span
            v-if="blockedCount > 0"
            class="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
          >
            {{ t('chat.attachments.pending.blockedCount', { count: blockedCount }) }}
          </span>
        </div>
        <DcButton
          v-if="showResumeAction"
          variant="ghost"
          size="sm"
          data-testid="pending-resume-queue"
          class="h-7 shrink-0 rounded-full px-2 text-xs"
          :disabled="resumeDisabled || resumeLoading"
          @click="emit('resume-queue')"
        >
          <Icon
            icon="lucide:play"
            class="mr-1 h-3.5 w-3.5"
            :class="resumeLoading ? 'animate-pulse' : ''"
          />
          {{ t('chat.pendingInput.resume') }}
        </DcButton>
      </div>

      <div
        :class="[
          'space-y-1',
          isScrollable
            ? `${listMaxHeightClass} overflow-y-auto overscroll-contain pr-1`
            : 'overflow-visible'
        ]"
        data-testid="pending-rail-list"
        :data-scrollable="isScrollable ? 'true' : 'false'"
      >
        <draggable
          :list="localQueueItems"
          item-key="id"
          handle=".pending-input-drag"
          :animation="150"
          :disabled="Boolean(editingItemId) || hasBlockedQueueItem || hasRetryRequiredQueueItem"
          ghost-class="pending-input-ghost"
          class="space-y-1"
          @end="onDragEnd"
        >
          <template #item="{ element }">
            <div
              data-testid="pending-row"
              data-mode="queue"
              :data-state="element.state"
              :data-editing="editingItemId === element.id ? 'true' : 'false'"
              :class="[
                'group rounded-lg border border-border/50 bg-background/65 px-1.5 transition hover:border-border/80 hover:bg-background/80 focus-within:border-border/80 focus-within:bg-background/80',
                editingItemId === element.id ? 'py-2' : 'py-1'
              ]"
            >
              <div
                :class="
                  editingItemId === element.id
                    ? 'flex items-start gap-1.5'
                    : 'flex items-center gap-1.5'
                "
              >
                <button
                  type="button"
                  class="pending-input-drag inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
                  :title="t('chat.pendingInput.reorder')"
                  :disabled="
                    Boolean(editingItemId) ||
                    element.state === 'blocked' ||
                    element.state === 'retry_required'
                  "
                >
                  <Icon icon="lucide:grip-vertical" class="h-3.5 w-3.5" />
                </button>

                <div class="min-w-0 flex-1">
                  <template v-if="editingItemId === element.id">
                    <ReferenceEditor
                      ref="referenceEditor"
                      data-testid="pending-edit-textarea"
                      :text="element.payload.text ?? ''"
                      :inline-items="element.payload.inlineItems"
                      :ariaLabel="t('thread.toolbar.edit')"
                      :editable="!isSavingEdit"
                      @content-change="editingHasContent = $event"
                      @save="submitEdit"
                      @cancel="cancelEdit"
                    />
                    <div class="mt-2 flex items-center justify-between gap-2">
                      <div class="text-xs text-muted-foreground">
                        <span v-if="(element.payload.files?.length ?? 0) > 0">
                          {{
                            t('chat.pendingInput.files', {
                              count: element.payload.files?.length ?? 0
                            })
                          }}
                        </span>
                      </div>
                      <div class="flex items-center gap-1">
                        <DcButton
                          variant="ghost"
                          size="sm"
                          class="h-7 rounded-full px-2 text-xs"
                          :disabled="isSavingEdit"
                          @click.stop="cancelEdit"
                        >
                          {{ t('common.cancel') }}
                        </DcButton>
                        <DcButton
                          size="sm"
                          class="h-7 rounded-full px-2 text-xs"
                          :disabled="!canSaveEdit"
                          @click.stop="submitEdit"
                        >
                          {{ t('common.save') }}
                        </DcButton>
                      </div>
                    </div>
                  </template>

                  <button
                    v-else
                    type="button"
                    data-testid="pending-row-main"
                    class="block w-full min-w-0 rounded-md px-1 py-0.5 text-left outline-none transition hover:bg-muted/35 focus-visible:bg-muted/35"
                    :title="formatPayloadTitle(element)"
                    :disabled="element.state === 'blocked'"
                    @click="beginEdit(element)"
                  >
                    <span class="block truncate text-[13px] leading-5 text-foreground">
                      {{ formatPayloadText(element) }}
                    </span>
                    <span
                      v-if="element.state === 'blocked'"
                      class="block truncate text-[11px] leading-4 text-amber-600"
                    >
                      {{ formatBlockingText(element) }}
                    </span>
                    <span
                      v-else-if="element.state === 'retry_required'"
                      class="block truncate text-[11px] leading-4 text-amber-600"
                    >
                      {{ t('chat.pendingInput.retryRequiredDescription') }}
                    </span>
                  </button>
                </div>

                <div
                  v-if="editingItemId !== element.id"
                  class="flex shrink-0 items-center gap-1 opacity-70 transition group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <span
                    v-if="(element.payload.files?.length ?? 0) > 0"
                    class="inline-flex items-center rounded-full border border-border/60 bg-muted/35 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground"
                  >
                    {{
                      t('chat.pendingInput.files', { count: element.payload.files?.length ?? 0 })
                    }}
                  </span>
                  <template v-if="element.state === 'blocked'">
                    <span
                      class="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] leading-none text-amber-700 dark:text-amber-300"
                    >
                      {{ t('chat.attachments.pending.blocked') }}
                    </span>
                    <DcButton
                      variant="ghost"
                      size="icon"
                      data-testid="pending-blocked-retry"
                      class="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground"
                      :tooltip="t('chat.attachments.pending.retry')"
                      :aria-label="t('chat.attachments.pending.retry')"
                      @click.stop="emit('resolve-blocked', { itemId: element.id, action: 'retry' })"
                    >
                      <Icon icon="lucide:refresh-cw" class="h-3.5 w-3.5" />
                    </DcButton>
                    <DcButton
                      variant="ghost"
                      size="icon"
                      data-testid="pending-blocked-send-without"
                      class="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground"
                      :tooltip="t('chat.attachments.pending.sendWithoutImageContent')"
                      :aria-label="t('chat.attachments.pending.sendWithoutImageContent')"
                      @click.stop="
                        emit('resolve-blocked', {
                          itemId: element.id,
                          action: 'send_without_image_content'
                        })
                      "
                    >
                      <Icon icon="lucide:file-x-2" class="h-3.5 w-3.5" />
                    </DcButton>
                  </template>
                  <template v-else-if="element.state === 'retry_required'">
                    <span
                      class="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] leading-none text-amber-700 dark:text-amber-300"
                    >
                      {{ t('chat.pendingInput.retryRequired') }}
                    </span>
                    <DcButton
                      variant="ghost"
                      size="icon"
                      data-testid="pending-released-retry"
                      class="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground"
                      :tooltip="t('chat.pendingInput.retry')"
                      :aria-label="t('chat.pendingInput.retry')"
                      :disabled="retryingItemId === element.id"
                      @click.stop="emit('retry-queue', element.id)"
                    >
                      <Icon
                        icon="lucide:refresh-cw"
                        class="h-3.5 w-3.5"
                        :class="retryingItemId === element.id ? 'animate-spin' : ''"
                      />
                    </DcButton>
                  </template>
                  <DcButton
                    v-else
                    variant="ghost"
                    size="icon"
                    data-testid="pending-row-steer"
                    class="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground"
                    :tooltip="
                      disableQueueSteerAction
                        ? t('chat.pendingInput.steerUnavailable')
                        : t('chat.pendingInput.toSteer')
                    "
                    :aria-label="
                      disableQueueSteerAction
                        ? t('chat.pendingInput.steerUnavailable')
                        : t('chat.pendingInput.toSteer')
                    "
                    :disabled="disableQueueSteerAction"
                    @click.stop="emit('steer-queue', element.id)"
                  >
                    <Icon icon="lucide:compass" class="h-3.5 w-3.5" />
                  </DcButton>
                  <DcButton
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6 rounded-full text-muted-foreground"
                    :tooltip="t('chat.pendingInput.remove')"
                    @click.stop="emit('delete-queue', element.id)"
                  >
                    <Icon icon="lucide:x" class="h-3.5 w-3.5" />
                  </DcButton>
                </div>
              </div>
            </div>
          </template>
        </draggable>
      </div>

      <div v-if="disableSteerAction" class="mt-1.5 text-[11px] text-muted-foreground">
        {{ t('chat.pendingInput.limitReached', { max: activeLimit }) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { useI18n } from 'vue-i18n'
import type { PendingSessionInputRecord } from '@shared/types/agent-interface'
import { MAX_PENDING_INPUTS } from '@shared/pendingInput'
import type { UserMessageInlineItem } from '@shared/types/agent-interface'
import { collectVisibleUserMessageText } from '@/features/chat-page/model/displayUserMessageText'
import ReferenceEditor from './ReferenceEditor.vue'

type ReferenceEditorApi = {
  getValue: () => { text: string; inlineItems: UserMessageInlineItem[] }
  focus: () => void
}

const props = withDefaults(
  defineProps<{
    queueItems: PendingSessionInputRecord[]
    saveEdit?: (payload: {
      itemId: string
      text: string
      inlineItems: UserMessageInlineItem[]
    }) => Promise<boolean>
    activeLimit?: number
    disableSteerAction?: boolean
    disableQueueSteerAction?: boolean
    showResumeAction?: boolean
    resumeDisabled?: boolean
    resumeLoading?: boolean
    retryingItemId?: string | null
  }>(),
  {
    activeLimit: MAX_PENDING_INPUTS,
    disableSteerAction: false,
    disableQueueSteerAction: false,
    showResumeAction: false,
    resumeDisabled: false,
    resumeLoading: false,
    retryingItemId: null
  }
)

const emit = defineEmits<{
  'move-queue': [payload: { itemId: string; toIndex: number }]
  'steer-queue': [itemId: string]
  'delete-queue': [itemId: string]
  'resume-queue': []
  'retry-queue': [itemId: string]
  'resolve-blocked': [payload: { itemId: string; action: 'retry' | 'send_without_image_content' }]
}>()
const { t } = useI18n()

const localQueueItems = ref<PendingSessionInputRecord[]>([])
const editingItemId = ref<string | null>(null)
const editingHasContent = ref(false)
const isSavingEdit = ref(false)
const referenceEditor = ref<ReferenceEditorApi | null>(null)

const showLane = computed(() => props.queueItems.length > 0)
const blockedCount = computed(
  () => props.queueItems.filter((item) => item.state === 'blocked').length
)
const hasBlockedQueueItem = computed(() =>
  props.queueItems.some((item) => item.state === 'blocked')
)
const hasRetryRequiredQueueItem = computed(() =>
  props.queueItems.some((item) => item.state === 'retry_required')
)
const isScrollable = computed(() => props.queueItems.length > 3 || Boolean(editingItemId.value))
const listMaxHeightClass = computed(() => (editingItemId.value ? 'max-h-[220px]' : 'max-h-[116px]'))
const editingQueueItem = computed(
  () => props.queueItems.find((item) => item.id === editingItemId.value) ?? null
)
const canSaveEdit = computed(() => {
  return Boolean(
    editingItemId.value &&
    !isSavingEdit.value &&
    (editingHasContent.value || editingQueueItem.value?.payload.files?.length)
  )
})

watch(
  () => props.queueItems,
  (nextQueueItems) => {
    localQueueItems.value = [...nextQueueItems]
    if (editingItemId.value && !nextQueueItems.some((item) => item.id === editingItemId.value)) {
      editingItemId.value = null
      editingHasContent.value = false
    }
  },
  { deep: true, immediate: true }
)

function formatPayloadText(item: PendingSessionInputRecord): string {
  const text = collectVisibleUserMessageText({
    text: item.payload.text || '',
    inlineItems: item.payload.inlineItems,
    files: [],
    links: [],
    think: false,
    search: false
  }).trim()
  if (text) {
    return text
  }
  const fileCount = item.payload.files?.length ?? 0
  if (fileCount > 0) {
    return t('chat.pendingInput.attachmentsOnly', { count: fileCount })
  }
  return t('chat.pendingInput.empty')
}

function formatPayloadTitle(item: PendingSessionInputRecord): string {
  if (item.state === 'blocked') {
    return `${formatPayloadText(item)} — ${formatBlockingText(item)}`
  }
  if (item.state === 'retry_required') {
    return `${formatPayloadText(item)} — ${t('chat.pendingInput.retryRequiredDescription')}`
  }
  return formatPayloadText(item)
}

function beginEdit(item: PendingSessionInputRecord): void {
  if (item.state === 'blocked' || isSavingEdit.value) {
    return
  }
  editingItemId.value = item.id
  editingHasContent.value = Boolean(
    item.payload.text?.trim() || item.payload.inlineItems?.some((entry) => entry.type === 'session')
  )
  void nextTick(() => referenceEditor.value?.focus())
}

function formatBlockingText(item: PendingSessionInputRecord): string {
  const firstIssue = item.blocking?.issues[0]
  if (!firstIssue) {
    return t('chat.attachments.pending.blockedDescription')
  }

  const reason = t(`chat.attachments.reasons.${firstIssue.reason}`)
  const remaining = Math.max(0, (item.blocking?.issues.length ?? 0) - 1)
  return remaining > 0
    ? t('chat.attachments.pending.blockedReasonMore', { reason, count: remaining })
    : reason
}

function cancelEdit(): void {
  if (isSavingEdit.value) return
  editingItemId.value = null
  editingHasContent.value = false
}

async function submitEdit(): Promise<void> {
  const itemId = editingItemId.value
  if (!itemId || !canSaveEdit.value || !props.saveEdit) {
    return
  }

  const value = referenceEditor.value?.getValue()
  if (!value) return
  if (
    !value.text.trim() &&
    (editingQueueItem.value?.payload.files?.length ?? 0) === 0 &&
    !value.inlineItems.some((item) => item.type === 'session')
  )
    return
  isSavingEdit.value = true
  try {
    const saved = await props.saveEdit({ itemId, ...value })
    if (saved && editingItemId.value === itemId) {
      editingItemId.value = null
      editingHasContent.value = false
    }
  } finally {
    isSavingEdit.value = false
  }
}

function onDragEnd(event: { oldIndex?: number; newIndex?: number }): void {
  const oldIndex = typeof event.oldIndex === 'number' ? event.oldIndex : -1
  const newIndex = typeof event.newIndex === 'number' ? event.newIndex : -1
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return
  }

  const movedItem = localQueueItems.value[newIndex]
  if (!movedItem) {
    return
  }

  emit('move-queue', { itemId: movedItem.id, toIndex: newIndex })
}
</script>
