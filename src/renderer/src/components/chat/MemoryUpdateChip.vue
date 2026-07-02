<template>
  <div v-if="memoryActivity.hasChip" class="mb-2 flex w-full justify-start">
    <Popover v-model:open="popoverOpen">
      <PopoverTrigger as-child>
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-2 rounded-md border-border/70 bg-background/95 text-xs shadow-sm"
        >
          <Icon icon="lucide:brain" class="h-3.5 w-3.5" />
          <span>{{
            t('chat.memory.chip.title', { count: memoryActivity.displayChipItems.length })
          }}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" class="w-[min(92vw,34rem)] p-0">
        <div class="border-b px-3 py-2">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-medium">{{ t('chat.memory.chip.heading') }}</p>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6"
              data-testid="memory-chip-clear"
              :aria-label="t('common.clear')"
              @click="handleClearChip"
            >
              <Icon icon="lucide:x" class="h-3.5 w-3.5" />
            </Button>
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ t('chat.memory.chip.description') }}
          </p>
        </div>

        <div class="max-h-80 overflow-y-auto p-2">
          <div
            v-for="item in memoryActivity.displayChipItems"
            :key="item.id"
            class="rounded-md border border-border/70 p-2"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="line-clamp-3 text-sm leading-5">{{ item.memory.content }}</p>
                <div class="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge variant="outline" class="text-[10px]">{{ item.memory.kind }}</Badge>
                  <Badge v-if="item.memory.category" variant="secondary" class="text-[10px]">
                    {{ item.memory.category }}
                  </Badge>
                  <Badge
                    v-if="item.memory.status === 'archived'"
                    variant="secondary"
                    class="text-[10px]"
                  >
                    {{ t('chat.memory.status.archived') }}
                  </Badge>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7"
                  :disabled="item.busy || isArchived(item)"
                  :aria-label="t('chat.memory.actions.undo')"
                  @click="handleUndo(item.id)"
                >
                  <Icon icon="lucide:undo-2" class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7"
                  :disabled="item.busy || isArchived(item)"
                  :aria-label="t('chat.memory.actions.forget')"
                  @click="handleForget(item.id)"
                >
                  <Icon icon="lucide:archive" class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7"
                  :disabled="item.busy || isArchived(item)"
                  :aria-label="t('chat.memory.actions.edit')"
                  @click="startEditing(item)"
                >
                  <Icon icon="lucide:pencil" class="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div v-if="memoryActivity.chipDraft?.memoryId === item.id" class="mt-2 space-y-2">
              <Textarea
                :model-value="memoryActivity.chipDraft?.text ?? ''"
                :aria-label="t('chat.memory.actions.edit')"
                :disabled="!props.visible"
                class="min-h-20 resize-y text-sm"
                @update:model-value="handleDraftTextUpdate"
              />
              <div class="flex justify-end gap-2">
                <Button variant="ghost" size="sm" @click="cancelEditing">
                  {{ t('common.cancel') }}
                </Button>
                <Button
                  size="sm"
                  :disabled="
                    item.busy ||
                    isArchived(item) ||
                    (memoryActivity.chipDraft?.text ?? '').trim().length === 0
                  "
                  @click="handleAmend(item.id)"
                >
                  {{ t('common.save') }}
                </Button>
              </div>
            </div>

            <p v-if="item.error" class="mt-2 text-xs text-destructive">
              {{ t(memoryErrorKey(item.error)) }}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Textarea } from '@shadcn/components/ui/textarea'
import { useToast } from '@/components/use-toast'
import { useMemoryActivityStore, type MemoryActivityItem } from '@/stores/ui/memoryActivity'

const props = withDefaults(
  defineProps<{
    visible?: boolean
  }>(),
  {
    visible: true
  }
)
const memoryActivity = useMemoryActivityStore()
const { t } = useI18n()
const { toast } = useToast()
const open = ref(false)
const popoverOpen = computed({
  get: () => props.visible && open.value,
  set: (value: boolean) => {
    open.value = props.visible ? value : false
  }
})

watch(
  () => memoryActivity.hasChip,
  (hasChip) => {
    if (!hasChip) {
      open.value = false
    }
  }
)
watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      open.value = false
    }
  }
)

function isArchived(item: MemoryActivityItem): boolean {
  return item.memory.status === 'archived'
}

function findDisplayItem(memoryId: string): MemoryActivityItem | undefined {
  return memoryActivity.displayChipItems.find((item) => item.id === memoryId)
}

function canMutateItem(item: MemoryActivityItem | undefined): item is MemoryActivityItem {
  return !!item && !item.busy && !isArchived(item)
}

function startEditing(item: MemoryActivityItem): void {
  if (!props.visible) return
  if (item.busy || isArchived(item)) return
  memoryActivity.startChipEdit(item)
}

function cancelEditing(): void {
  if (!props.visible) return
  memoryActivity.cancelChipEdit()
}

function handleDraftTextUpdate(value: string | number): void {
  if (!props.visible) return
  memoryActivity.setChipDraftText(String(value))
}

function handleClearChip(): void {
  if (!props.visible) return
  open.value = false
  memoryActivity.clearChip()
}

async function handleUndo(memoryId: string): Promise<void> {
  if (!props.visible) return
  const item = findDisplayItem(memoryId)
  const ok = canMutateItem(item) ? await memoryActivity.undoCreated(memoryId) : false
  toast({
    title: ok ? t('chat.memory.toast.undoSuccess') : t('chat.memory.toast.undoFailed'),
    variant: ok ? 'default' : 'destructive'
  })
}

async function handleForget(memoryId: string): Promise<void> {
  if (!props.visible) return
  const item = findDisplayItem(memoryId)
  const ok = canMutateItem(item) ? await memoryActivity.forget(memoryId) : false
  toast({
    title: ok ? t('chat.memory.toast.forgetSuccess') : t('chat.memory.toast.forgetFailed'),
    variant: ok ? 'default' : 'destructive'
  })
}

async function handleAmend(memoryId: string): Promise<void> {
  if (!props.visible) return
  const item = findDisplayItem(memoryId)
  const text = memoryActivity.chipDraft?.text ?? ''
  const result =
    canMutateItem(item) && text.trim().length > 0
      ? await memoryActivity.amend(memoryId, text)
      : null
  if (result) {
    cancelEditing()
  }
  toast({
    title: result
      ? t(`chat.memory.toast.add.${result.action}`)
      : t('chat.memory.toast.amendFailed'),
    variant: result ? 'default' : 'destructive'
  })
}

function memoryErrorKey(error: string): string {
  if (error === 'amend_failed_retry') return 'chat.memory.errors.amendRetryable'
  if (error === 'amend_restore_failed') return 'chat.memory.errors.amendRestoreFailed'
  return 'chat.memory.errors.actionFailed'
}
</script>
