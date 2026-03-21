<template>
  <div v-if="showLane" class="w-full max-w-4xl" data-testid="pending-rail">
    <div
      class="rounded-xl border border-border/70 bg-card/55 px-2.5 py-2 shadow-sm backdrop-blur-lg"
    >
      <div class="mb-1.5 flex items-center justify-between gap-2" data-testid="pending-rail-header">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            v-if="steerItems.length > 0"
            class="inline-flex items-center rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {{ t('chat.pendingInput.steer') }} {{ steerItems.length }}
          </span>
          <span
            v-if="queueItems.length > 0"
            class="inline-flex items-center rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {{ t('chat.pendingInput.queueCount', { count: queueItems.length, max: activeLimit }) }}
          </span>
        </div>
        <Button
          v-if="showResumeQueue"
          variant="ghost"
          size="sm"
          class="h-6 shrink-0 rounded-full px-2.5 text-[11px] text-muted-foreground"
          @click="emit('resume-queue')"
        >
          {{ t('chat.pendingInput.resumeQueue') }}
        </Button>
      </div>

      <div
        :class="[
          'space-y-1',
          isScrollable ? `${listMaxHeightClass} overflow-y-auto pr-1` : 'overflow-visible'
        ]"
        data-testid="pending-rail-list"
        :data-scrollable="isScrollable ? 'true' : 'false'"
      >
        <div
          v-for="item in steerItems"
          :key="item.id"
          data-testid="pending-row"
          data-mode="steer"
          class="group flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/65 px-1.5 py-1 transition hover:border-border/80 hover:bg-background/80"
        >
          <Icon
            icon="lucide:corner-down-right"
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground/80"
          />
          <div class="min-w-0 flex-1">
            <div
              class="truncate text-[13px] leading-5 text-foreground"
              :title="formatPayloadTitle(item)"
            >
              {{ formatPayloadText(item) }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <span
              v-if="(item.payload.files?.length ?? 0) > 0"
              class="inline-flex items-center rounded-full border border-border/60 bg-muted/35 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground"
            >
              {{ t('chat.pendingInput.files', { count: item.payload.files?.length ?? 0 }) }}
            </span>
            <span
              class="inline-flex items-center rounded-full border border-border/60 bg-muted/45 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground"
            >
              {{ t('chat.pendingInput.locked') }}
            </span>
          </div>
        </div>

        <draggable
          :list="localQueueItems"
          item-key="id"
          handle=".pending-input-drag"
          :animation="150"
          :disabled="Boolean(editingItemId)"
          ghost-class="pending-input-ghost"
          class="space-y-1"
          @end="onDragEnd"
        >
          <template #item="{ element }">
            <div
              data-testid="pending-row"
              data-mode="queue"
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
                  :disabled="Boolean(editingItemId)"
                >
                  <Icon icon="lucide:grip-vertical" class="h-3.5 w-3.5" />
                </button>

                <div class="min-w-0 flex-1">
                  <template v-if="editingItemId === element.id">
                    <textarea
                      v-model="editingText"
                      data-testid="pending-edit-textarea"
                      class="min-h-[88px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0"
                      @click.stop
                      @keydown.enter.exact.prevent="saveEdit"
                      @keydown.esc.stop.prevent="cancelEdit"
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
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-7 rounded-full px-2 text-xs"
                          @click.stop="cancelEdit"
                        >
                          {{ t('common.cancel') }}
                        </Button>
                        <Button
                          size="sm"
                          class="h-7 rounded-full px-2 text-xs"
                          :disabled="!canSaveEdit"
                          @click.stop="saveEdit"
                        >
                          {{ t('common.save') }}
                        </Button>
                      </div>
                    </div>
                  </template>

                  <button
                    v-else
                    type="button"
                    data-testid="pending-row-main"
                    class="block w-full min-w-0 rounded-md px-1 py-0.5 text-left outline-none transition hover:bg-muted/35 focus-visible:bg-muted/35"
                    :title="formatPayloadTitle(element)"
                    @click="beginEdit(element)"
                  >
                    <span class="block truncate text-[13px] leading-5 text-foreground">
                      {{ formatPayloadText(element) }}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-6 rounded-full px-2 text-[11px] text-muted-foreground"
                    :disabled="disableSteerAction"
                    @click.stop="emit('convert-queue-to-steer', element.id)"
                  >
                    {{ t('chat.pendingInput.toSteer') }}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6 rounded-full text-muted-foreground"
                    @click.stop="emit('delete-queue', element.id)"
                  >
                    <Icon icon="lucide:x" class="h-3.5 w-3.5" />
                  </Button>
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
import { computed, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useI18n } from 'vue-i18n'
import type { PendingSessionInputRecord } from '@shared/types/agent-interface'

const props = withDefaults(
  defineProps<{
    steerItems: PendingSessionInputRecord[]
    queueItems: PendingSessionInputRecord[]
    activeLimit?: number
    disableSteerAction?: boolean
    showResumeQueue?: boolean
  }>(),
  {
    activeLimit: 5,
    disableSteerAction: false,
    showResumeQueue: false
  }
)

const emit = defineEmits<{
  'update-queue': [payload: { itemId: string; text: string }]
  'move-queue': [payload: { itemId: string; toIndex: number }]
  'convert-queue-to-steer': [itemId: string]
  'delete-queue': [itemId: string]
  'resume-queue': []
}>()
const { t } = useI18n()

const localQueueItems = ref<PendingSessionInputRecord[]>([])
const editingItemId = ref<string | null>(null)
const editingText = ref('')

const showLane = computed(() => props.steerItems.length > 0 || props.queueItems.length > 0)
const totalItems = computed(() => props.steerItems.length + props.queueItems.length)
const isScrollable = computed(() => totalItems.value > 3 || Boolean(editingItemId.value))
const listMaxHeightClass = computed(() => (editingItemId.value ? 'max-h-[220px]' : 'max-h-[116px]'))
const editingQueueItem = computed(
  () => props.queueItems.find((item) => item.id === editingItemId.value) ?? null
)
const canSaveEdit = computed(() => {
  if (!editingItemId.value) {
    return false
  }
  return (
    editingText.value.trim().length > 0 || (editingQueueItem.value?.payload.files?.length ?? 0) > 0
  )
})

watch(
  () => props.queueItems,
  (nextQueueItems) => {
    localQueueItems.value = [...nextQueueItems]
    if (editingItemId.value && !nextQueueItems.some((item) => item.id === editingItemId.value)) {
      editingItemId.value = null
      editingText.value = ''
    }
  },
  { deep: true, immediate: true }
)

function formatPayloadText(item: PendingSessionInputRecord): string {
  const text = item.payload.text?.trim()
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
  return formatPayloadText(item)
}

function beginEdit(item: PendingSessionInputRecord): void {
  editingItemId.value = item.id
  editingText.value = item.payload.text ?? ''
}

function cancelEdit(): void {
  editingItemId.value = null
  editingText.value = ''
}

function saveEdit(): void {
  const itemId = editingItemId.value
  if (!itemId) {
    return
  }

  const text = editingText.value.trim()
  const currentItem = props.queueItems.find((item) => item.id === itemId)
  if (!text && (currentItem?.payload.files?.length ?? 0) === 0) {
    return
  }

  emit('update-queue', { itemId, text })
  cancelEdit()
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
