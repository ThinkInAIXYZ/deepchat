<template>
  <div v-if="showLane" class="w-full max-w-4xl space-y-2">
    <div
      v-if="steerItems.length > 0"
      class="rounded-xl border border-border/70 bg-card/60 px-3 py-3 shadow-sm backdrop-blur-lg"
    >
      <div class="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {{ t('chat.pendingInput.steer') }}
      </div>
      <div class="space-y-2">
        <div
          v-for="item in steerItems"
          :key="item.id"
          class="flex items-start gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2"
        >
          <Icon
            icon="lucide:corner-down-right"
            class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          />
          <div class="min-w-0 flex-1">
            <div class="whitespace-pre-wrap break-words text-sm text-foreground">
              {{ formatPayloadText(item) }}
            </div>
            <div
              v-if="(item.payload.files?.length ?? 0) > 0"
              class="mt-1 text-xs text-muted-foreground"
            >
              {{ t('chat.pendingInput.files', { count: item.payload.files?.length ?? 0 }) }}
            </div>
          </div>
          <span
            class="shrink-0 rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {{ t('chat.pendingInput.locked') }}
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="queueItems.length > 0"
      class="rounded-xl border border-border/70 bg-card/60 px-3 py-3 shadow-sm backdrop-blur-lg"
    >
      <div class="mb-2 flex items-center justify-between gap-3">
        <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {{ t('chat.pendingInput.queueCount', { count: queueItems.length, max: activeLimit }) }}
        </div>
        <Button
          v-if="showResumeQueue"
          variant="ghost"
          size="sm"
          class="h-7 rounded-lg px-2 text-xs"
          @click="emit('resume-queue')"
        >
          {{ t('chat.pendingInput.resumeQueue') }}
        </Button>
      </div>

      <draggable
        :list="localQueueItems"
        item-key="id"
        handle=".pending-input-drag"
        :animation="150"
        :disabled="Boolean(editingItemId)"
        ghost-class="pending-input-ghost"
        class="space-y-2"
        @end="onDragEnd"
      >
        <template #item="{ element }">
          <div
            class="flex items-start gap-2 rounded-lg border border-border/60 bg-background/70 px-2 py-2"
          >
            <button
              type="button"
              class="pending-input-drag mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
              :title="t('chat.pendingInput.reorder')"
            >
              <Icon icon="lucide:grip-vertical" class="h-4 w-4" />
            </button>

            <div class="min-w-0 flex-1">
              <template v-if="editingItemId === element.id">
                <textarea
                  v-model="editingText"
                  class="min-h-[72px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0"
                  @click.stop
                  @keydown.enter.exact.prevent="saveEdit"
                  @keydown.esc.stop.prevent="cancelEdit"
                />
                <div class="mt-2 flex items-center justify-between gap-2">
                  <div class="text-xs text-muted-foreground">
                    <span v-if="(element.payload.files?.length ?? 0) > 0">
                      {{
                        t('chat.pendingInput.files', { count: element.payload.files?.length ?? 0 })
                      }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs"
                      @click.stop="cancelEdit"
                    >
                      {{ t('common.cancel') }}
                    </Button>
                    <Button size="sm" class="h-7 px-2 text-xs" @click.stop="saveEdit">
                      {{ t('common.save') }}
                    </Button>
                  </div>
                </div>
              </template>

              <button
                v-else
                type="button"
                class="w-full rounded-lg px-1 py-1 text-left transition hover:bg-muted/40"
                @click="beginEdit(element)"
              >
                <div class="whitespace-pre-wrap break-words text-sm text-foreground">
                  {{ formatPayloadText(element) }}
                </div>
                <div
                  v-if="(element.payload.files?.length ?? 0) > 0"
                  class="mt-1 text-xs text-muted-foreground"
                >
                  {{ t('chat.pendingInput.files', { count: element.payload.files?.length ?? 0 }) }}
                </div>
              </button>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                class="h-7 rounded-lg px-2 text-xs"
                :disabled="disableSteerAction"
                @click.stop="emit('convert-queue-to-steer', element.id)"
              >
                {{ t('chat.pendingInput.toSteer') }}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 rounded-lg text-muted-foreground"
                @click.stop="emit('delete-queue', element.id)"
              >
                <Icon icon="lucide:x" class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </template>
      </draggable>

      <div v-if="disableSteerAction" class="mt-2 text-xs text-muted-foreground">
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
  if (!text) {
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
